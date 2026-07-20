import os


def positive_int(name: str, default: int) -> int:
    value = int(os.getenv(name, str(default)))
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


bind = "0.0.0.0:8000"
workers = positive_int("GUNICORN_WORKERS", 2)
threads = positive_int("GUNICORN_THREADS", 4)
worker_class = "gthread"
timeout = positive_int("GUNICORN_TIMEOUT_SECONDS", 30)
graceful_timeout = positive_int("GUNICORN_GRACEFUL_TIMEOUT_SECONDS", 30)
keepalive = positive_int("GUNICORN_KEEPALIVE_SECONDS", 5)
max_requests = positive_int("GUNICORN_MAX_REQUESTS", 1000)
max_requests_jitter = positive_int("GUNICORN_MAX_REQUESTS_JITTER", 100)
worker_tmp_dir = "/dev/shm"

# Raw request lines and Referer values can contain one-time verification or
# password-reset tokens. Django emits route-pattern JSON access logs instead.
accesslog = None
errorlog = "-"
capture_output = True
loglevel = os.getenv("GUNICORN_LOG_LEVEL", "info")
forwarded_allow_ips = os.getenv("GUNICORN_FORWARDED_ALLOW_IPS", "127.0.0.1")
control_socket_disable = True
limit_request_line = 4094
limit_request_fields = 100
limit_request_field_size = 8190
