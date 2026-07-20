import json
import logging
import uuid
from types import SimpleNamespace

from django.http import HttpResponse
from django.test import RequestFactory

from core.request_logging import CorrelationIdMiddleware, JsonFormatter


def test_correlation_middleware_accepts_only_uuid_and_returns_it_to_client():
    request_id = str(uuid.uuid4())
    request = RequestFactory().get("/health/live/", HTTP_X_REQUEST_ID=request_id)
    request.resolver_match = SimpleNamespace(route="health/live/")

    response = CorrelationIdMiddleware(lambda _request: HttpResponse())(request)

    assert response["X-Request-ID"] == request_id

    invalid = RequestFactory().get("/health/live/", HTTP_X_REQUEST_ID="log\nforgery")
    invalid.resolver_match = SimpleNamespace(route="health/live/")
    invalid_response = CorrelationIdMiddleware(lambda _request: HttpResponse())(invalid)
    assert invalid_response["X-Request-ID"] != "log\nforgery"
    uuid.UUID(invalid_response["X-Request-ID"])


def test_json_request_log_uses_route_pattern_and_never_raw_token_url():
    secret = "one-time-secret-token"
    request = RequestFactory().get(
        f"/ucet/overeni-emailu/{secret}/?email=private@example.test",
        HTTP_REFERER=f"https://example.test/{secret}",
    )
    request.resolver_match = SimpleNamespace(route="ucet/overeni-emailu/<str:token>/")
    record = logging.LogRecord(
        name="django.request",
        level=logging.WARNING,
        pathname=__file__,
        lineno=1,
        msg=f"Not Found: {request.get_full_path()}",
        args=(),
        exc_info=None,
    )
    record.request = request
    record.status_code = 404

    payload = JsonFormatter().format(record)
    decoded = json.loads(payload)

    assert decoded["message"] == "django_request_error"
    assert decoded["route"] == "ucet/overeni-emailu/<str:token>/"
    assert secret not in payload
    assert "private@example.test" not in payload
    assert "Referer" not in payload
