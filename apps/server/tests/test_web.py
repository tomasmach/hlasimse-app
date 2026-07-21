import json
import uuid
from copy import deepcopy
from datetime import timedelta

import pytest
from django.conf import settings as django_settings
from django.core import mail
from django.test import Client, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import (
    PAUSED_UNTIL_MAX_ERROR,
    AlertAcknowledgement,
    AlertIncident,
    AlertRecipient,
    CheckIn,
    CheckInProfile,
    DeliveryAttempt,
    GuardianInvitation,
    GuardianMembership,
    OutboxEvent,
    PushDevice,
    User,
)
from core.services import create_profile, perform_check_in, sweep_expired_deadlines, update_profile

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def web_settings():
    templates = deepcopy(django_settings.TEMPLATES)
    templates[0]["DIRS"] = [django_settings.BASE_DIR / "templates"]
    with override_settings(
        ROOT_URLCONF="core.web_urls",
        EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
        TEMPLATES=templates,
    ):
        yield


def test_public_pages_render_and_private_page_requires_session(client):
    landing = client.get(reverse("core:landing"))
    support = client.get(reverse("core:support"))

    assert landing.status_code == 200
    assert reverse("core:support") in landing.content.decode()
    assert support.status_code == 200
    assert "mailto:support@example.invalid" in support.content.decode()
    assert "nesleduje incidenty v reálném čase" in support.content.decode()
    assert client.get(reverse("accounts:login")).status_code == 200
    assert client.get(reverse("accounts:register")).status_code == 200

    response = client.get(reverse("core:dashboard"))

    assert response.status_code == 302
    assert reverse("accounts:login") in response.url


@override_settings(LEGAL_TERMS_VERSION="2026-07-21-web-v1")
def test_registration_requires_terms_and_redirects_to_verification(client):
    payload = {
        "email": "new@example.cz",
        "first_name": "Alena",
        "last_name": "Nová",
        "password1": "A-strong-unique-password-123",
        "password2": "A-strong-unique-password-123",
    }
    rejected = client.post(reverse("accounts:register"), payload)
    assert rejected.status_code == 200
    assert not User.objects.filter(email="new@example.cz").exists()

    created = client.post(reverse("accounts:register"), {**payload, "terms": "on"})

    assert created.status_code == 302
    assert created.url == reverse("accounts:verification-sent")
    assert "_auth_user_id" not in client.session
    created_user = User.objects.get(email="new@example.cz")
    assert created_user.email_verified_at is None
    assert created_user.terms_version == "2026-07-21-web-v1"
    assert created_user.terms_accepted_at is not None


def test_login_and_logout_use_session_and_logout_is_post_only(client, user):
    response = client.post(
        reverse("accounts:login"),
        {"username": user.email, "password": "Safely-testing-123"},
    )

    assert response.status_code == 302
    assert response.url == reverse("core:dashboard")
    assert "_auth_user_id" in client.session
    assert client.get(reverse("accounts:logout")).status_code == 405
    assert client.post(reverse("accounts:logout")).status_code == 302
    assert "_auth_user_id" not in client.session


def test_password_reset_uses_non_enumerating_flow_and_sends_namespaced_link(client, user):
    known = client.post(reverse("accounts:password_reset"), {"email": user.email})
    unknown = client.post(reverse("accounts:password_reset"), {"email": "missing@example.cz"})

    assert known.status_code == 302
    assert unknown.status_code == 302
    assert known.url == unknown.url == reverse("accounts:password_reset_done")
    assert len(mail.outbox) == 1
    assert "/ucet/obnova-hesla/" in mail.outbox[0].body


def test_emailed_web_password_reset_revokes_all_refresh_tokens(client, user):
    issued_refreshes = [str(RefreshToken.for_user(user)) for _ in range(2)]
    reset_password = "Reset-web-password-456"

    requested = client.post(reverse("accounts:password_reset"), {"email": user.email})
    reset_url = next(word for word in mail.outbox[0].body.split() if word.startswith("http"))
    reset_path = reset_url.removeprefix("http://testserver")
    token_redirect = client.get(reset_path)
    confirmed = client.post(
        token_redirect.url,
        {"new_password1": reset_password, "new_password2": reset_password},
    )

    assert requested.status_code == 302
    assert token_redirect.status_code == 302
    assert confirmed.status_code == 302
    assert confirmed.url == reverse("accounts:password_reset_complete")
    assert OutstandingToken.objects.filter(user=user).count() == 2
    assert BlacklistedToken.objects.filter(token__user=user).count() == 2
    for refresh in issued_refreshes:
        with pytest.raises(TokenError, match="blacklisted"):
            RefreshToken(refresh)
    user.refresh_from_db()
    assert user.check_password(reset_password)


def test_profile_create_edit_and_pause_keep_scheduled_resume_semantics(client, user):
    client.force_login(user)
    created = client.post(
        reverse("checkins:profile-create"),
        {"name": "Cesta", "interval_seconds": 240},
    )
    profile = CheckInProfile.objects.get(owner=user, name="Cesta")

    assert created.status_code == 302
    assert created.url == reverse("checkins:profile-detail", kwargs={"pk": profile.pk})

    edited = client.post(
        reverse("checkins:profile-edit", kwargs={"pk": profile.pk}),
        {"name": "Výlet", "interval_seconds": 61},
    )
    assert edited.status_code == 302
    profile.refresh_from_db()
    assert profile.name == "Výlet"
    assert profile.interval_seconds == 3_660

    edit_form = client.get(reverse("checkins:profile-edit", kwargs={"pk": profile.pk}))
    assert edit_form.status_code == 200
    assert 'value="61"' in edit_form.content.decode()

    paused_until = timezone.localtime() + timedelta(days=1)
    paused = client.post(
        reverse("checkins:profile-pause", kwargs={"pk": profile.pk}),
        {"paused_until": paused_until.strftime("%Y-%m-%dT%H:%M")},
    )
    assert paused.status_code == 302
    profile.refresh_from_db()
    assert profile.enabled is True
    assert profile.is_paused is True
    assert profile.paused_until is not None
    assert profile.next_deadline_at is None

    blocked_checkin = client.post(reverse("checkins:check-in", kwargs={"pk": profile.pk}))
    assert blocked_checkin.status_code == 302
    assert not profile.check_ins.exists()

    resumed = client.post(reverse("checkins:profile-pause", kwargs={"pk": profile.pk}))
    assert resumed.status_code == 302
    profile.refresh_from_db()
    assert profile.enabled is True
    assert profile.is_paused is False
    assert profile.paused_until is None
    assert profile.next_deadline_at is not None


def test_web_custom_pause_horizon_rejects_far_future_unchanged_and_accepts_boundary(
    client,
    user,
    profile,
    monkeypatch,
):
    client.force_login(user)
    server_now = timezone.now().replace(second=0, microsecond=0)
    monkeypatch.setattr(timezone, "now", lambda: server_now)
    endpoint = reverse("checkins:profile-pause", kwargs={"pk": profile.pk})
    original = {
        "enabled": profile.enabled,
        "is_paused": profile.is_paused,
        "paused_until": profile.paused_until,
        "next_deadline_at": profile.next_deadline_at,
        "deadline_generation": profile.deadline_generation,
    }
    too_far_local = timezone.localtime(server_now + timedelta(days=366, minutes=1))

    rejected = client.post(
        endpoint,
        {"paused_until": too_far_local.strftime("%Y-%m-%dT%H:%M")},
    )

    assert rejected.status_code == 200
    assert rejected.context["form"].errors["paused_until"] == [PAUSED_UNTIL_MAX_ERROR]
    profile.refresh_from_db()
    assert {
        "enabled": profile.enabled,
        "is_paused": profile.is_paused,
        "paused_until": profile.paused_until,
        "next_deadline_at": profile.next_deadline_at,
        "deadline_generation": profile.deadline_generation,
    } == original

    boundary_local = timezone.localtime(server_now + timedelta(days=366))
    accepted = client.post(
        endpoint,
        {"paused_until": boundary_local.strftime("%Y-%m-%dT%H:%M")},
    )
    assert accepted.status_code == 302
    profile.refresh_from_db()
    assert profile.is_paused is True
    assert profile.paused_until == server_now + timedelta(days=366)


def test_profile_limit_hides_create_ui_and_rejects_direct_sixth_post(client, user, profile):
    for number in range(2, 6):
        create_profile(owner=user, name=f"Profil {number}", interval_seconds=86_400)
    client.force_login(user)
    create_url = reverse("checkins:profile-create")

    dashboard = client.get(reverse("core:dashboard"))
    create_page = client.get(create_url)
    rejected = client.post(
        create_url,
        {"name": "Šestý profil", "interval_seconds": 1_440},
    )

    assert dashboard.status_code == create_page.status_code == rejected.status_code == 200
    assert 'data-testid="profile-limit-reached"' in dashboard.content.decode()
    assert "Vše zdarma, limit 5/5." in dashboard.content.decode()
    assert f'href="{create_url}"' not in dashboard.content.decode()
    assert 'data-testid="profile-limit-reached"' in create_page.content.decode()
    assert 'name="name"' not in create_page.content.decode()
    assert ">Vytvořit profil</button>" not in create_page.content.decode()
    assert rejected.context["form"].non_field_errors() == [
        "Vše je zdarma. Limit je 5/5 aktivních profilů na účet."
    ]
    assert CheckInProfile.objects.filter(owner=user, archived_at__isnull=True).count() == 5


def test_web_posts_require_csrf_and_checkin_is_idempotent(user, profile):
    client = Client(enforce_csrf_checks=True)
    client.force_login(user)
    endpoint = reverse("checkins:check-in", kwargs={"pk": profile.pk})

    assert client.post(endpoint).status_code == 403

    detail = client.get(reverse("checkins:profile-detail", kwargs={"pk": profile.pk}))
    token = detail.cookies["csrftoken"].value
    idempotency_key = detail.context["web_checkin_key"]
    first = client.post(
        endpoint,
        {"idempotency_key": idempotency_key},
        HTTP_X_CSRFTOKEN=token,
    )
    client.get(reverse("checkins:profile-detail", kwargs={"pk": profile.pk}))
    repeated = client.post(
        endpoint,
        {"idempotency_key": idempotency_key},
        HTTP_X_CSRFTOKEN=token,
    )

    assert first.status_code == 302
    assert repeated.status_code == 302
    assert CheckIn.objects.filter(profile=profile).count() == 1


def test_profile_and_guardian_mutations_prevent_idor(client, user, other_user, profile):
    membership = GuardianMembership.objects.create(profile=profile, guardian=other_user)
    client.force_login(other_user)

    assert (
        client.get(reverse("checkins:profile-detail", kwargs={"pk": profile.pk})).status_code == 404
    )
    assert client.post(reverse("checkins:check-in", kwargs={"pk": profile.pk})).status_code == 404
    assert client.post(reverse("guardians:remove", kwargs={"pk": membership.pk})).status_code == 404
    membership.refresh_from_db()
    assert membership.status == GuardianMembership.Status.ACTIVE


def test_invitation_response_requires_matching_email(client, user, other_user, profile):
    invitation = GuardianInvitation.objects.create(
        profile=profile,
        invited_by=user,
        email=other_user.email,
        token_digest="a" * 64,
        expires_at=timezone.now() + timedelta(days=1),
    )
    stranger = User.objects.create_user(
        email="stranger@example.cz", password="A-strong-password-123"
    )
    client.force_login(stranger)

    denied = client.post(
        reverse("guardians:respond", kwargs={"pk": invitation.pk}),
        {"decision": "accept"},
    )

    assert denied.status_code == 404
    assert not GuardianMembership.objects.filter(profile=profile, guardian=stranger).exists()


def test_guardian_limit_hides_invite_ui_and_rejects_direct_sixth_post(client, user, profile):
    for number in range(1, 6):
        guardian = User.objects.create_user(
            email=f"guardian-{number}@example.cz",
            password="A-strong-password-123",
        )
        GuardianMembership.objects.create(
            profile=profile,
            guardian=guardian,
            status=GuardianMembership.Status.ACTIVE,
        )
    client.force_login(user)
    invite_url = reverse("guardians:invite")

    guardians_page = client.get(reverse("guardians:list"))
    invite_page = client.get(invite_url)
    rejected = client.post(
        invite_url,
        {"profile": profile.pk, "email": "sixth-guardian@example.cz"},
    )

    assert guardians_page.status_code == invite_page.status_code == rejected.status_code == 200
    assert 'data-testid="guardian-limit-reached"' in guardians_page.content.decode()
    assert "Vše zdarma, limit 5/5." in guardians_page.content.decode()
    assert f'href="{invite_url}"' not in guardians_page.content.decode()
    assert 'data-testid="guardian-limit-reached"' in invite_page.content.decode()
    assert 'name="profile"' not in invite_page.content.decode()
    assert 'name="email"' not in invite_page.content.decode()
    assert ">Odeslat pozvánku</button>" not in invite_page.content.decode()
    assert rejected.context["form"].non_field_errors() == [
        "Vše je zdarma. Limit je 5/5 aktivních strážců na profil."
    ]
    assert not GuardianInvitation.objects.filter(email="sixth-guardian@example.cz").exists()


def test_guardian_invite_remains_available_when_another_profile_has_capacity(client, user, profile):
    for number in range(1, 6):
        guardian = User.objects.create_user(
            email=f"full-profile-guardian-{number}@example.cz",
            password="A-strong-password-123",
        )
        GuardianMembership.objects.create(
            profile=profile,
            guardian=guardian,
            status=GuardianMembership.Status.ACTIVE,
        )
    available_profile = create_profile(
        owner=user,
        name="Profil s místem",
        interval_seconds=86_400,
    )
    client.force_login(user)
    invite_url = reverse("guardians:invite")

    guardians_page = client.get(reverse("guardians:list"))
    invite_page = client.get(invite_url)
    offered_profile_ids = set(
        invite_page.context["form"].fields["profile"].queryset.values_list("pk", flat=True)
    )

    assert guardians_page.status_code == invite_page.status_code == 200
    assert 'data-testid="guardian-limit-reached"' not in guardians_page.content.decode()
    assert f'href="{invite_url}"' in guardians_page.content.decode()
    assert offered_profile_ids == {available_profile.pk}


def test_alert_detail_and_ack_require_current_recipient(client, user, other_user, profile):
    membership = GuardianMembership.objects.create(profile=profile, guardian=other_user)
    incident = AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=timezone.now() - timedelta(minutes=1),
    )
    AlertRecipient.objects.create(
        incident=incident,
        user=other_user,
        user_id_snapshot=other_user.pk,
    )
    stranger = User.objects.create_user(
        email="unrelated@example.cz", password="A-strong-password-123"
    )
    client.force_login(stranger)
    assert client.get(reverse("alerts:detail", kwargs={"pk": incident.pk})).status_code == 404

    client.force_login(other_user)
    assert client.get(reverse("alerts:detail", kwargs={"pk": incident.pk})).status_code == 200
    assert client.post(reverse("alerts:ack", kwargs={"pk": incident.pk})).status_code == 302
    assert AlertAcknowledgement.objects.filter(incident=incident, user=other_user).exists()

    membership.status = GuardianMembership.Status.REVOKED
    membership.save(update_fields=["status", "updated_at"])
    assert client.get(reverse("alerts:detail", kwargs={"pk": incident.pk})).status_code == 404

    client.force_login(user)
    owner_detail = client.get(reverse("alerts:detail", kwargs={"pk": incident.pk}))
    owner_ack = client.post(reverse("alerts:ack", kwargs={"pk": incident.pk}))
    assert owner_detail.status_code == 200
    assert "Viděl/a jsem incident" not in owner_detail.content.decode()
    assert owner_ack.status_code == 403
    assert not AlertAcknowledgement.objects.filter(incident=incident, user=user).exists()


@override_settings(GUARDIAN_LOCATION_DISCLOSURE_ENABLED=False)
def test_web_location_disclosure_switch_suppresses_guardian_only(client, user, other_user, profile):
    GuardianMembership.objects.create(profile=profile, guardian=other_user)
    check_in = perform_check_in(
        profile=profile,
        idempotency_key="web-location-switch-source",
        latitude="50.075500",
        longitude="14.437800",
    ).check_in
    profile.refresh_from_db()
    profile.next_deadline_at = timezone.now() - timedelta(minutes=1)
    profile.save(update_fields=["next_deadline_at", "updated_at"])
    assert sweep_expired_deadlines() == (1, 1)
    incident = AlertIncident.objects.get(profile=profile)

    client.force_login(other_user)
    guardian_detail = client.get(reverse("alerts:detail", kwargs={"pk": incident.pk}))
    assert guardian_detail.status_code == 200
    assert guardian_detail.context["alert"].last_checkin is None
    assert "Otevřít poslední známou polohu" not in guardian_detail.content.decode()
    assert "Sdílení polohy se strážci je dočasně pozastavené" in guardian_detail.content.decode()

    client.force_login(user)
    owner_detail = client.get(reverse("alerts:detail", kwargs={"pk": incident.pk}))
    assert owner_detail.status_code == 200
    assert owner_detail.context["alert"].last_checkin.pk == check_in.pk
    assert "Otevřít poslední známou polohu" in owner_detail.content.decode()
    assert "Sdílení polohy se strážci je dočasně pozastavené" not in owner_detail.content.decode()

    perform_check_in(profile=profile, idempotency_key="web-location-switch-resolver")
    incident.refresh_from_db()
    assert incident.status == AlertIncident.Status.RESOLVED

    resolved_owner_detail = client.get(reverse("alerts:detail", kwargs={"pk": incident.pk}))
    assert resolved_owner_detail.status_code == 200
    assert resolved_owner_detail.context["alert"].last_checkin is None
    assert "Otevřít poslední známou polohu" not in resolved_owner_detail.content.decode()


def test_history_filter_cannot_select_another_users_profile(client, user, other_user, profile):
    other_profile = create_profile(owner=other_user, name="Cizí", interval_seconds=86_400)
    client.force_login(user)

    response = client.get(reverse("checkins:history"), {"profile": other_profile.pk})

    assert response.status_code == 404


def test_history_statistics_separate_on_time_checkins_and_incidents(client, user, profile):
    on_time = CheckIn.objects.create(
        profile=profile,
        idempotency_key="on-time",
        deadline_generation=profile.deadline_generation,
    )
    late = CheckIn.objects.create(
        profile=profile,
        idempotency_key="late",
        deadline_generation=profile.deadline_generation + 1,
    )
    AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=timezone.now() - timedelta(minutes=1),
        status=AlertIncident.Status.RESOLVED,
        resolved_at=timezone.now(),
        resolved_by_check_in=late,
    )
    client.force_login(user)

    response = client.get(reverse("checkins:history"), {"profile": profile.pk})

    assert response.status_code == 200
    assert response.context["stats"]["total_checkins"] == 2
    assert response.context["stats"]["on_time_checkins"] == 1
    assert response.context["stats"]["incident_count"] == 1
    assert on_time.resolved_incidents.count() == 0


def test_gdpr_export_is_json_scoped_and_omits_operational_secrets(
    client, api_client, user, other_user, profile
):
    own_checkin = CheckIn.objects.create(
        profile=profile,
        idempotency_key="own",
        deadline_generation=profile.deadline_generation,
    )
    other_profile = create_profile(owner=other_user, name="Cizí", interval_seconds=86_400)
    CheckIn.objects.create(
        profile=other_profile,
        idempotency_key="other",
        deadline_generation=other_profile.deadline_generation,
    )
    own_incident = AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=timezone.now() - timedelta(hours=2),
        status=AlertIncident.Status.RESOLVED,
        resolved_at=timezone.now() - timedelta(hours=1),
    )
    foreign_incident = AlertIncident.objects.create(
        profile=other_profile,
        deadline_generation=other_profile.deadline_generation,
        deadline_at=timezone.now() - timedelta(hours=2),
        status=AlertIncident.Status.RESOLVED,
        resolved_at=timezone.now() - timedelta(hours=1),
    )
    own_acknowledgement = AlertAcknowledgement.objects.create(
        incident=own_incident,
        user=user,
    )
    foreign_acknowledgement = AlertAcknowledgement.objects.create(
        incident=foreign_incident,
        user=other_user,
    )
    PushDevice.objects.create(
        user=user,
        installation_id=uuid.uuid4(),
        expo_push_token="ExponentPushToken[sensitive]",
        platform=PushDevice.Platform.IOS,
    )
    client.force_login(user)

    web_response = client.post(reverse("accounts:export"), {"confirmation": "on"})
    web_payload = json.loads(web_response.content)
    api_client.force_authenticate(user=user)
    with override_settings(ROOT_URLCONF="config.urls"):
        api_response = api_client.get("/api/v1/account/export/")
    api_payload = api_response.json()

    assert web_response.status_code == api_response.status_code == 200
    assert web_response["Content-Type"].startswith("application/json")
    assert web_response["Cache-Control"] == api_response["Cache-Control"] == "no-store"
    assert web_payload["account"]["email"] == user.email
    assert [item["id"] for item in web_payload["check_ins"]] == [str(own_checkin.pk)]
    assert [item["id"] for item in web_payload["alert_acknowledgements"]] == [
        str(own_acknowledgement.pk)
    ]
    assert web_payload["alert_acknowledgements"][0]["user_id"] == str(
        own_acknowledgement.user_id_snapshot
    )
    assert str(other_profile.pk) not in web_response.content.decode()
    assert str(foreign_acknowledgement.pk) not in web_response.content.decode()
    assert "ExponentPushToken" not in web_response.content.decode()
    assert "token_digest" not in web_response.content.decode()
    assert web_payload.pop("exported_at")
    assert api_payload.pop("exported_at")
    assert web_payload == api_payload


def test_account_delete_requires_exact_confirmation_and_removes_owned_data(
    client, user, other_user, profile
):
    deleted_user_id = user.pk
    watched_profile = create_profile(owner=other_user, name="Sledovaný", interval_seconds=86_400)
    membership = GuardianMembership.objects.create(profile=watched_profile, guardian=user)
    incident = AlertIncident.objects.create(
        profile=watched_profile,
        deadline_generation=watched_profile.deadline_generation,
        deadline_at=timezone.now() - timedelta(minutes=1),
    )
    recipient = AlertRecipient.objects.create(
        incident=incident,
        user=user,
        user_id_snapshot=user.pk,
    )
    acknowledgement = AlertAcknowledgement.objects.create(
        incident=incident,
        user=user,
    )
    event = OutboxEvent.objects.create(
        event_type="alert.opened",
        aggregate_type="alert_incident",
        aggregate_id=incident.pk,
        deduplication_key=f"web-delete-test:{incident.pk}",
        payload={"recipient_user_ids": [str(user.pk)]},
    )
    incoming = GuardianInvitation.objects.create(
        profile=watched_profile,
        invited_by=other_user,
        email=user.email,
        token_digest="b" * 64,
        expires_at=timezone.now() + timedelta(days=1),
    )
    client.force_login(user)
    endpoint = reverse("accounts:delete")

    rejected = client.post(
        endpoint,
        {
            "password": "Safely-testing-123",
            "confirmation": "smazat",
            "understood": "on",
        },
    )
    assert rejected.status_code == 200
    assert User.objects.filter(pk=user.pk).exists()

    wrong_password = client.post(
        endpoint,
        {
            "password": "Incorrect-password",
            "confirmation": "SMAZAT",
            "understood": "on",
        },
    )
    assert wrong_password.status_code == 200
    assert User.objects.filter(pk=user.pk).exists()

    deleted = client.post(
        endpoint,
        {
            "password": "Safely-testing-123",
            "confirmation": "SMAZAT",
            "understood": "on",
        },
    )

    assert deleted.status_code == 302
    assert deleted.url == reverse("core:landing")
    assert not User.objects.filter(pk=deleted_user_id).exists()
    assert not CheckInProfile.objects.filter(pk=profile.pk).exists()
    assert not GuardianMembership.objects.filter(pk=membership.pk).exists()
    incident.refresh_from_db()
    assert incident.status == AlertIncident.Status.OPEN
    assert incident.resolved_at is None
    recipient.refresh_from_db()
    assert recipient.user_id is None
    assert recipient.user_id_snapshot != deleted_user_id
    acknowledgement.refresh_from_db()
    assert acknowledgement.user_id is None
    assert acknowledgement.user_id_snapshot != deleted_user_id
    event.refresh_from_db()
    assert str(deleted_user_id) not in event.payload["recipient_user_ids"]
    incoming.refresh_from_db()
    assert incoming.status == GuardianInvitation.Status.REVOKED
    assert incoming.email.endswith("@invalid.local")
    assert "_auth_user_id" not in client.session
    client.force_login(other_user)
    incident_detail = client.get(reverse("alerts:detail", kwargs={"pk": incident.pk}))
    assert incident_detail.status_code == 200
    assert "Smazaný strážce" in incident_detail.content.decode()


def test_guardian_only_dashboard_shows_watched_profile_and_open_incident(
    client, user, other_user, profile
):
    membership = GuardianMembership.objects.create(profile=profile, guardian=other_user)
    incident = AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=timezone.now() - timedelta(minutes=1),
    )
    AlertRecipient.objects.create(
        incident=incident,
        user=other_user,
        user_id_snapshot=other_user.pk,
    )
    client.force_login(other_user)

    response = client.get(reverse("core:dashboard"))

    content = response.content.decode()
    assert response.status_code == 200
    assert "Profily, které hlídáte" in content
    assert profile.name in content
    assert reverse("alerts:detail", kwargs={"pk": incident.pk}) in content
    assert membership.profile_id == profile.pk


def test_guardian_self_revoke_immediately_removes_incident_access(
    client, user, other_user, profile
):
    membership = GuardianMembership.objects.create(profile=profile, guardian=other_user)
    incident = AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=timezone.now() - timedelta(minutes=1),
    )
    AlertRecipient.objects.create(
        incident=incident,
        user=other_user,
        user_id_snapshot=other_user.pk,
    )
    client.force_login(other_user)

    revoked = client.post(reverse("guardians:self-revoke", kwargs={"pk": membership.pk}))

    assert revoked.status_code == 302
    membership.refresh_from_db()
    assert membership.status == GuardianMembership.Status.REVOKED
    assert client.get(reverse("alerts:detail", kwargs={"pk": incident.pk})).status_code == 404


def test_owner_can_revoke_pending_invitation_but_another_user_cannot(
    client, user, other_user, profile
):
    invitation = GuardianInvitation.objects.create(
        profile=profile,
        invited_by=user,
        email=other_user.email,
        token_digest="f" * 64,
        expires_at=timezone.now() + timedelta(days=1),
    )
    endpoint = reverse("guardians:invite-revoke", kwargs={"pk": invitation.pk})
    client.force_login(other_user)
    assert client.post(endpoint).status_code == 404

    client.force_login(user)
    revoked = client.post(endpoint)

    assert revoked.status_code == 302
    invitation.refresh_from_db()
    assert invitation.status == GuardianInvitation.Status.REVOKED


def test_browser_checkin_location_is_one_shot_optional_and_validated(client, user, profile):
    client.force_login(user)
    endpoint = reverse("checkins:check-in", kwargs={"pk": profile.pk})
    detail_url = reverse("checkins:profile-detail", kwargs={"pk": profile.pk})
    first_key = client.get(detail_url).context["web_checkin_key"]

    with_location = client.post(
        endpoint,
        {
            "idempotency_key": first_key,
            "location_requested": "on",
            "latitude": "50.075500",
            "longitude": "14.437800",
            "location_accuracy_meters": "12.50",
        },
    )
    first = CheckIn.objects.get(profile=profile)
    assert with_location.status_code == 302
    assert str(first.latitude) == "50.075500"
    assert str(first.longitude) == "14.437800"

    second_key = client.get(detail_url).context["web_checkin_key"]
    without_available_location = client.post(
        endpoint,
        {"idempotency_key": second_key, "location_requested": "on"},
    )
    assert without_available_location.status_code == 302
    second = CheckIn.objects.filter(profile=profile).latest("accepted_at")
    assert second.pk != first.pk
    assert second.latitude is None

    third_key = client.get(detail_url).context["web_checkin_key"]
    malformed = client.post(
        endpoint,
        {"idempotency_key": third_key, "latitude": "50.075500"},
    )
    assert malformed.status_code == 302
    assert CheckIn.objects.filter(profile=profile).count() == 2


def test_owner_can_delete_checkin_location_without_deleting_historical_checkin(
    client, user, other_user, profile
):
    checkin = perform_check_in(
        profile=profile,
        idempotency_key="web-location-retention",
        latitude="50.075500",
        longitude="14.437800",
        location_accuracy_meters="8.50",
    ).check_in
    endpoint = reverse("checkins:check-in-location-delete", kwargs={"pk": checkin.pk})
    client.force_login(other_user)
    assert client.post(endpoint).status_code == 404

    client.force_login(user)
    deleted = client.post(endpoint)

    assert deleted.status_code == 302
    checkin.refresh_from_db()
    assert checkin.latitude is None
    assert checkin.longitude is None
    assert checkin.location_accuracy_meters is None
    assert CheckIn.objects.filter(pk=checkin.pk).exists()


def test_combined_timeline_labels_queue_pause_and_incident_without_coordinates(
    client, user, profile
):
    perform_check_in(profile=profile, idempotency_key="timeline-direct")
    perform_check_in(
        profile=profile,
        idempotency_key="timeline-queued",
        submitted_from_queue=True,
        latitude="50.075500",
        longitude="14.437800",
    )
    profile.refresh_from_db()
    profile.next_deadline_at = timezone.now() - timedelta(minutes=1)
    profile.save(update_fields=["next_deadline_at", "updated_at"])
    assert sweep_expired_deadlines() == (1, 1)
    perform_check_in(profile=profile, idempotency_key="timeline-resolver")
    profile.refresh_from_db()
    update_profile(profile=profile, values={"is_paused": True})
    profile.refresh_from_db()
    update_profile(profile=profile, values={"is_paused": False})
    client.force_login(user)

    response = client.get(reverse("checkins:history"), {"profile": profile.pk})

    content = response.content.decode()
    assert response.status_code == 200
    assert response["Cache-Control"] == "no-store, private"
    assert "Synchronizováno později" in content
    assert "Profil pozastaven" in content
    assert "Hlídání obnoveno" in content
    assert "Vznikl incident" in content
    assert "Incident vyřešen ohlášením" in content
    assert "50.075500" not in content
    assert "14.437800" not in content


def test_alert_detail_distinguishes_provider_ticket_and_acknowledgement(
    client, user, other_user, profile
):
    GuardianMembership.objects.create(profile=profile, guardian=other_user)
    incident = AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=timezone.now() - timedelta(minutes=1),
    )
    AlertRecipient.objects.create(
        incident=incident,
        user=other_user,
        user_id_snapshot=other_user.pk,
    )
    device = PushDevice.objects.create(
        user=other_user,
        installation_id=uuid.uuid4(),
        expo_push_token="ExponentPushToken[web-delivery-state]",
        platform=PushDevice.Platform.ANDROID,
    )
    DeliveryAttempt.objects.create(
        incident=incident,
        device=device,
        device_id_snapshot=device.pk,
        status=DeliveryAttempt.Status.TICKET_RECEIVED,
    )
    client.force_login(other_user)
    client.post(reverse("alerts:ack", kwargs={"pk": incident.pk}))

    response = client.get(reverse("alerts:detail", kwargs={"pk": incident.pk}))

    content = response.content.decode()
    assert response.status_code == 200
    assert response["Cache-Control"] == "no-store, private"
    assert "Odesláno poskytovateli, doručení nepotvrzeno" in content
    assert "Poskytovatel potvrdil doručení" not in content
    assert "Eva Jiná" in content
    assert "Incident viděn v aplikaci" in content
    assert (
        "Neznamená kontakt, zásah, převzetí odpovědnosti, doručení push oznámení ani bezpečí"
        in content
    )
    assert "taken responsibility" not in content


def test_successful_push_receipt_never_claims_device_delivery(client, profile, other_user):
    GuardianMembership.objects.create(profile=profile, guardian=other_user)
    incident = AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=timezone.now() - timedelta(minutes=1),
    )
    AlertRecipient.objects.create(
        incident=incident,
        user=other_user,
        user_id_snapshot=other_user.pk,
    )
    device = PushDevice.objects.create(
        user=other_user,
        installation_id=uuid.uuid4(),
        expo_push_token="ExponentPushToken[web-receipt-truth]",
        platform=PushDevice.Platform.IOS,
    )
    DeliveryAttempt.objects.create(
        incident=incident,
        device=device,
        device_id_snapshot=device.id,
        status=DeliveryAttempt.Status.PROVIDER_ACCEPTED,
    )
    client.force_login(other_user)

    content = client.get(reverse("alerts:detail", kwargs={"pk": incident.pk})).content.decode()

    assert "Přijato službou APNs/FCM, doručení zařízení nepotvrzeno" in content
    assert "Doručeno alespoň" not in content
    assert "potvrdil doručení" not in content


@pytest.mark.parametrize("route_name", ["core:privacy", "core:terms"])
def test_legal_placeholders_are_explicit_non_indexable_release_blockers(client, route_name):
    response = client.get(reverse(route_name))

    assert response.status_code == 503
    assert response["Cache-Control"] == "no-store"
    assert response["X-Robots-Tag"] == "noindex, nofollow"
    assert "Blokuje veřejné vydání" in response.content.decode()


def test_account_deletion_instructions_are_public_without_exposing_account_data(client):
    response = client.get(reverse("accounts:delete"))

    assert response.status_code == 200
    assert response["Cache-Control"] == "no-store"
    content = response.content.decode()
    assert "Přihlásit se a smazat účet" in content
    assert reverse("accounts:login") in content
    assert "potvrďte smazání svým heslem" in content


def test_anonymous_account_deletion_post_requires_login(client):
    response = client.post(reverse("accounts:delete"), {"password": "never-used"})

    assert response.status_code == 302
    assert response.url == (f"{reverse('accounts:login')}?next={reverse('accounts:delete')}")
