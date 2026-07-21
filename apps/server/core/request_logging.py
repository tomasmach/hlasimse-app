import contextvars
import json
import logging
import time
import uuid
from datetime import UTC, datetime

from django.http import HttpRequest, HttpResponse

request_id_context: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="")


def _request_id(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except ValueError, TypeError, AttributeError:
        return str(uuid.uuid4())


def _route(request: HttpRequest | None) -> str:
    match = getattr(request, "resolver_match", None)
    return match.route if match is not None and match.route else "unresolved"


class JsonFormatter(logging.Formatter):
    """Emit bounded structured logs without raw URL params, query strings, or request bodies."""

    def format(self, record: logging.LogRecord) -> str:
        message = "django_request_error" if record.name == "django.request" else record.getMessage()
        payload: dict[str, object] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": message,
        }
        correlation_id = getattr(record, "request_id", "") or request_id_context.get()
        if correlation_id:
            payload["request_id"] = correlation_id
        request = getattr(record, "request", None)
        if request is not None:
            payload["route"] = _route(request)
        for name in ("method", "route", "status_code", "duration_ms"):
            value = getattr(record, name, None)
            if value is not None:
                payload[name] = value
        if record.exc_info:
            payload["exception_type"] = record.exc_info[0].__name__
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


class CorrelationIdMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
        self.logger = logging.getLogger("core.request")

    def __call__(self, request: HttpRequest) -> HttpResponse:
        request_id = _request_id(request.headers.get("X-Request-ID", ""))
        request.correlation_id = request_id
        token = request_id_context.set(request_id)
        started = time.monotonic()
        try:
            response = self.get_response(request)
            response["X-Request-ID"] = request_id
            self.logger.info(
                "request_finished",
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "route": _route(request),
                    "status_code": response.status_code,
                    "duration_ms": round((time.monotonic() - started) * 1000, 2),
                },
            )
            return response
        finally:
            request_id_context.reset(token)
