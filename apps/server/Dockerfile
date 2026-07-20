# syntax=docker/dockerfile:1.7

ARG PYTHON_BUILDER_IMAGE=cgr.dev/chainguard/python:latest-dev@sha256:31d318170df60ddec4b04ed595cbe79c33eeb2cf94f9676db6f9eaf46542e6be
ARG PYTHON_RUNTIME_IMAGE=cgr.dev/chainguard/python:latest@sha256:2c6a2e8bdeb1336cd8545d3586d1c1e5b4f7564ef00924b0447ebfbe57a549ee
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.11.29@sha256:eb2843a1e56fd9e30c7276ce1a52cba86e64c7b385f5e3279a0e08e02dd058fc

FROM ${UV_IMAGE} AS uv-bin

FROM ${PYTHON_BUILDER_IMAGE} AS builder

USER 0

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

COPY --from=uv-bin /uv /uvx /bin/
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

COPY . ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable && \
    DJANGO_DEBUG=true DJANGO_STATIC_MANIFEST=true \
    .venv/bin/python manage.py collectstatic --noinput

FROM ${PYTHON_RUNTIME_IMAGE} AS runtime

ENV DJANGO_DEBUG=false \
    PATH="/app/.venv/bin:${PATH}" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY --from=builder --chown=10001:10001 /app /app

USER 10001:10001
ENTRYPOINT []
EXPOSE 8000
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; host = os.environ['DJANGO_ALLOWED_HOSTS'].split(',')[0].strip(); request = urllib.request.Request('http://127.0.0.1:8000/health/live/', headers={'Host': host, 'X-Forwarded-Proto': 'https'}); urllib.request.urlopen(request, timeout=3).read()"]

CMD ["gunicorn", "--config", "config/gunicorn.py", "config.wsgi:application"]
