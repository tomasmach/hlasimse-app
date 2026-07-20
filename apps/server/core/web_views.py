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

from .account_data import (
    AccountDeletionBlocked,
    AccountPasswordInvalid,
    delete_account_safely,
)
from .email_verification import (
    register_unverified_user,
    resend_verification,
    verify_signed_token,
)
from .forms import (
    AccountSettingsForm,
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
    CheckIn,
    CheckInProfile,
    GuardianInvitation,
    GuardianMembership,
    PushDevice,
)
from .services import (
    accessible_incidents,
    create_invitation,
    create_profile,
    perform_check_in,
    respond_to_invitation,
    revoke_guardian_membership,
    update_profile,
)


class LandingView(TemplateView):
    template_name = "core/landing.html"


class SessionLoginView(LoginView):
    authentication_form = LoginForm
    template_name = "core/auth/login.html"
    redirect_authenticated_user = True

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


class SecurePasswordResetView(PasswordResetView):
    template_name = "core/auth/forgot_password.html"
    form_class = PasswordResetForm
    success_url = reverse_lazy("accounts:password_reset_done")

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


class SecurePasswordResetConfirmView(PasswordResetConfirmView):
    template_name = "core/auth/password_reset_confirm.html"
    success_url = reverse_lazy("accounts:password_reset_complete")


class SecurePasswordResetCompleteView(PasswordResetCompleteView):
    template_name = "core/auth/password_reset_complete.html"


def register_view(request):
    if request.user.is_authenticated:
        return redirect("core:dashboard")
    form = RegisterForm(request.POST if request.method == "POST" else None)
    if request.method == "POST" and form.is_valid():
        register_unverified_user(
            email=form.cleaned_data["email"],
            password=form.cleaned_data["password1"],
            first_name=form.cleaned_data["first_name"],
            last_name=form.cleaned_data["last_name"],
        )
        return redirect("accounts:verification-sent")
    return render(request, "core/auth/register.html", {"form": form})


def verification_sent_view(request):
    return render(request, "core/auth/verification_sent.html")


def resend_verification_view(request):
    form = EmailVerificationResendForm(request.POST if request.method == "POST" else None)
    if request.method == "POST" and form.is_valid():
        resend_verification(email=form.cleaned_data["email"])
        return redirect("accounts:verification-sent")
    return render(request, "core/auth/resend_verification.html", {"form": form})


def verify_email_view(request, token):
    result = verify_signed_token(token)
    return render(
        request,
        "core/auth/verify_email_result.html",
        {"verification_status": result.status},
        status=200,
    )


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
        context.update(
            {
                "profiles": profiles,
                "checkins": checkins,
                "active_alert": active_alert,
                "notification_health": _notification_health(profiles),
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
        {"form": form, "profile": None},
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
    session_keys[str(profile.pk)] = uuid.uuid4().hex
    request.session["web_checkin_keys"] = session_keys
    guardians = profile.guardians.filter(status=GuardianMembership.Status.ACTIVE).select_related(
        "guardian"
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
    session_keys = request.session.get("web_checkin_keys", {})
    idempotency_key = session_keys.get(str(profile.pk))
    if not idempotency_key:
        idempotency_key = uuid.uuid4().hex
        session_keys[str(profile.pk)] = idempotency_key
        request.session["web_checkin_keys"] = session_keys
    try:
        result = perform_check_in(profile=profile, idempotency_key=f"web:{idempotency_key}")
    except ValidationError as error:
        messages.error(request, "; ".join(error.messages))
    else:
        if result.created:
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
    page_obj = Paginator(queryset, 25).get_page(request.GET.get("page"))
    return render(
        request,
        "core/dashboard/history.html",
        {
            "profiles": profiles,
            "selected_profile": selected_profile,
            "stats": stats,
            "checkins": page_obj.object_list,
            "page_obj": page_obj,
        },
    )


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
    return render(
        request,
        "core/dashboard/guardians.html",
        {
            "guardians": guardians,
            "invites": invites,
            "incoming_invites": incoming_invites,
        },
    )


@login_required(login_url="accounts:login")
def guardian_invite_view(request):
    form = GuardianInvitationForm(
        request.POST if request.method == "POST" else None,
        owner=request.user,
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
        {"form": form},
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
    if alert.status == AlertIncident.Status.OPEN or alert.profile.owner_id == request.user.id:
        alert.last_checkin = alert.profile.check_ins.filter(
            accepted_at__lte=alert.opened_at
        ).first()
    else:
        alert.last_checkin = None
    return render(
        request,
        "core/dashboard/alert_detail.html",
        {"alert": alert},
    )


@require_POST
@login_required(login_url="accounts:login")
def alert_ack_view(request, pk):
    alert = _accessible_alert_or_404(request.user, pk)
    if alert.status != AlertIncident.Status.OPEN:
        messages.info(request, "Upozornění už je uzavřené.")
        return redirect("alerts:detail", pk=alert.pk)
    AlertAcknowledgement.objects.get_or_create(
        incident=alert,
        user=request.user,
        defaults={"acknowledged_at": timezone.now()},
    )
    messages.success(request, "Převzetí upozornění bylo zaznamenáno.")
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


def _iso(value):
    return value.isoformat() if value is not None else None


def _export_payload(user):
    profiles = list(CheckInProfile.objects.filter(owner=user).order_by("created_at"))
    profile_ids = [profile.pk for profile in profiles]
    checkins = CheckIn.objects.filter(profile_id__in=profile_ids).select_related("profile")
    memberships = GuardianMembership.objects.filter(
        Q(profile_id__in=profile_ids) | Q(guardian=user)
    ).select_related("profile", "guardian")
    invitations = GuardianInvitation.objects.filter(
        Q(profile_id__in=profile_ids) | Q(normalized_email=user.email.lower())
    ).select_related("profile")
    incidents = accessible_incidents(user).select_related("profile")
    acknowledgements = AlertAcknowledgement.objects.filter(user=user)
    return {
        "exported_at": _iso(timezone.now()),
        "account": {
            "id": str(user.pk),
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "date_joined": _iso(user.date_joined),
        },
        "profiles": [
            {
                "id": str(item.pk),
                "name": item.name,
                "interval_seconds": item.interval_seconds,
                "enabled": item.enabled,
                "is_paused": item.is_paused,
                "paused_until": _iso(item.paused_until),
                "last_checked_in_at": _iso(item.last_checked_in_at),
                "next_deadline_at": _iso(item.next_deadline_at),
                "archived_at": _iso(item.archived_at),
                "created_at": _iso(item.created_at),
            }
            for item in profiles
        ],
        "check_ins": [
            {
                "id": str(item.pk),
                "profile_id": str(item.profile_id),
                "accepted_at": _iso(item.accepted_at),
                "client_recorded_at": _iso(item.client_recorded_at),
                "latitude": str(item.latitude) if item.latitude is not None else None,
                "longitude": str(item.longitude) if item.longitude is not None else None,
                "location_accuracy_meters": (
                    str(item.location_accuracy_meters)
                    if item.location_accuracy_meters is not None
                    else None
                ),
                "submitted_from_queue": item.submitted_from_queue,
            }
            for item in checkins
        ],
        "guardian_memberships": [
            {
                "id": str(item.pk),
                "profile_id": str(item.profile_id),
                "guardian_id": str(item.guardian_id),
                "guardian_email": item.guardian.email,
                "status": item.status,
                "created_at": _iso(item.created_at),
            }
            for item in memberships
        ],
        "guardian_invitations": [
            {
                "id": str(item.pk),
                "profile_id": str(item.profile_id),
                "email": item.email,
                "status": item.status,
                "expires_at": _iso(item.expires_at),
                "created_at": _iso(item.created_at),
            }
            for item in invitations
        ],
        "alerts": [
            {
                "id": str(item.pk),
                "profile_id": str(item.profile_id),
                "status": item.status,
                "deadline_at": _iso(item.deadline_at),
                "opened_at": _iso(item.opened_at),
                "resolved_at": _iso(item.resolved_at),
            }
            for item in incidents
        ],
        "alert_acknowledgements": [
            {
                "id": str(item.pk),
                "incident_id": str(item.incident_id),
                "user_id": str(item.user_id),
                "acknowledged_at": _iso(item.acknowledged_at),
            }
            for item in acknowledgements
        ],
        "push_devices": [
            {
                "id": str(item.pk),
                "installation_id": str(item.installation_id),
                "platform": item.platform,
                "active": item.active,
                "last_seen_at": _iso(item.last_seen_at),
            }
            for item in PushDevice.objects.filter(user=user)
        ],
    }


@login_required(login_url="accounts:login")
def export_data_view(request):
    form = ExportDataForm(request.POST if request.method == "POST" else None)
    if request.method == "POST" and form.is_valid():
        body = json.dumps(_export_payload(request.user), ensure_ascii=False, indent=2)
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


@login_required(login_url="accounts:login")
def delete_account_view(request):
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
