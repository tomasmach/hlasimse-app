from django.conf import settings


def public_support(_request):
    return {
        "support_email": settings.SUPPORT_EMAIL,
        "support_url": f"{settings.APP_BASE_URL}/podpora/",
    }
