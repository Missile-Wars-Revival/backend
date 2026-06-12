#!/bin/sh
# Container entrypoint: build DATABASE_URL from the compose-provided Postgres
# parts so the connection string never has to be hand-written or shared.
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
    : "${POSTGRES_HOST:=db}"
    : "${POSTGRES_USER:=missilewars}"
    : "${POSTGRES_DB:=missilewars}"
    if [ -z "${POSTGRES_PASSWORD:-}" ]; then
        echo "POSTGRES_PASSWORD is not set — run docker/setup.sh on the host to generate .env" >&2
        exit 1
    fi
    export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:5432/${POSTGRES_DB}"
fi

exec "$@"
