from django.urls import include, path
from django.views.generic import RedirectView

from . import web_views

core_patterns = (
    [
        path("", web_views.LandingView.as_view(), name="landing"),
        path("robots.txt", web_views.robots_view, name="robots"),
        path("sitemap.xml", web_views.sitemap_view, name="sitemap"),
        path(
            "ochrana-soukromi.html",
            RedirectView.as_view(pattern_name="core:privacy", permanent=True),
            name="privacy-legacy",
        ),
        path(
            "obchodni-podminky.html",
            RedirectView.as_view(pattern_name="core:terms", permanent=True),
            name="terms-legacy",
        ),
        path("prehled/", web_views.DashboardView.as_view(), name="dashboard"),
        path(
            "ochrana-soukromi/",
            web_views.legal_release_blocker_view,
            {"document": "privacy"},
            name="privacy",
        ),
        path(
            "obchodni-podminky/",
            web_views.legal_release_blocker_view,
            {"document": "terms"},
            name="terms",
        ),
        path("podpora/", web_views.support_view, name="support"),
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
            "overeni-emailu/potvrdit/",
            web_views.confirm_email_verification_view,
            name="verify-email-confirm",
        ),
        path(
            "overeni-emailu/<str:token>/",
            web_views.stage_email_verification_view,
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
        path(
            "ohlaseni/<uuid:pk>/poloha/smazat/",
            web_views.checkin_location_delete_view,
            name="check-in-location-delete",
        ),
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
        path(
            "sledovane/<uuid:pk>/ukoncit/",
            web_views.guardian_self_revoke_view,
            name="self-revoke",
        ),
        path(
            "pozvanky/<uuid:pk>/zrusit/",
            web_views.guardian_invite_revoke_view,
            name="invite-revoke",
        ),
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
