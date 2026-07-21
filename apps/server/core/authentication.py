from django.contrib.auth import get_user_model
from rest_framework_simplejwt.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView


class VerifiedTokenObtainPairSerializer(TokenObtainPairSerializer):
    default_error_messages = {
        "no_active_account": "Přihlašovací údaje nejsou platné nebo e-mail není ověřený."
    }


class VerifiedTokenObtainPairView(TokenObtainPairView):
    serializer_class = VerifiedTokenObtainPairSerializer


class VerifiedTokenRefreshSerializer(TokenRefreshSerializer):
    def validate(self, attrs):
        refresh = self.token_class(attrs["refresh"])
        user_id = refresh.payload.get("user_id")
        is_verified = (
            get_user_model()
            .objects.filter(
                pk=user_id,
                is_active=True,
                email_verified_at__isnull=False,
            )
            .exists()
        )
        if not is_verified:
            raise AuthenticationFailed("E-mail není ověřený.")
        return super().validate(attrs)


class VerifiedTokenRefreshView(TokenRefreshView):
    serializer_class = VerifiedTokenRefreshSerializer
