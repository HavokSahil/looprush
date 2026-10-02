FROM node:24-bookworm-slim AS frontend
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
RUN npm run build

FROM python:3.13-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app

RUN groupadd --gid 10001 looprush \
    && useradd --uid 10001 --gid looprush --no-create-home --shell /usr/sbin/nologin looprush \
    && mkdir /data \
    && chown looprush:looprush /data

COPY server.py cosmetics.py ./
COPY --from=frontend /app/dist ./dist

USER looprush
EXPOSE 8000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8000/api/ping", timeout=3).read()'

ENTRYPOINT ["python", "server.py"]
CMD ["--host", "0.0.0.0", "--port", "8000", "--db", "/data/data.sqlite3"]
