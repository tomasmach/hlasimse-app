from rest_framework.permissions import BasePermission


class IsVerifiedUser(BasePermission):
    message = "Před pokračováním je nutné ověřit e-mail."

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.email_verified_at is not None
        )
