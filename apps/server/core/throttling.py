from rest_framework.throttling import AnonRateThrottle, SimpleRateThrottle, UserRateThrottle

from .web_rate_limits import _client_ip


class TrustedProxyIdentMixin:
    """Derive throttle identity without trusting client-supplied forwarding headers."""

    def get_ident(self, request):
        return _client_ip(request)


class TrustedProxyAnonRateThrottle(TrustedProxyIdentMixin, AnonRateThrottle):
    pass


class TrustedProxyUserRateThrottle(TrustedProxyIdentMixin, UserRateThrottle):
    pass


class TrustedProxySimpleRateThrottle(TrustedProxyIdentMixin, SimpleRateThrottle):
    pass
