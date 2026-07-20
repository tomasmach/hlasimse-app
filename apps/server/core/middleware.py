import re
from collections.abc import Callable

from django.conf import settings
from django.http import HttpRequest, HttpResponse, JsonResponse

from .versioning import InvalidSemVer, parse_semver

MOBILE_CLIENT = "hlasimse-mobile"
CLIENT_CONFIG_PATH = "/api/v1/client-config/"
API_PREFIX = "/api/v1/"
BUILD_PATTERN = re.compile(r"^[1-9]\d*$")


def _error_response(*, status: int, code: str, detail: str, **extra: object) -> JsonResponse:
    return JsonResponse({"code": code, "detail": detail, **extra}, status=status)


class MobileReleaseGateMiddleware:
    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        if not request.path.startswith(API_PREFIX) or request.path == CLIENT_CONFIG_PATH:
            return self.get_response(request)

        if settings.MOBILE_API_MAINTENANCE:
            response = _error_response(
                status=503,
                code="maintenance",
                detail=(
                    "Služba je dočasně v údržbě. Ohlášení nyní server nepotvrdí; "
                    "zkuste to prosím znovu později."
                ),
            )
            response["Retry-After"] = str(settings.MOBILE_MAINTENANCE_RETRY_AFTER_SECONDS)
            return response

        if request.headers.get("X-Hlasimse-Client") != MOBILE_CLIENT:
            return self.get_response(request)

        platform = request.headers.get("X-Hlasimse-Platform", "")
        version = request.headers.get("X-Hlasimse-Version", "")
        build = request.headers.get("X-Hlasimse-Build", "")
        if platform not in settings.MOBILE_RELEASES or not BUILD_PATTERN.fullmatch(build):
            return _error_response(
                status=400,
                code="invalid_client_metadata",
                detail="Mobilní klient neposlal platnou platformu a identifikaci buildu.",
            )
        try:
            parsed_version = parse_semver(version)
        except InvalidSemVer:
            return _error_response(
                status=400,
                code="invalid_client_version",
                detail="Mobilní klient neposlal platnou sémantickou verzi.",
            )

        release = settings.MOBILE_RELEASES[platform]
        if parsed_version < release["parsed_min_version"] or int(build) < release["min_build"]:
            return _error_response(
                status=426,
                code="update_required",
                detail=(
                    "Tato verze aplikace už není bezpečně podporovaná. "
                    "Před dalším použitím ji aktualizujte."
                ),
                min_version=release["min_version"],
                min_build=release["min_build"],
                store_url=release["store_url"],
            )

        return self.get_response(request)
