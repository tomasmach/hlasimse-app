import logging
import uuid

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import Count, Q
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.utils import timezone
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, mixins, permissions, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import CursorPagination, PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from .account_data import (
    AccountDeletionBlocked,
    AccountPasswordInvalid,
    build_account_export,
    delete_account_safely,
)
from .email_verification import (
    GENERIC_SENT_MESSAGE,
    register_unverified_user,
    resend_verification,
    verify_signed_token,
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
from .openapi import (
    AcceptedResponseSerializer,
    CheckInStatisticsSchemaSerializer,
    DetailResponseSerializer,
    LogoutRequestSerializer,
    ProfileArchiveConflictSchemaSerializer,
    ProfileTimelinePageSchemaSerializer,
    VerificationResultSerializer,
)
from .password_reset import revoke_outstanding_refresh_tokens
from .serializers import (
    AccountDeleteSerializer,
    AlertIncidentSerializer,
    CheckInHistorySerializer,
    CheckInInputSerializer,
    CheckInReceiptSerializer,
    EmailVerificationConfirmSerializer,
    EmailVerificationRequestSerializer,
    GuardianSerializer,
    InvitationAcceptSerializer,
    InvitationCreateSerializer,
    InvitationDecisionSerializer,
    InvitationSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    ProfileSerializer,
    PushDeviceSerializer,
    ReceivedInvitationSerializer,
    RegisterSerializer,
    UserSerializer,
    WatchedProfileSerializer,
)
from .services import (
    accept_invitation,
    accessible_incidents,
    archive_profile,
    can_acknowledge_incident,
    create_invitation,
    deactivate_push_device,
    delete_check_in_location,
    perform_check_in,
    respond_to_invitation,
    revoke_guardian_membership,
    revoke_invitation,
)
from .throttling import TrustedProxySimpleRateThrottle

logger = logging.getLogger(__name__)


class RegistrationThrottle(TrustedProxySimpleRateThrottle):
    rate = "5/hour"
    scope = "registration"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class RegisterView(generics.CreateAPIView):
    permission_classes = (permissions.AllowAny,)
    serializer_class = RegisterSerializer
    throttle_classes = (RegistrationThrottle,)

    @extend_schema(
        request=RegisterSerializer,
        responses={202: AcceptedResponseSerializer},
    )
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        register_unverified_user(
            email=values["email"],
            password=values["password"],
            terms_accepted=values["terms_accepted"],
            first_name=values.get("first_name", ""),
            last_name=values.get("last_name", ""),
        )
        return Response(
            {"detail": GENERIC_SENT_MESSAGE, "verification_required": True},
            status=status.HTTP_202_ACCEPTED,
        )


class EmailVerificationResendView(APIView):
    permission_classes = (permissions.AllowAny,)
    authentication_classes = ()

    @extend_schema(
        request=EmailVerificationRequestSerializer,
        responses={202: AcceptedResponseSerializer},
    )
    def post(self, request):
        serializer = EmailVerificationRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        resend_verification(email=serializer.validated_data["email"])
        return Response(
            {"detail": GENERIC_SENT_MESSAGE, "verification_required": True},
            status=status.HTTP_202_ACCEPTED,
        )


class EmailVerificationConfirmView(APIView):
    permission_classes = (permissions.AllowAny,)
    authentication_classes = ()

    @extend_schema(
        request=EmailVerificationConfirmSerializer,
        responses={200: VerificationResultSerializer, 400: VerificationResultSerializer},
    )
    def post(self, request):
        serializer = EmailVerificationConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = verify_signed_token(serializer.validated_data["token"])
        response_status = status.HTTP_200_OK
        if result.status in {"invalid", "expired"}:
            response_status = status.HTTP_400_BAD_REQUEST
        return Response({"status": result.status}, status=response_status)


class MeView(generics.RetrieveUpdateAPIView):
    serializer_class = UserSerializer
    http_method_names = ("get", "patch", "head", "options")

    def get_object(self):
        return self.request.user


class PasswordResetRequestThrottle(TrustedProxySimpleRateThrottle):
    rate = "5/hour"
    scope = "password_reset_request"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class PasswordResetConfirmThrottle(TrustedProxySimpleRateThrottle):
    rate = "10/hour"
    scope = "password_reset_confirm"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class PasswordResetRequestView(APIView):
    permission_classes = (permissions.AllowAny,)
    authentication_classes = ()
    throttle_classes = (PasswordResetRequestThrottle,)

    @extend_schema(
        request=PasswordResetRequestSerializer,
        responses={202: DetailResponseSerializer},
    )
    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        user = (
            get_user_model()
            .objects.filter(email__iexact=email, is_active=True)
            .order_by("date_joined")
            .first()
        )
        if user is not None and user.has_usable_password():
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            reset_path = reverse(
                "accounts:password_reset_confirm",
                kwargs={"uidb64": uid, "token": token},
            )
            reset_url = f"{settings.APP_BASE_URL}{reset_path}"
            try:
                send_mail(
                    "Obnova hesla pro Hlásím se",
                    (
                        "Obdrželi jsme žádost o změnu hesla.\n\n"
                        f"Nové heslo nastavíte zde: {reset_url}\n\n"
                        "Pokud jste o změnu nežádali, tento e-mail ignorujte."
                    ),
                    getattr(settings, "DEFAULT_FROM_EMAIL", None),
                    [user.email],
                )
            except Exception:
                # SMTP availability must not become an account-enumeration oracle.
                logger.exception("Password reset email delivery failed")
        # The response is intentionally identical for existing and unknown accounts.
        return Response(
            {"detail": "Pokud účet existuje, odeslali jsme pokyny k obnově hesla."},
            status=status.HTTP_202_ACCEPTED,
        )


class PasswordResetConfirmView(APIView):
    permission_classes = (permissions.AllowAny,)
    authentication_classes = ()
    throttle_classes = (PasswordResetConfirmThrottle,)

    @extend_schema(request=PasswordResetConfirmSerializer, responses={204: None})
    def post(self, request):
        uid = request.data.get("uid", "")
        user = None
        try:
            user_id = force_str(urlsafe_base64_decode(uid))
            user = get_user_model().objects.filter(pk=user_id, is_active=True).first()
        except ValueError, TypeError, OverflowError:
            pass
        serializer = PasswordResetConfirmSerializer(
            data=request.data,
            context={"user": user},
        )
        serializer.is_valid(raise_exception=True)
        if user is None or not default_token_generator.check_token(
            user, serializer.validated_data["token"]
        ):
            raise ValidationError({"token": "Odkaz pro obnovu hesla není platný."})
        user.set_password(serializer.validated_data["new_password"])
        with transaction.atomic():
            user.save(update_fields=["password"])
            revoke_outstanding_refresh_tokens(user=user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AccountExportView(APIView):
    @extend_schema(
        responses={200: OpenApiTypes.OBJECT},
        description="Export all data belonging to the authenticated account.",
    )
    def get(self, request):
        response = Response(build_account_export(request.user))
        response["Content-Disposition"] = 'attachment; filename="hlasim-se-export.json"'
        response["Cache-Control"] = "no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response


class AccountDeleteView(APIView):
    @extend_schema(request=AccountDeleteSerializer, responses={204: None, 409: OpenApiTypes.OBJECT})
    def delete(self, request):
        serializer = AccountDeleteSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        try:
            delete_account_safely(
                user_id=request.user.pk,
                password=serializer.validated_data["password"],
            )
        except AccountPasswordInvalid as exc:
            raise ValidationError({"password": "Heslo už není platné."}) from exc
        except AccountDeletionBlocked as exc:
            return Response(
                {"error": {"status": status.HTTP_409_CONFLICT, "details": str(exc)}},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class LogoutView(APIView):
    @extend_schema(request=LogoutRequestSerializer, responses={204: None})
    def post(self, request):
        serializer = LogoutRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                token = RefreshToken(serializer.validated_data["refresh"])
                if str(token.get("user_id")) != str(request.user.pk):
                    raise ValidationError({"refresh": "Refresh token patří jinému účtu."})
                device = (
                    PushDevice.objects.select_for_update()
                    .filter(
                        user=request.user,
                        installation_id=serializer.validated_data["installation_id"],
                    )
                    .first()
                )
                if device is not None:
                    deactivate_push_device(device=device, actor=request.user)
                token.blacklist()
        except TokenError as exc:
            raise ValidationError({"refresh": "Refresh token není platný."}) from exc
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProfileViewSet(viewsets.ModelViewSet):
    serializer_class = ProfileSerializer
    queryset = CheckInProfile.objects.none()

    def get_queryset(self):
        return CheckInProfile.objects.filter(
            owner=self.request.user,
            archived_at__isnull=True,
        )

    @extend_schema(responses={204: None, 409: ProfileArchiveConflictSchemaSerializer})
    def destroy(self, request, *args, **kwargs):
        result = archive_profile(profile=self.get_object(), actor=request.user)
        if result.blocking_incident is not None:
            return Response(
                {
                    "code": "profile_has_open_incident",
                    "detail": (
                        "Profil nelze archivovat během aktivního incidentu. "
                        "Nejprve incident bezpečně vyřešte potvrzeným ohlášením."
                    ),
                    "incident_id": str(result.blocking_incident.id),
                },
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(
        request=CheckInInputSerializer,
        parameters=[
            OpenApiParameter(
                "Idempotency-Key",
                OpenApiTypes.STR,
                OpenApiParameter.HEADER,
                required=True,
            ),
        ],
        responses={200: CheckInReceiptSerializer, 201: CheckInReceiptSerializer},
        description=(
            "Create or replay an idempotent check-in. The response is authoritative only after "
            "the server accepts it. The Idempotency-Key header is required."
        ),
    )
    @action(detail=True, methods=["post"], url_path="check-in")
    def check_in(self, request, pk=None):
        profile = self.get_object()
        serializer = CheckInInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        idempotency_key = request.headers.get("Idempotency-Key") or values.pop(
            "idempotency_key", None
        )
        if not idempotency_key:
            raise ValidationError({"idempotency_key": "Idempotency-Key je povinný."})
        if len(idempotency_key) > 128:
            raise ValidationError({"idempotency_key": "Klíč je příliš dlouhý."})
        try:
            result = perform_check_in(profile=profile, idempotency_key=idempotency_key, **values)
        except DjangoValidationError as exc:
            raise ValidationError(exc.message_dict) from exc
        output = CheckInReceiptSerializer(result.check_in)
        return Response(
            output.data,
            status=status.HTTP_201_CREATED if result.created else status.HTTP_200_OK,
        )

    @extend_schema(responses={200: GuardianSerializer(many=True)})
    @action(detail=True, methods=["get"])
    def guardians(self, request, pk=None):
        memberships = (
            self.get_object()
            .guardians.filter(status=GuardianMembership.Status.ACTIVE)
            .select_related("guardian")
        )
        return Response(GuardianSerializer(memberships, many=True).data)

    @extend_schema(
        parameters=[
            OpenApiParameter("guardian_id", OpenApiTypes.UUID, OpenApiParameter.PATH),
        ],
        responses={204: None},
    )
    @action(detail=True, methods=["delete"], url_path=r"guardians/(?P<guardian_id>[^/.]+)")
    def revoke_guardian(self, request, pk=None, guardian_id: uuid.UUID | None = None):
        membership = get_object_or_404(
            self.get_object().guardians, pk=guardian_id, status=GuardianMembership.Status.ACTIVE
        )
        revoke_guardian_membership(membership=membership, actor=request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(
        methods=["GET"],
        responses={200: InvitationSerializer(many=True)},
    )
    @extend_schema(
        methods=["POST"],
        request=InvitationCreateSerializer,
        responses={201: InvitationSerializer},
    )
    @action(detail=True, methods=["get", "post"])
    def invitations(self, request, pk=None):
        profile = self.get_object()
        if request.method == "GET":
            return Response(InvitationSerializer(profile.invitations.all(), many=True).data)
        serializer = InvitationCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            invitation, token = create_invitation(
                profile=profile,
                invited_by=request.user,
                email=serializer.validated_data["email"],
            )
        except DjangoValidationError as exc:
            details = exc.message_dict if hasattr(exc, "message_dict") else exc.messages
            raise ValidationError(details) from exc
        data = InvitationSerializer(invitation).data
        # Development keeps the legacy token response for local e-mail-less testing.
        # Production clients accept invitations by authenticated invitation ID.
        if settings.DEBUG or settings.EMAIL_BACKEND.endswith("locmem.EmailBackend"):
            data["acceptance_token"] = token
        return Response(data, status=status.HTTP_201_CREATED)

    @extend_schema(
        parameters=[
            OpenApiParameter("invitation_id", OpenApiTypes.UUID, OpenApiParameter.PATH),
        ],
        responses={204: None, 409: DetailResponseSerializer},
    )
    @action(
        detail=True,
        methods=["delete"],
        url_path=r"invitations/(?P<invitation_id>[^/.]+)",
    )
    def revoke_invitation(self, request, pk=None, invitation_id: uuid.UUID | None = None):
        invitation = get_object_or_404(
            self.get_object().invitations,
            pk=invitation_id,
            status=GuardianInvitation.Status.PENDING,
        )
        if not revoke_invitation(invitation=invitation, actor=request.user):
            return Response(
                {
                    "detail": (
                        "Stav pozvánky se mezitím změnil. Obnovte seznam; pokud byla přijata, "
                        "odeberte vzniklého strážce."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(
        responses={200: ProfileTimelinePageSchemaSerializer},
        description=(
            "Owner-only safety timeline. Check-in events expose has_location presence but never "
            "latitude, longitude, or accuracy values."
        ),
    )
    @action(detail=True, methods=["get"])
    def timeline(self, request, pk=None):
        # Archived profiles intentionally disappear from normal profile routes, but
        # their owner retains read-only access to the safety history.
        profile = get_object_or_404(CheckInProfile, pk=pk, owner=request.user)
        check_in_ids = CheckIn.objects.filter(profile=profile).values("id")
        incident_ids = AlertIncident.objects.filter(profile=profile).values("id")
        events = AuditEvent.objects.filter(
            Q(
                aggregate_type="check_in_profile",
                aggregate_id=profile.id,
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
        paginator = ProfileTimelinePagination()
        page = paginator.paginate_queryset(events, request, view=self)
        data = _serialize_timeline_page(page)
        response = paginator.get_paginated_response(data)
        response["Cache-Control"] = "no-store, private"
        response["Pragma"] = "no-cache"
        return response


class ProfileTimelinePagination(CursorPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 100
    ordering = ("-occurred_at", "-id")


def _serialize_timeline_page(events):
    event_list = list(events)
    check_in_ids = [
        event.aggregate_id for event in event_list if event.event_type == "checkin.confirmed"
    ]
    incident_ids = [
        event.aggregate_id
        for event in event_list
        if event.event_type in {"incident.opened", "incident.resolved"}
    ]
    check_ins = {
        item.id: item
        for item in CheckIn.objects.filter(pk__in=check_in_ids).annotate(
            resolved_incident_count=Count("resolved_incidents", distinct=True)
        )
    }
    incidents = {item.id: item for item in AlertIncident.objects.filter(pk__in=incident_ids)}
    output = []
    for event in event_list:
        metadata = event.metadata
        if event.event_type == "checkin.confirmed":
            check_in = check_ins[event.aggregate_id]
            details = {
                "check_in_id": str(check_in.id),
                "deadline_generation": check_in.deadline_generation,
                "next_deadline_at": check_in.response_deadline_at,
                "submitted_from_queue": check_in.submitted_from_queue,
                "has_location": (check_in.latitude is not None and check_in.longitude is not None),
                "resolved_incident_count": check_in.resolved_incident_count,
            }
        elif event.event_type == "incident.opened":
            incident = incidents[event.aggregate_id]
            details = {
                "incident_id": str(incident.id),
                "deadline_at": incident.deadline_at,
                "deadline_generation": incident.deadline_generation,
            }
        elif event.event_type == "incident.resolved":
            incident = incidents[event.aggregate_id]
            details = {
                "incident_id": str(incident.id),
                "resolved_at": incident.resolved_at,
                "resolved_by_check_in_id": str(incident.resolved_by_check_in_id),
            }
        elif event.event_type in {"profile.paused", "profile.resumed"}:
            details = {
                "automatic": metadata.get("automatic", False),
                "deadline_generation": metadata["deadline_generation"],
                "has_scheduled_resume": metadata.get("has_scheduled_resume", False),
            }
        elif event.event_type == "profile.archived":
            details = {
                "deadline_generation": metadata["deadline_generation"],
                "revoked_membership_count": metadata["revoked_membership_count"],
                "revoked_invitation_count": metadata["revoked_invitation_count"],
            }
        else:
            details = {
                "enabled": metadata["enabled"],
                "is_paused": metadata["is_paused"],
                "interval_seconds": metadata["interval_seconds"],
                "deadline_generation": metadata["deadline_generation"],
            }
        output.append(
            {
                "id": str(event.id),
                "event_type": event.event_type,
                "occurred_at": event.occurred_at,
                "profile_id": str(
                    metadata.get("profile_id", event.aggregate_id)
                    if event.aggregate_type != "check_in_profile"
                    else event.aggregate_id
                ),
                "details": details,
            }
        )
    return output


class CheckInHistoryPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 100


def _history_filters(request):
    filters = {"profile__owner": request.user}
    profile_id = request.query_params.get("profile")
    if profile_id:
        try:
            filters["profile_id"] = uuid.UUID(profile_id)
        except ValueError as exc:
            raise ValidationError({"profile": "Neplatné ID profilu."}) from exc
    parsed_dates = {}
    date_field = serializers.DateTimeField()
    for query_name in ("from", "to"):
        raw_value = request.query_params.get(query_name)
        if not raw_value:
            continue
        try:
            parsed_dates[query_name] = date_field.run_validation(raw_value)
        except serializers.ValidationError as exc:
            raise ValidationError({query_name: "Neplatné datum a čas."}) from exc
    if (
        parsed_dates.get("from")
        and parsed_dates.get("to")
        and parsed_dates["from"] > parsed_dates["to"]
    ):
        raise ValidationError({"to": "Konec období nesmí předcházet začátku."})
    if parsed_dates.get("from"):
        filters["accepted_at__gte"] = parsed_dates["from"]
    if parsed_dates.get("to"):
        filters["accepted_at__lte"] = parsed_dates["to"]
    return filters, parsed_dates


class CheckInHistoryView(generics.ListAPIView):
    serializer_class = CheckInHistorySerializer
    pagination_class = CheckInHistoryPagination

    @extend_schema(
        parameters=[
            OpenApiParameter("profile", OpenApiTypes.UUID, OpenApiParameter.QUERY),
            OpenApiParameter("from", OpenApiTypes.DATETIME, OpenApiParameter.QUERY),
            OpenApiParameter("to", OpenApiTypes.DATETIME, OpenApiParameter.QUERY),
        ],
        description=(
            "Owner-only server-confirmed check-in history. has_location is a boolean presence "
            "marker; coordinates and accuracy are intentionally excluded."
        ),
    )
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store, private"
        response["Pragma"] = "no-cache"
        return response

    def get_queryset(self):
        filters, _dates = _history_filters(self.request)
        return (
            CheckIn.objects.filter(**filters)
            .select_related("profile")
            .annotate(resolved_incident_count=Count("resolved_incidents", distinct=True))
            .order_by("-accepted_at", "-id")
        )


class CheckInLocationDeleteView(APIView):
    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store, private"
        response["Pragma"] = "no-cache"
        return response

    @extend_schema(
        responses={204: None},
        description=(
            "Permanently remove location fields from an owner check-in while preserving the "
            "check-in and safety history."
        ),
    )
    def delete(self, request, check_in_id):
        try:
            delete_check_in_location(check_in_id=check_in_id, owner=request.user)
        except CheckIn.DoesNotExist as exc:
            raise Http404 from exc

        return Response(status=status.HTTP_204_NO_CONTENT)


class CheckInStatisticsView(APIView):
    @extend_schema(
        parameters=[
            OpenApiParameter("profile", OpenApiTypes.UUID, OpenApiParameter.QUERY),
            OpenApiParameter("from", OpenApiTypes.DATETIME, OpenApiParameter.QUERY),
            OpenApiParameter("to", OpenApiTypes.DATETIME, OpenApiParameter.QUERY),
        ],
        responses={200: CheckInStatisticsSchemaSerializer},
    )
    def get(self, request):
        filters, dates = _history_filters(request)
        check_ins = CheckIn.objects.filter(**filters).annotate(
            resolved_incident_count=Count("resolved_incidents", distinct=True)
        )
        incident_filters = {"profile__owner": request.user}
        profile_id = filters.get("profile_id")
        if profile_id:
            incident_filters["profile_id"] = profile_id
        if dates.get("from"):
            incident_filters["opened_at__gte"] = dates["from"]
        if dates.get("to"):
            incident_filters["opened_at__lte"] = dates["to"]
        total = check_ins.count()
        late = check_ins.filter(resolved_incident_count__gt=0).count()
        return Response(
            {
                "period": {"from": dates.get("from"), "to": dates.get("to")},
                "total_check_ins": total,
                "on_time_check_ins": total - late,
                "incident_count": AlertIncident.objects.filter(**incident_filters).count(),
                "definitions": {
                    "total_check_ins": "Serverem potvrzené check-iny přijaté v období.",
                    "on_time_check_ins": (
                        "Serverem potvrzené check-iny, které neřešily prošlý deadline."
                    ),
                    "incident_count": "Incidenty otevřené serverem ve zvoleném období.",
                },
            }
        )


class InvitationAcceptView(APIView):
    @extend_schema(request=InvitationAcceptSerializer, responses={200: GuardianSerializer})
    def post(self, request):
        serializer = InvitationAcceptSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            membership = accept_invitation(
                raw_token=serializer.validated_data["token"], user=request.user
            )
        except DjangoPermissionDenied as exc:
            raise PermissionDenied(str(exc)) from exc
        except DjangoValidationError as exc:
            details = exc.message_dict if hasattr(exc, "message_dict") else exc.messages
            raise ValidationError(details) from exc
        return Response(GuardianSerializer(membership).data)


class ReceivedInvitationListView(generics.ListAPIView):
    serializer_class = ReceivedInvitationSerializer
    pagination_class = None

    def get_queryset(self):
        return GuardianInvitation.objects.filter(
            normalized_email=self.request.user.email.strip().lower(),
            status=GuardianInvitation.Status.PENDING,
            expires_at__gt=timezone.now(),
            profile__archived_at__isnull=True,
        ).select_related("profile", "profile__owner")


class ReceivedInvitationDecisionView(APIView):
    @extend_schema(request=InvitationDecisionSerializer, responses={200: OpenApiTypes.OBJECT})
    def post(self, request, invitation_id):
        serializer = InvitationDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            invitation, membership = respond_to_invitation(
                invitation_id=invitation_id,
                user=request.user,
                decision=serializer.validated_data["decision"],
            )
        except DjangoPermissionDenied as exc:
            raise Http404 from exc
        except DjangoValidationError as exc:
            details = exc.message_dict if hasattr(exc, "message_dict") else exc.messages
            raise ValidationError(details) from exc
        if membership is None:
            return Response(ReceivedInvitationSerializer(invitation).data)
        return Response(GuardianSerializer(membership).data)


class GuardianSelfRevokeView(APIView):
    @extend_schema(request=None, responses={204: None})
    def post(self, request, membership_id):
        membership = get_object_or_404(
            GuardianMembership,
            pk=membership_id,
            guardian=request.user,
            status=GuardianMembership.Status.ACTIVE,
        )
        revoke_guardian_membership(membership=membership, actor=request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class WatchedProfileListView(generics.ListAPIView):
    serializer_class = WatchedProfileSerializer

    def get_queryset(self):
        return (
            CheckInProfile.objects.filter(
                archived_at__isnull=True,
                guardians__guardian=self.request.user,
                guardians__status=GuardianMembership.Status.ACTIVE,
            )
            .select_related("owner")
            .distinct()
        )


class PushDeviceViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = PushDeviceSerializer
    queryset = PushDevice.objects.none()

    def get_queryset(self):
        return PushDevice.objects.filter(user=self.request.user)

    def perform_destroy(self, instance):
        deactivate_push_device(device=instance, actor=self.request.user)


class AlertIncidentViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = AlertIncidentSerializer
    queryset = AlertIncident.objects.none()

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store, private"
        response["Pragma"] = "no-cache"
        return response

    def get_queryset(self):
        return accessible_incidents(self.request.user).select_related("profile")

    @extend_schema(
        request=None,
        responses={200: AlertIncidentSerializer, 409: DetailResponseSerializer},
        description=(
            "Record that an active guardian has taken responsibility for an open incident. "
            "This does not prove notification delivery or resolution."
        ),
    )
    @action(detail=True, methods=["post"])
    def acknowledge(self, request, pk=None):
        incident = self.get_object()
        if incident.status != AlertIncident.Status.OPEN:
            return Response(
                {"detail": "Uzavřený incident už nelze převzít."},
                status=status.HTTP_409_CONFLICT,
            )
        if not can_acknowledge_incident(request.user, incident):
            raise PermissionDenied("Incident může potvrdit pouze jeho aktivní strážce.")
        with transaction.atomic():
            guardian = User.objects.select_for_update().filter(pk=request.user.pk).first()
            if guardian is None:
                raise PermissionDenied("Účet už není aktivní.")
            acknowledgement, _ = AlertAcknowledgement.objects.get_or_create(
                incident=incident,
                user=guardian,
                defaults={
                    "user_id_snapshot": guardian.id,
                    "acknowledged_at": timezone.now(),
                },
            )
        return Response(AlertIncidentSerializer(incident, context={"request": request}).data)
