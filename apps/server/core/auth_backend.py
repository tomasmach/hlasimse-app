from django.contrib.auth.backends import ModelBackend


class VerifiedEmailBackend(ModelBackend):
    """Reject credentials and stale sessions until the e-mail address is verified."""

    def user_can_authenticate(self, user):
        return super().user_can_authenticate(user) and user.email_verified_at is not None
