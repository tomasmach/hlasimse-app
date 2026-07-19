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

from core.models import (
    AlertAcknowledgement,
    AlertIncident,
    AlertRecipient,
    CheckIn,
    CheckInProfile,
    GuardianInvitation,
    GuardianMembership,
    OutboxEvent,
    PushDevice,
    User,
)
from core.services import create_profile

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
    assert client.get(reverse("core:landing")).status_code == 200
    assert client.get(reverse("accounts:login")).status_code == 200
    assert client.get(reverse("accounts:register")).status_code == 200

    response = client.get(reverse("core:dashboard"))

    assert response.status_code == 302
    assert reverse("accounts:login") in response.url


def test_registration_creates_session_and_requires_terms(client):
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
    assert created.url == reverse("checkins:profile-create")
    assert "_auth_user_id" in client.session


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


def test_profile_create_edit_and_pause_keep_scheduled_resume_semantics(client, user):
    client.force_login(user)
    created = client.post(
        reverse("checkins:profile-create"),
        {"name": "Cesta", "interval_seconds": 14_400},
    )
    profile = CheckInProfile.objects.get(owner=user, name="Cesta")

    assert created.status_code == 302
    assert created.url == reverse("checkins:profile-detail", kwargs={"pk": profile.pk})

    edited = client.post(
        reverse("checkins:profile-edit", kwargs={"pk": profile.pk}),
        {"name": "Výlet", "interval_seconds": 28_800},
    )
    assert edited.status_code == 302
    profile.refresh_from_db()
    assert profile.name == "Výlet"
    assert profile.interval_seconds == 28_800

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


def test_web_posts_require_csrf_and_checkin_is_idempotent(user, profile):
    client = Client(enforce_csrf_checks=True)
    client.force_login(user)
    endpoint = reverse("checkins:check-in", kwargs={"pk": profile.pk})

    assert client.post(endpoint).status_code == 403

    detail = client.get(reverse("checkins:profile-detail", kwargs={"pk": profile.pk}))
    token = detail.cookies["csrftoken"].value
    first = client.post(endpoint, HTTP_X_CSRFTOKEN=token)
    repeated = client.post(endpoint, HTTP_X_CSRFTOKEN=token)

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
    client, user, other_user, profile
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
    PushDevice.objects.create(
        user=user,
        installation_id=uuid.uuid4(),
        expo_push_token="ExponentPushToken[sensitive]",
        platform=PushDevice.Platform.IOS,
    )
    client.force_login(user)

    response = client.post(reverse("accounts:export"), {"confirmation": "on"})
    payload = json.loads(response.content)

    assert response.status_code == 200
    assert response["Content-Type"].startswith("application/json")
    assert response["Cache-Control"] == "no-store"
    assert payload["account"]["email"] == user.email
    assert [item["id"] for item in payload["check_ins"]] == [str(own_checkin.pk)]
    assert str(other_profile.pk) not in response.content.decode()
    assert "ExponentPushToken" not in response.content.decode()
    assert "token_digest" not in response.content.decode()


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

    blocked = client.post(
        endpoint,
        {
            "password": "Safely-testing-123",
            "confirmation": "SMAZAT",
            "understood": "on",
        },
    )
    assert blocked.status_code == 200
    assert "aktivního incidentu" in blocked.content.decode()
    assert User.objects.filter(pk=user.pk).exists()

    incident.status = AlertIncident.Status.RESOLVED
    incident.resolved_at = timezone.now()
    incident.save(update_fields=["status", "resolved_at", "updated_at"])
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
    recipient.refresh_from_db()
    assert recipient.user_id is None
    assert recipient.user_id_snapshot != deleted_user_id
    event.refresh_from_db()
    assert str(deleted_user_id) not in event.payload["recipient_user_ids"]
    incoming.refresh_from_db()
    assert incoming.status == GuardianInvitation.Status.REVOKED
    assert incoming.email.endswith("@invalid.local")
    assert "_auth_user_id" not in client.session
