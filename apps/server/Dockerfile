# syntax=docker/dockerfile:1.7

ARG PYTHON_IMAGE=python:3.14.6-slim-bookworm@sha256:86f975aca15cf04a40b399eebede9aea7c82eae084d1f1a0a6ef6bcaae871a30
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.11.29@sha256:eb2843a1e56fd9e30c7276ce1a52cba86e64c7b385f5e3279a0e08e02dd058fc

FROM ${UV_IMAGE} AS uv-bin

FROM ${PYTHON_IMAGE} AS builder

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

FROM ${PYTHON_IMAGE} AS runtime

ENV DJANGO_DEBUG=false \
    PATH="/app/.venv/bin:${PATH}" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && \
    apt-get install --no-install-recommends --yes ca-certificates tzdata && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd --gid 10001 app && \
    useradd --uid 10001 --gid app --no-create-home --home-dir /nonexistent app

WORKDIR /app
COPY --from=builder --chown=app:app /app /app

USER 10001:10001
EXPOSE 8000
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import urllib.request; request = urllib.request.Request('http://127.0.0.1:8000/health/live/', headers={'X-Forwarded-Proto': 'https'}); urllib.request.urlopen(request, timeout=3).read()"]

CMD ["gunicorn", "--config", "config/gunicorn.py", "config.wsgi:application"]
