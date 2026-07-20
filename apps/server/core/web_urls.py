from django.urls import include, path

from . import web_views

core_patterns = (
    [
        path("", web_views.LandingView.as_view(), name="landing"),
        path("prehled/", web_views.DashboardView.as_view(), name="dashboard"),
    ],
    "core",
)

account_patterns = (
    [
        path("registrace/", web_views.register_view, name="register"),
        path(
            "overeni-emailu/odeslano/",
            web_views.verification_sent_view,
            name="verification-sent",
        ),
        path(
            "overeni-emailu/odeslat-znovu/",
            web_views.resend_verification_view,
            name="resend-verification",
        ),
        path(
            "overeni-emailu/<str:token>/",
            web_views.verify_email_view,
            name="verify-email",
        ),
        path("prihlaseni/", web_views.SessionLoginView.as_view(), name="login"),
        path("odhlaseni/", web_views.SessionLogoutView.as_view(), name="logout"),
        path("obnova-hesla/", web_views.SecurePasswordResetView.as_view(), name="password_reset"),
        path(
            "obnova-hesla/odeslano/",
            web_views.SecurePasswordResetDoneView.as_view(),
            name="password_reset_done",
        ),
        path(
            "obnova-hesla/<uidb64>/<token>/",
            web_views.SecurePasswordResetConfirmView.as_view(),
            name="password_reset_confirm",
        ),
        path(
            "obnova-hesla/hotovo/",
            web_views.SecurePasswordResetCompleteView.as_view(),
            name="password_reset_complete",
        ),
        path("nastaveni/", web_views.settings_view, name="settings"),
        path("export/", web_views.export_data_view, name="export"),
        path("smazat/", web_views.delete_account_view, name="delete"),
    ],
    "accounts",
)

checkin_patterns = (
    [
        path("profily/novy/", web_views.profile_create_view, name="profile-create"),
        path("profily/<uuid:pk>/", web_views.profile_detail_view, name="profile-detail"),
        path("profily/<uuid:pk>/upravit/", web_views.profile_edit_view, name="profile-edit"),
        path("profily/<uuid:pk>/ohlasit/", web_views.check_in_view, name="check-in"),
        path("profily/<uuid:pk>/pauza/", web_views.profile_pause_view, name="profile-pause"),
        path("historie/", web_views.history_view, name="history"),
    ],
    "checkins",
)

guardian_patterns = (
    [
        path("", web_views.guardians_view, name="list"),
        path("pozvat/", web_views.guardian_invite_view, name="invite"),
        path("<uuid:pk>/odebrat/", web_views.guardian_remove_view, name="remove"),
        path("pozvanky/<uuid:pk>/odpovedet/", web_views.guardian_respond_view, name="respond"),
    ],
    "guardians",
)

alert_patterns = (
    [
        path("<uuid:pk>/", web_views.alert_detail_view, name="detail"),
        path("<uuid:pk>/prevzit/", web_views.alert_ack_view, name="ack"),
    ],
    "alerts",
)

urlpatterns = [
    path("", include(core_patterns, namespace="core")),
    path("ucet/", include(account_patterns, namespace="accounts")),
    path("", include(checkin_patterns, namespace="checkins")),
    path("strazci/", include(guardian_patterns, namespace="guardians")),
    path("upozorneni/", include(alert_patterns, namespace="alerts")),
]
