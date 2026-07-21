import hashlib
import hmac
import ipaddress
import math
import time
from collections.abc import Callable
from dataclasses import dataclass
from functools import wraps

from django.conf import settings
from django.core.cache import cache
from django.http import HttpRequest, HttpResponse
from django.shortcuts import render


@dataclass(frozen=True)
class RateLimit:
    limit: int
    period: int


def _trusted_proxy_networks() -> tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]:
    return tuple(
        ipaddress.ip_network(value, strict=False)
        for value in getattr(settings, "WEB_TRUSTED_PROXY_CIDRS", ())
    )


def _client_ip(request: HttpRequest) -> str:
    """Return the nearest untrusted address without trusting arbitrary forwarding headers."""
    raw_peer = request.META.get("REMOTE_ADDR", "")
    try:
        peer = ipaddress.ip_address(raw_peer)
    except ValueError:
        return "unknown"

    trusted_networks = _trusted_proxy_networks()
    if not any(peer in network for network in trusted_networks):
        return peer.compressed

    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    chain: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    for raw_address in forwarded.split(","):
        try:
            chain.append(ipaddress.ip_address(raw_address.strip()))
        except ValueError:
            return peer.compressed
    chain.append(peer)

    while len(chain) > 1 and any(chain[-1] in network for network in trusted_networks):
        chain.pop()
    return chain[-1].compressed


def _private_digest(value: str) -> str:
    return hmac.new(
        settings.SECRET_KEY.encode(),
        value.encode(),
        hashlib.sha256,
    ).hexdigest()


def _consume(*, scope: str, dimension: str, value: str, rate: RateLimit) -> int | None:
    """Consume one fixed-window slot using cache.add, which is atomic across workers."""
    now = int(time.time())
    window = now // rate.period
    digest = _private_digest(value)
    prefix = f"web-auth-rate:v1:{scope}:{dimension}:{digest}:{window}"
    timeout = rate.period + 1
    for slot in range(rate.limit):
        if cache.add(f"{prefix}:{slot}", "1", timeout=timeout):
            return None
    return rate.period - (now % rate.period)


def _configured_rate(scope: str, dimension: str) -> RateLimit | None:
    raw_rate = settings.WEB_AUTH_RATE_LIMITS.get(scope, {}).get(dimension)
    if raw_rate is None:
        return None
    limit, period = raw_rate
    return RateLimit(limit=int(limit), period=int(period))


def auth_rate_limit_response(
    request: HttpRequest,
    *,
    scope: str,
    identity: str | None = None,
) -> HttpResponse | None:
    dimensions = (("ip", _client_ip(request)), ("identity", identity))
    retry_after: list[int] = []
    for dimension, value in dimensions:
        rate = _configured_rate(scope, dimension)
        if rate is None or not value:
            continue
        blocked_for = _consume(
            scope=scope,
            dimension=dimension,
            value=value.strip().casefold(),
            rate=rate,
        )
        if blocked_for is not None:
            retry_after.append(blocked_for)

    if not retry_after:
        return None

    wait_seconds = max(retry_after)
    response = render(
        request,
        "core/auth/rate_limited.html",
        {
            "retry_after_seconds": wait_seconds,
            "retry_after_minutes": max(1, math.ceil(wait_seconds / 60)),
        },
        status=429,
    )
    response["Retry-After"] = str(wait_seconds)
    response["Cache-Control"] = "no-store"
    return response


def web_auth_rate_limit(
    scope: str,
    *,
    identity: Callable[[HttpRequest, tuple, dict], str | None] | None = None,
):
    def decorator(view):
        @wraps(view)
        def wrapped(request, *args, **kwargs):
            if request.method == "POST":
                identity_value = identity(request, args, kwargs) if identity is not None else None
                response = auth_rate_limit_response(
                    request,
                    scope=scope,
                    identity=identity_value,
                )
                if response is not None:
                    return response
            return view(request, *args, **kwargs)

        return wrapped

    return decorator


class WebAuthRateLimitMixin:
    rate_limit_scope = ""
    rate_limit_identity_field: str | None = None

    def post(self, request, *args, **kwargs):
        identity = (
            request.POST.get(self.rate_limit_identity_field)
            if self.rate_limit_identity_field
            else kwargs.get("uidb64")
        )
        response = auth_rate_limit_response(
            request,
            scope=self.rate_limit_scope,
            identity=identity,
        )
        if response is not None:
            return response
        return super().post(request, *args, **kwargs)
