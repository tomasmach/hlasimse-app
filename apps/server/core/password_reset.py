from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken


def revoke_outstanding_refresh_tokens(*, user) -> None:
    """Revoke every refresh token issued before a password reset completes."""
    outstanding_tokens = OutstandingToken.objects.select_for_update().filter(user=user)
    for outstanding_token in outstanding_tokens:
        BlacklistedToken.objects.get_or_create(token=outstanding_token)
