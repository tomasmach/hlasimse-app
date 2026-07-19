from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .views import (
    AccountDeleteView,
    AccountExportView,
    AlertIncidentViewSet,
    CheckInHistoryView,
    CheckInStatisticsView,
    GuardianSelfRevokeView,
    InvitationAcceptView,
    LogoutView,
    MeView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    ProfileViewSet,
    PushDeviceViewSet,
    ReceivedInvitationDecisionView,
    ReceivedInvitationListView,
    RegisterView,
    WatchedProfileListView,
)

router = DefaultRouter()
router.register("profiles", ProfileViewSet, basename="profile")
router.register("push-devices", PushDeviceViewSet, basename="push-device")
router.register("alerts", AlertIncidentViewSet, basename="alert")

urlpatterns = [
    path("auth/register/", RegisterView.as_view(), name="register"),
    path("auth/token/", TokenObtainPairView.as_view(), name="token"),
    path("auth/token/refresh/", TokenRefreshView.as_view(), name="token-refresh"),
    path("auth/logout/", LogoutView.as_view(), name="logout"),
    path("auth/me/", MeView.as_view(), name="me"),
    path("auth/password-reset/", PasswordResetRequestView.as_view(), name="password-reset"),
    path(
        "auth/password-reset/confirm/",
        PasswordResetConfirmView.as_view(),
        name="password-reset-confirm",
    ),
    path("account/export/", AccountExportView.as_view(), name="account-export"),
    path("account/", AccountDeleteView.as_view(), name="account-delete"),
    path("check-ins/", CheckInHistoryView.as_view(), name="check-in-history"),
    path("statistics/", CheckInStatisticsView.as_view(), name="check-in-statistics"),
    path("guardian-invitations/accept/", InvitationAcceptView.as_view(), name="invite-accept"),
    path(
        "guardian-invitations/",
        ReceivedInvitationListView.as_view(),
        name="received-invitations",
    ),
    path(
        "guardian-invitations/<uuid:invitation_id>/respond/",
        ReceivedInvitationDecisionView.as_view(),
        name="received-invitation-respond",
    ),
    path(
        "guardian-memberships/<uuid:membership_id>/revoke/",
        GuardianSelfRevokeView.as_view(),
        name="guardian-self-revoke",
    ),
    path("watched-profiles/", WatchedProfileListView.as_view(), name="watched-profiles"),
    path("", include(router.urls)),
]
