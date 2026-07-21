import json
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib import messages
from django.contrib.auth import logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import PasswordResetForm
from django.contrib.auth.mixins import LoginRequiredMixin
from django.contrib.auth.tokens import default_token_generator
from django.contrib.auth.views import (
    LoginView,
    LogoutView,
    PasswordResetCompleteView,
    PasswordResetConfirmView,
    PasswordResetDoneView,
    PasswordResetView,
)
from django.core.exceptions import PermissionDenied, ValidationError
from django.core.mail import send_mail
from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Count, Max, Q
from django.db.models.functions import TruncDate
from django.http import Http404, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse, reverse_lazy
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from django.views.decorators.http import require_POST
from django.views.generic import TemplateView
from rest_framework.utils.encoders import JSONEncoder

from .account_data import (
    AccountDeletionBlocked,
    AccountPasswordInvalid,
    build_account_export,
    delete_account_safely,
)
from .email_verification import (
    register_unverified_user,
    resend_verification,
    verify_signed_token,
)
from .forms import (
    AccountSettingsForm,
    BrowserCheckInForm,
    CheckInProfileForm,
    DeleteAccountForm,
    EmailVerificationResendForm,
    ExportDataForm,
    GuardianInvitationForm,
    LoginForm,
    PauseProfileForm,
    RegisterForm,
)
from .models import (
    AlertAcknowledgement,
    AlertIncident,
    AuditEvent,
    CheckIn,
    CheckInProfile,
    GuardianInvitation,
    GuardianMembership,
    PushDevice,
    User,
)
from .password_reset import revoke_outstanding_refresh_tokens
from .services import (
    MAX_GUARDIANS_PER_PROFILE,
    MAX_PROFILES_PER_USER,
    accessible_incidents,
    can_acknowledge_incident,
    create_invitation,
    create_profile,
    delete_check_in_location,
    perform_check_in,
    respond_to_invitation,
    revoke_guardian_membership,
    revoke_invitation,
    update_profile,
)
from .web_rate_limits import WebAuthRateLimitMixin, web_auth_rate_limit


class LandingView(TemplateView):
    template_name = "core/landing.html"


def legal_release_blocker_view(request, document):
    if document not in {"privacy", "terms"}:
        raise Http404
    response = render(
        request,
        "core/legal_release_blocker.html",
        {"document": document},
        status=503,
    )
    response["Cache-Control"] = "no-store"
    response["Retry-After"] = "86400"
    response["X-Robots-Tag"] = "noindex, nofollow"
    return response


def support_view(request):
    return render(request, "core/support.html")


class SessionLoginView(WebAuthRateLimitMixin, LoginView):
    authentication_form = LoginForm
    template_name = "core/auth/login.html"
    redirect_authenticated_user = True
    rate_limit_scope = "login"
    rate_limit_identity_field = "username"

    def form_valid(self, form):
        response = super().form_valid(form)
        if not self.request.POST.get("remember_me"):
            self.request.session.set_expiry(0)
        return response

    def get_success_url(self):
        return self.get_redirect_url() or reverse("core:dashboard")


class SessionLogoutView(LogoutView):
    next_page = reverse_lazy("core:landing")
    http_method_names = ("post", "options")


class SecurePasswordResetView(WebAuthRateLimitMixin, PasswordResetView):
    template_name = "core/auth/forgot_password.html"
    form_class = PasswordResetForm
    success_url = reverse_lazy("accounts:password_reset_done")
    rate_limit_scope = "password_reset_request"
    rate_limit_identity_field = "email"

    def form_valid(self, form):
        email = form.cleaned_data["email"]
        for user in form.get_users(email):
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            reset_path = reverse(
                "accounts:password_reset_confirm",
                kwargs={"uidb64": uid, "token": token},
            )
            reset_url = self.request.build_absolute_uri(reset_path)
            send_mail(
                "Obnova hesla pro Hlásím se",
                (
                    "Obdrželi jsme žádost o změnu hesla k vašemu účtu Hlásím se.\n\n"
                    f"Nové heslo nastavíte zde: {reset_url}\n\n"
                    "Pokud jste o změnu nežádali, tento e-mail ignorujte."
                ),
                getattr(settings, "DEFAULT_FROM_EMAIL", None),
                [user.email],
            )
        return redirect(self.success_url)


class SecurePasswordResetDoneView(PasswordResetDoneView):
    template_name = "core/auth/password_reset_done.html"


class SecurePasswordResetConfirmView(WebAuthRateLimitMixin, PasswordResetConfirmView):
    template_name = "core/auth/password_reset_confirm.html"
    success_url = reverse_lazy("accounts:password_reset_complete")
    rate_limit_scope = "password_reset_confirm"

    def form_valid(self, form):
        with transaction.atomic():
            response = super().form_valid(form)
            revoke_outstanding_refresh_tokens(user=form.user)
        return response


class SecurePasswordResetCompleteView(PasswordResetCompleteView):
    template_name = "core/auth/password_reset_complete.html"


@web_auth_rate_limit(
    "registration",
    identity=lambda request, _args, _kwargs: request.POST.get("email"),
)
def register_view(request):
    if request.user.is_authenticated:
        return redirect("core:dashboard")
    form = RegisterForm(request.POST if request.method == "POST" else None)
    if request.method == "POST" and form.is_valid():
        register_unverified_user(
            email=form.cleaned_data["email"],
            password=form.cleaned_data["password1"],
            terms_accepted=True,
            first_name=form.cleaned_data["first_name"],
            last_name=form.cleaned_data["last_name"],
        )
        return redirect("accounts:verification-sent")
    return render(request, "core/auth/register.html", {"form": form})


def verification_sent_view(request):
    return render(request, "core/auth/verification_sent.html")


@web_auth_rate_limit(
    "verification_resend",
    identity=lambda request, _args, _kwargs: request.POST.get("email"),
)
def resend_verification_view(request):
    form = EmailVerificationResendForm(request.POST if request.method == "POST" else None)
    if request.method == "POST" and form.is_valid():
        resend_verification(email=form.cleaned_data["email"])
        return redirect("accounts:verification-sent")
    return render(request, "core/auth/resend_verification.html", {"form": form})


def stage_email_verification_view(request, token):
    if request.method != "GET":
        return HttpResponse(status=405)
    request.session.cycle_key()
    request.session.pop("pending_email_verification_token", None)
    request.session.pop("pending_email_verification_staged_at", None)
    if len(token) <= 1024:
        request.session["pending_email_verification_token"] = token
        request.session["pending_email_verification_staged_at"] = timezone.now().timestamp()
    response = redirect("accounts:verify-email-confirm")
    response["Cache-Control"] = "no-store"
    response["Referrer-Policy"] = "no-referrer"
    return response


@web_auth_rate_limit("verification_confirm")
def confirm_email_verification_view(request):
    token = request.session.get("pending_email_verification_token", "")
    staged_at = request.session.get("pending_email_verification_staged_at", 0)
    staged_age = (
        timezone.now().timestamp() - staged_at if isinstance(staged_at, int | float) else -1
    )
    staged_recently = 0 <= staged_age <= 15 * 60
    if request.method == "POST":
        request.session.pop("pending_email_verification_token", None)
        request.session.pop("pending_email_verification_staged_at", None)
        result = verify_signed_token(token) if token and staged_recently else None
        status = result.status if result is not None else "invalid"
    else:
        status = "confirmation_required" if token and staged_recently else "invalid"
    response = render(
        request,
        "core/auth/verify_email_result.html",
        {"verification_status": status},
        status=200,
    )
    response["Cache-Control"] = "no-store"
    response["Referrer-Policy"] = "no-referrer"
    return response


def _notification_health(profiles):
    memberships = GuardianMembership.objects.filter(
        profile__in=profiles,
        status=GuardianMembership.Status.ACTIVE,
    )
    guardian_ids = memberships.values_list("guardian_id", flat=True).distinct()
    guardian_count = guardian_ids.count()
    ready_count = (
        PushDevice.objects.filter(user_id__in=guardian_ids, active=True)
        .values("user_id")
        .distinct()
        .count()
    )
    return {
        "ok": guardian_count > 0 and ready_count == guardian_count,
        "guardian_count": guardian_count,
        "ready_guardian_count": ready_count,
    }


def _display_name(user, fallback="Uživatel"):
    if user is None:
        return fallback
    return " ".join(part for part in (user.first_name, user.last_name) if part).strip() or fallback


class DashboardView(LoginRequiredMixin, TemplateView):
    template_name = "core/dashboard/home.html"
    login_url = reverse_lazy("accounts:login")

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        profiles = list(
            CheckInProfile.objects.filter(
                owner=self.request.user,
                archived_at__isnull=True,
            ).order_by("created_at")
        )
        for profile in profiles:
            profile.enabled = profile.enabled and not profile.is_paused
        checkins = CheckIn.objects.filter(profile__owner=self.request.user).select_related(
            "profile"
        )[:8]
        active_alert = (
            accessible_incidents(self.request.user)
            .filter(status=AlertIncident.Status.OPEN)
            .select_related("profile")
            .order_by("-opened_at")
            .first()
        )
        watched_memberships = list(
            GuardianMembership.objects.filter(
                guardian=self.request.user,
                status=GuardianMembership.Status.ACTIVE,
                profile__archived_at__isnull=True,
            )
            .select_related("profile", "profile__owner")
            .order_by("profile__name")
        )
        open_incidents = {
            incident.profile_id: incident
            for incident in accessible_incidents(self.request.user)
            .filter(
                status=AlertIncident.Status.OPEN,
                profile_id__in=[item.profile_id for item in watched_memberships],
            )
            .select_related("profile")
        }
        for membership in watched_memberships:
            membership.open_incident = open_incidents.get(membership.profile_id)
            membership.owner_display_name = _display_name(membership.profile.owner)
        context.update(
            {
                "profiles": profiles,
                "checkins": checkins,
                "active_alert": active_alert,
                "watched_memberships": watched_memberships,
                "notification_health": _notification_health(profiles),
                "profile_limit_reached": len(profiles) >= MAX_PROFILES_PER_USER,
            }
        )
        return context


def _add_validation_error(form, error):
    if hasattr(error, "error_dict"):
        for field, errors in error.error_dict.items():
            target = field if field in form.fields else None
            for item in errors:
                form.add_error(target, item)
        return
    for message in getattr(error, "messages", [str(error)]):
        form.add_error(None, message)


@login_required(login_url="accounts:login")
def profile_create_view(request):
    form = CheckInProfileForm(request.POST if request.method == "POST" else None)
    limit_reached = (
        request.method == "GET"
        and CheckInProfile.objects.filter(
            owner=request.user,
            archived_at__isnull=True,
        ).count()
        >= MAX_PROFILES_PER_USER
    )
    if request.method == "POST" and form.is_valid():
        try:
            profile = create_profile(owner=request.user, **form.cleaned_data)
        except ValidationError as error:
            _add_validation_error(form, error)
        else:
            messages.success(request, "Profil byl vytvořen.")
            return redirect("checkins:profile-detail", pk=profile.pk)
    return render(
        request,
        "core/dashboard/profile_form.html",
        {"form": form, "profile": None, "limit_reached": limit_reached},
    )


@login_required(login_url="accounts:login")
def profile_edit_view(request, pk):
    profile = get_object_or_404(
        CheckInProfile,
        pk=pk,
        owner=request.user,
        archived_at__isnull=True,
    )
    form = CheckInProfileForm(
        request.POST if request.method == "POST" else None,
        instance=profile,
    )
    if request.method == "POST" and form.is_valid():
        try:
            profile = update_profile(profile=profile, values=form.cleaned_data)
        except ValidationError as error:
            _add_validation_error(form, error)
        else:
            messages.success(request, "Profil byl upraven.")
            return redirect("checkins:profile-detail", pk=profile.pk)
    return render(
        request,
        "core/dashboard/profile_form.html",
        {"form": form, "profile": profile},
    )


def _interval_label(seconds):
    if seconds % 86_400 == 0:
        days = seconds // 86_400
        return "24 hodin" if days == 1 else f"{days} dny"
    hours = seconds // 3_600
    return "1 hodina" if hours == 1 else f"{hours} hodin"


@login_required(login_url="accounts:login")
def profile_detail_view(request, pk):
    profile = get_object_or_404(
        CheckInProfile,
        pk=pk,
        owner=request.user,
        archived_at__isnull=True,
    )
    profile.interval_label = _interval_label(profile.interval_seconds)
    session_keys = request.session.get("web_checkin_keys", {})
    profile_key = str(profile.pk)
    existing_keys = session_keys.get(profile_key, [])
    if isinstance(existing_keys, str):
        existing_keys = [existing_keys]
    if not isinstance(existing_keys, list):
        existing_keys = []
    web_checkin_key = uuid.uuid4().hex
    session_keys[profile_key] = [
        *[key for key in existing_keys if isinstance(key, str)],
        web_checkin_key,
    ][-8:]
    request.session["web_checkin_keys"] = session_keys
    guardians = profile.guardians.filter(status=GuardianMembership.Status.ACTIVE).select_related(
        "guardian"
    )
    for membership in guardians:
        membership.guardian_display_name = _display_name(
            membership.guardian, membership.guardian.email
        )
    checkins = profile.check_ins.all()
    profile.enabled = profile.enabled and not profile.is_paused
    return render(
        request,
        "core/dashboard/profile_detail.html",
        {
            "profile": profile,
            "guardians": guardians,
            "checkins": checkins[:10],
            "stats": {"total_checkins": checkins.count()},
            "web_checkin_key": web_checkin_key,
        },
    )


@require_POST
@login_required(login_url="accounts:login")
def check_in_view(request, pk):
    profile = get_object_or_404(
        CheckInProfile,
        pk=pk,
        owner=request.user,
        archived_at__isnull=True,
    )
    if profile.is_paused:
        messages.error(request, "Pozastavený profil je nutné před ohlášením obnovit.")
        return redirect("checkins:profile-detail", pk=profile.pk)
    form = BrowserCheckInForm(request.POST)
    if not form.is_valid():
        messages.error(request, "Poloha nebyla platná. Ohlášení nebylo odesláno.")
        return redirect("checkins:profile-detail", pk=profile.pk)
    session_keys = request.session.get("web_checkin_keys", {})
    allowed_keys = session_keys.get(str(profile.pk), [])
    if isinstance(allowed_keys, str):
        allowed_keys = [allowed_keys]
    idempotency_key = form.cleaned_data["idempotency_key"]
    if not isinstance(allowed_keys, list) or idempotency_key not in allowed_keys:
        messages.error(
            request,
            "Platnost formuláře ohlášení nelze ověřit. Obnovte detail profilu a zkuste to znovu.",
        )
        return redirect("checkins:profile-detail", pk=profile.pk)
    try:
        result = perform_check_in(
            profile=profile,
            idempotency_key=f"web:{idempotency_key}",
            latitude=form.cleaned_data.get("latitude"),
            longitude=form.cleaned_data.get("longitude"),
            location_accuracy_meters=form.cleaned_data.get("location_accuracy_meters"),
        )
    except ValidationError as error:
        messages.error(request, "; ".join(error.messages))
    else:
        if result.created:
            if form.cleaned_data.get("latitude") is not None:
                messages.success(request, "Ohlášení i volitelná poloha byly přijaty serverem.")
            elif form.cleaned_data.get("location_requested"):
                messages.success(
                    request,
                    "Ohlášení bylo přijato serverem bez polohy. Termín byl posunut.",
                )
            else:
                messages.success(request, "Ohlášení bylo bezpečně přijato serverem.")
        else:
            messages.info(request, "Toto ohlášení už server dříve přijal.")
    return redirect("checkins:profile-detail", pk=profile.pk)


@login_required(login_url="accounts:login")
def profile_pause_view(request, pk):
    profile = get_object_or_404(
        CheckInProfile,
        pk=pk,
        owner=request.user,
        archived_at__isnull=True,
    )
    form = PauseProfileForm(request.POST if request.method == "POST" else None)
    if request.method == "POST" and form.is_valid():
        pausing = profile.enabled and not profile.is_paused
        values = {
            "is_paused": pausing,
            "paused_until": form.cleaned_data["paused_until"] if pausing else None,
        }
        if not profile.enabled:
            values["enabled"] = True
        try:
            update_profile(profile=profile, values=values)
        except ValidationError as error:
            _add_validation_error(form, error)
        else:
            messages.success(
                request,
                "Profil byl pozastaven." if pausing else "Hlídání bylo obnoveno.",
            )
            return redirect("checkins:profile-detail", pk=profile.pk)
    profile.enabled = profile.enabled and not profile.is_paused
    return render(
        request,
        "core/dashboard/pause.html",
        {"profile": profile, "form": form},
    )


def _history_stats(queryset):
    aggregate = queryset.aggregate(
        total_checkins=Count("id"),
        last_checkin_at=Max("accepted_at"),
    )
    aggregate["on_time_checkins"] = queryset.filter(resolved_incidents__isnull=True).count()
    aggregate["active_days"] = (
        queryset.annotate(day=TruncDate("accepted_at")).values("day").distinct().count()
    )
    today = timezone.localdate()
    first_day = today - timedelta(days=6)
    counts = {
        row["day"]: row["count"]
        for row in queryset.filter(accepted_at__date__gte=first_day)
        .annotate(day=TruncDate("accepted_at"))
        .values("day")
        .annotate(count=Count("id"))
    }
    max_count = max(counts.values(), default=0)
    labels = ("Po", "Út", "St", "Čt", "Pá", "So", "Ne")
    aggregate["daily"] = []
    for offset in range(7):
        day = first_day + timedelta(days=offset)
        count = counts.get(day, 0)
        aggregate["daily"].append(
            {
                "label": labels[day.weekday()],
                "count": count,
                "percent": round((count / max_count) * 100) if max_count else 0,
            }
        )
    return aggregate


def _timeline_page(profiles, page_number):
    profile_ids = [profile.pk for profile in profiles]
    check_in_ids = CheckIn.objects.filter(profile_id__in=profile_ids).values("id")
    incident_ids = AlertIncident.objects.filter(profile_id__in=profile_ids).values("id")
    queryset = AuditEvent.objects.filter(
        Q(
            aggregate_type="check_in_profile",
            aggregate_id__in=profile_ids,
            event_type__in=(
                "profile.created",
                "profile.paused",
                "profile.resumed",
                "profile.archived",
            ),
        )
        | Q(
            aggregate_type="check_in",
            aggregate_id__in=check_in_ids,
            event_type="checkin.confirmed",
        )
        | Q(
            aggregate_type="alert_incident",
            aggregate_id__in=incident_ids,
            event_type__in=("incident.opened", "incident.resolved"),
        )
    ).order_by("-occurred_at", "-id")
    page_obj = Paginator(queryset, 25).get_page(page_number)
    events = list(page_obj.object_list)
    checkins = {
        item.pk: item
        for item in CheckIn.objects.filter(
            pk__in=[
                event.aggregate_id for event in events if event.event_type == "checkin.confirmed"
            ]
        ).annotate(resolved_incident_count=Count("resolved_incidents", distinct=True))
    }
    incidents = {
        item.pk: item
        for item in AlertIncident.objects.filter(
            pk__in=[
                event.aggregate_id
                for event in events
                if event.event_type in {"incident.opened", "incident.resolved"}
            ]
        )
    }
    profile_map = {profile.pk: profile for profile in profiles}
    timeline = []
    for event in events:
        if event.aggregate_type == "check_in_profile":
            profile_id = event.aggregate_id
        else:
            profile_id = uuid.UUID(str(event.metadata["profile_id"]))
        item = {
            "id": event.pk,
            "event_type": event.event_type,
            "occurred_at": event.occurred_at,
            "profile": profile_map[profile_id],
        }
        if event.event_type == "checkin.confirmed":
            checkin = checkins[event.aggregate_id]
            item.update(
                {
                    "checkin": checkin,
                    "submitted_from_queue": checkin.submitted_from_queue,
                    "resolved_incident_count": checkin.resolved_incident_count,
                }
            )
        elif event.event_type in {"incident.opened", "incident.resolved"}:
            item["incident"] = incidents[event.aggregate_id]
        elif event.event_type in {"profile.paused", "profile.resumed"}:
            item["automatic"] = event.metadata.get("automatic", False)
            item["has_scheduled_resume"] = event.metadata.get("has_scheduled_resume", False)
        timeline.append(item)
    page_obj.object_list = timeline
    return page_obj


@login_required(login_url="accounts:login")
def history_view(request):
    profiles = CheckInProfile.objects.filter(owner=request.user).order_by("created_at")
    queryset = CheckIn.objects.filter(profile__owner=request.user).select_related("profile")
    selected_profile = None
    profile_id = request.GET.get("profile")
    if profile_id:
        try:
            selected_profile = profiles.get(pk=profile_id)
        except CheckInProfile.DoesNotExist, ValueError:
            raise Http404 from None
        queryset = queryset.filter(profile=selected_profile)
    stats = _history_stats(queryset)
    incident_queryset = AlertIncident.objects.filter(profile__owner=request.user)
    if selected_profile is not None:
        incident_queryset = incident_queryset.filter(profile=selected_profile)
    stats["incident_count"] = incident_queryset.count()
    timeline_profiles = [selected_profile] if selected_profile is not None else list(profiles)
    page_obj = _timeline_page(timeline_profiles, request.GET.get("page"))
    response = render(
        request,
        "core/dashboard/history.html",
        {
            "profiles": profiles,
            "selected_profile": selected_profile,
            "stats": stats,
            "timeline": page_obj.object_list,
            "page_obj": page_obj,
        },
    )
    response["Cache-Control"] = "no-store, private"
    response["Pragma"] = "no-cache"
    return response


@require_POST
@login_required(login_url="accounts:login")
def checkin_location_delete_view(request, pk):
    try:
        result = delete_check_in_location(check_in_id=pk, owner=request.user)
    except CheckIn.DoesNotExist as exc:
        raise Http404 from exc

    checkin = result.check_in
    if result.deleted:
        messages.success(
            request,
            "Poloha byla trvale odstraněna. Historický záznam ohlášení zůstal zachován.",
        )
    else:
        messages.info(request, "U tohoto ohlášení už poloha uložená není.")
    return redirect(f"{reverse('checkins:history')}?profile={checkin.profile_id}")


@login_required(login_url="accounts:login")
def guardians_view(request):
    guardians = GuardianMembership.objects.filter(
        profile__owner=request.user,
        profile__archived_at__isnull=True,
        status=GuardianMembership.Status.ACTIVE,
    ).select_related("profile", "guardian")
    invites = GuardianInvitation.objects.filter(
        profile__owner=request.user,
        profile__archived_at__isnull=True,
        status=GuardianInvitation.Status.PENDING,
        expires_at__gt=timezone.now(),
    ).select_related("profile")
    incoming_invites = GuardianInvitation.objects.filter(
        normalized_email=request.user.email.lower(),
        status=GuardianInvitation.Status.PENDING,
        expires_at__gt=timezone.now(),
        profile__archived_at__isnull=True,
    ).select_related("profile", "invited_by")
    owned_profile_guardian_counts = list(
        CheckInProfile.objects.filter(
            owner=request.user,
            archived_at__isnull=True,
        )
        .annotate(
            active_guardian_count=Count(
                "guardians",
                filter=Q(guardians__status=GuardianMembership.Status.ACTIVE),
            )
        )
        .values_list("active_guardian_count", flat=True)
    )
    watched_memberships = list(
        GuardianMembership.objects.filter(
            guardian=request.user,
            status=GuardianMembership.Status.ACTIVE,
            profile__archived_at__isnull=True,
        )
        .select_related("profile", "profile__owner")
        .order_by("profile__name")
    )
    open_incidents = {
        incident.profile_id: incident
        for incident in accessible_incidents(request.user)
        .filter(
            status=AlertIncident.Status.OPEN,
            profile_id__in=[item.profile_id for item in watched_memberships],
        )
        .select_related("profile")
    }
    for membership in watched_memberships:
        membership.open_incident = open_incidents.get(membership.profile_id)
        membership.owner_display_name = _display_name(membership.profile.owner)
    for membership in guardians:
        membership.guardian_display_name = _display_name(
            membership.guardian, membership.guardian.email
        )
    for invitation in incoming_invites:
        invitation.inviter_display_name = _display_name(invitation.invited_by)
    return render(
        request,
        "core/dashboard/guardians.html",
        {
            "guardians": guardians,
            "invites": invites,
            "incoming_invites": incoming_invites,
            "watched_memberships": watched_memberships,
            "guardian_limit_reached": bool(owned_profile_guardian_counts)
            and all(count >= MAX_GUARDIANS_PER_PROFILE for count in owned_profile_guardian_counts),
        },
    )


@login_required(login_url="accounts:login")
def guardian_invite_view(request):
    form = GuardianInvitationForm(
        request.POST if request.method == "POST" else None,
        owner=request.user,
    )
    guardian_limit_reached = (
        request.method == "GET"
        and CheckInProfile.objects.filter(
            owner=request.user,
            archived_at__isnull=True,
        ).exists()
        and not form.fields["profile"].queryset.exists()
    )
    if request.method == "POST" and form.is_valid():
        try:
            create_invitation(
                profile=form.cleaned_data["profile"],
                invited_by=request.user,
                email=form.cleaned_data["email"],
            )
        except ValidationError as error:
            _add_validation_error(form, error)
        else:
            messages.success(request, "Pozvánka byla připravena k odeslání.")
            return redirect("guardians:list")
    return render(
        request,
        "core/dashboard/guardian_invite.html",
        {"form": form, "guardian_limit_reached": guardian_limit_reached},
    )


@require_POST
@login_required(login_url="accounts:login")
def guardian_remove_view(request, pk):
    membership = get_object_or_404(
        GuardianMembership,
        pk=pk,
        profile__owner=request.user,
        profile__archived_at__isnull=True,
        status=GuardianMembership.Status.ACTIVE,
    )
    revoke_guardian_membership(membership=membership, actor=request.user)
    messages.success(request, "Strážce byl odebrán.")
    return redirect("guardians:list")


@require_POST
@login_required(login_url="accounts:login")
def guardian_self_revoke_view(request, pk):
    membership = get_object_or_404(
        GuardianMembership,
        pk=pk,
        guardian=request.user,
        profile__archived_at__isnull=True,
        status=GuardianMembership.Status.ACTIVE,
    )
    revoke_guardian_membership(membership=membership, actor=request.user)
    messages.success(
        request,
        "Profil už nehlídáte. Přístup k jeho incidentům a poloze byl odebrán.",
    )
    return redirect("guardians:list")


@require_POST
@login_required(login_url="accounts:login")
def guardian_invite_revoke_view(request, pk):
    invitation = get_object_or_404(
        GuardianInvitation,
        pk=pk,
        profile__owner=request.user,
        profile__archived_at__isnull=True,
        status=GuardianInvitation.Status.PENDING,
    )
    if revoke_invitation(invitation=invitation, actor=request.user):
        messages.success(request, "Čekající pozvánka byla zrušena.")
    else:
        messages.warning(
            request,
            (
                "Stav pozvánky se mezitím změnil. Pokud ji strážce přijal, "
                "odeberte ho ze seznamu aktivních strážců."
            ),
        )
    return redirect("guardians:list")


@require_POST
@login_required(login_url="accounts:login")
def guardian_respond_view(request, pk):
    decision = request.POST.get("decision")
    if decision not in {"accept", "decline"}:
        return HttpResponse(status=400)
    try:
        respond_to_invitation(
            invitation_id=pk,
            user=request.user,
            decision=decision,
        )
    except PermissionDenied as error:
        raise Http404 from error
    except ValidationError as error:
        messages.error(request, "; ".join(error.messages))
        return redirect("guardians:list")
    messages.success(
        request,
        "Pozvánka byla přijata." if decision == "accept" else "Pozvánka byla odmítnuta.",
    )
    return redirect("guardians:list")


def _accessible_alert_or_404(user, pk):
    return get_object_or_404(
        accessible_incidents(user).select_related("profile", "profile__owner"),
        pk=pk,
    )


@login_required(login_url="accounts:login")
def alert_detail_view(request, pk):
    alert = _accessible_alert_or_404(request.user, pk)
    is_owner = alert.profile.owner_id == request.user.id
    guardian_location_allowed = settings.GUARDIAN_LOCATION_DISCLOSURE_ENABLED
    alert.guardian_location_disclosure_disabled = not is_owner and not guardian_location_allowed
    if (alert.status == AlertIncident.Status.OPEN or is_owner) and (
        is_owner or guardian_location_allowed
    ):
        alert.last_checkin = alert.profile.check_ins.filter(
            accepted_at__lte=alert.opened_at,
            latitude__isnull=False,
            longitude__isnull=False,
        ).first()
    else:
        alert.last_checkin = None
    acknowledgements = alert.acknowledgements.select_related("user").order_by("acknowledged_at")
    for acknowledgement in acknowledgements:
        acknowledgement.user_display_name = _display_name(
            acknowledgement.user,
            "Smazaný strážce" if acknowledgement.user is None else "Strážce",
        )
    attempts = alert.deliveries.all()
    if not is_owner:
        attempts = attempts.filter(device__user=request.user)
    delivery_counts = {
        value: attempts.filter(status=value).count()
        for value, _label in alert.deliveries.model.Status.choices
    }
    delivery_counts = {key: value for key, value in delivery_counts.items() if value}
    legacy_provider_accepted = delivery_counts.pop("delivered", 0)
    if legacy_provider_accepted:
        delivery_counts["provider_accepted"] = (
            delivery_counts.get("provider_accepted", 0) + legacy_provider_accepted
        )
    if delivery_counts.get("provider_accepted"):
        delivery_state = "accepted_by_push_service"
    elif delivery_counts.get("ticket_received") or delivery_counts.get("receipt_processing"):
        delivery_state = "sent_to_provider"
    elif delivery_counts.get("queued") or delivery_counts.get("retryable_failure"):
        delivery_state = "pending"
    elif delivery_counts:
        delivery_state = "failed"
    else:
        delivery_state = "no_delivery_record"
    response = render(
        request,
        "core/dashboard/alert_detail.html",
        {
            "alert": alert,
            "acknowledgements": acknowledgements,
            "delivery_state": delivery_state,
            "can_acknowledge": can_acknowledge_incident(request.user, alert),
        },
    )
    response["Cache-Control"] = "no-store, private"
    response["Pragma"] = "no-cache"
    return response


@require_POST
@login_required(login_url="accounts:login")
def alert_ack_view(request, pk):
    alert = _accessible_alert_or_404(request.user, pk)
    if alert.status != AlertIncident.Status.OPEN:
        messages.info(request, "Upozornění už je uzavřené.")
        return redirect("alerts:detail", pk=alert.pk)
    if not can_acknowledge_incident(request.user, alert):
        raise PermissionDenied("Incident může potvrdit pouze jeho aktivní strážce.")
    with transaction.atomic():
        guardian = User.objects.select_for_update().filter(pk=request.user.pk).first()
        if guardian is None:
            raise PermissionDenied("Účet už není aktivní.")
        AlertAcknowledgement.objects.get_or_create(
            incident=alert,
            user=guardian,
            defaults={
                "user_id_snapshot": guardian.id,
                "acknowledged_at": timezone.now(),
            },
        )
    messages.success(request, "Potvrzení strážce bylo zaznamenáno.")
    return redirect("alerts:detail", pk=alert.pk)


@login_required(login_url="accounts:login")
def settings_view(request):
    form = AccountSettingsForm(
        request.POST if request.method == "POST" else None,
        instance=request.user,
    )
    if request.method == "POST" and request.POST.get("action") == "profile" and form.is_valid():
        form.save()
        messages.success(request, "Osobní údaje byly uloženy.")
        return redirect("accounts:settings")
    devices = PushDevice.objects.filter(user=request.user).order_by("-last_seen_at")
    return render(
        request,
        "core/dashboard/settings.html",
        {
            "form": form,
            "devices": devices,
            "notification_health": {"ok": devices.filter(active=True).exists()},
        },
    )


@login_required(login_url="accounts:login")
def export_data_view(request):
    form = ExportDataForm(request.POST if request.method == "POST" else None)
    if request.method == "POST" and form.is_valid():
        body = json.dumps(
            build_account_export(request.user),
            cls=JSONEncoder,
            ensure_ascii=False,
            indent=2,
        )
        response = HttpResponse(body, content_type="application/json; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="hlasim-se-export.json"'
        response["Cache-Control"] = "no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response
    return render(
        request,
        "core/dashboard/export_data.html",
        {"form": form},
    )


def delete_account_view(request):
    if not request.user.is_authenticated:
        if request.method == "POST":
            return redirect(f"{reverse('accounts:login')}?next={reverse('accounts:delete')}")
        response = render(request, "core/account_deletion_public.html")
        response["Cache-Control"] = "no-store"
        return response
    form = DeleteAccountForm(request.POST if request.method == "POST" else None)
    if request.method == "POST" and form.is_valid():
        user_id = request.user.pk
        try:
            delete_account_safely(
                user_id=user_id,
                password=form.cleaned_data["password"],
            )
        except AccountPasswordInvalid:
            form.add_error("password", "Heslo už není platné.")
        except AccountDeletionBlocked as error:
            form.add_error(None, str(error))
        else:
            logout(request)
            return redirect("core:landing")
    return render(
        request,
        "core/dashboard/delete_account.html",
        {"form": form},
    )
