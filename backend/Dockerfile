# syntax=docker/dockerfile:1.7
FROM python:3.13-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

# Pinned third-party dependencies first (cached layer), then the application.
COPY requirements.lock ./
# Optional: behind a TLS-inspecting proxy, build with `--secret id=cacert,src=/path/to/ca-bundle.crt`.
RUN --mount=type=secret,id=cacert,required=false \
    if [ -f /run/secrets/cacert ]; then export PIP_CERT=/run/secrets/cacert; fi; \
    pip install -r requirements.lock

COPY pyproject.toml alembic.ini ./
COPY alembic ./alembic
COPY app ./app
COPY data ./data
ENV PYTHONPATH=/app

# Unprivileged runtime user; storage is a volume owned by it.
RUN useradd --create-home --uid 10001 lotus && mkdir -p /data/storage && chown -R lotus:lotus /data /app
USER lotus
ENV STORAGE_DIR=/data/storage
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=5 CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health',timeout=3).status==200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
