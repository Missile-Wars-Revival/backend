#!/usr/bin/env bash
# Phase 12 updater for a self-hosted Missile Wars shard (git-checkout mode).
#
# Run automatically by runners/coordinatorClient.ts when the coordinator says an
# update is available/required, OR manually by a host:  ./docker/update.sh
#
# It fetches the approved release tag/commit, verifies the version matches the
# coordinator's release metadata, rebuilds the stack (preserving .env and the
# Postgres volume), runs migrations, restarts the backend, and health-checks it.
# On any failure it rolls back to the previous commit, keeps the old container
# running, and writes docker/.update-result.json so the shard reports the
# failure in its next heartbeat. A success needs no report: the freshly booted
# backend heartbeats its new version on startup.
#
# Requirements: this must run where `docker compose` and `git` work for this
# checkout — i.e. on the host (or a container with the docker socket and repo
# mounted). See README "Auto-update".
set -uo pipefail

cd "$(dirname "$0")/.."  # backend/ repo root

RESULT_FILE="docker/.update-result.json"
LOCK_FILE="docker/.update.lock"

read_version() {
  node -e 'console.log(require("./package.json").version)' 2>/dev/null \
    || sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -n 1
}

FROM="${UPDATE_FROM_VERSION:-$(read_version)}"
TO="${RELEASE_VERSION:-}"

now_ms() { echo "$(date +%s)000"; }

fail() {
  local reason="$1"
  printf '{"ok":false,"fromVersion":"%s","toVersion":"%s","reason":"%s","at":%s}\n' \
    "$FROM" "$TO" "$reason" "$(now_ms)" > "$RESULT_FILE"
  rm -f "$LOCK_FILE"
  echo "[update] FAILED: $reason"
  exit 1
}

# Serialize: a lock left by a concurrent run blocks this one.
if [ -f "$LOCK_FILE" ]; then
  echo "[update] another update is already running ($LOCK_FILE present) — exiting."
  exit 0
fi
now_ms > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  fail "docker compose not found"
fi

command -v git >/dev/null 2>&1 || fail "git not found"
PREV_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo "")"
[ -n "$PREV_COMMIT" ] || fail "not a git checkout (cannot determine current commit)"

echo "[update] $FROM -> ${TO:-latest}  (current commit ${PREV_COMMIT:0:8})"

# 1. Fetch the approved release.
git fetch --tags --force origin >/dev/null 2>&1 || fail "git fetch failed"

# Prefer the annotated release tag backend-vX.Y.Z; fall back to the pinned SHA.
REF=""
if [ -n "$TO" ] && git rev-parse --verify --quiet "backend-v$TO^{commit}" >/dev/null 2>&1; then
  REF="backend-v$TO"
elif [ -n "${RELEASE_GIT_SHA:-}" ]; then
  REF="$RELEASE_GIT_SHA"
else
  fail "no matching release tag (backend-v$TO) or RELEASE_GIT_SHA to check out"
fi

git checkout --quiet "$REF" 2>/dev/null || fail "git checkout $REF failed"

# 2. Verify the checked-out version matches coordinator metadata.
NEWV="$(read_version)"
if [ -n "$TO" ] && [ "$NEWV" != "$TO" ]; then
  git checkout --quiet "$PREV_COMMIT" 2>/dev/null || true
  fail "version mismatch: checked out $NEWV, expected $TO"
fi

# 3-6. Rebuild + migrate + restart. compose preserves .env (gitignored) and the
# db-data volume; the migrate service runs as a dependency of `up`.
if ! $COMPOSE up -d --build; then
  echo "[update] build/start failed — rolling back to ${PREV_COMMIT:0:8}"
  git checkout --quiet "$PREV_COMMIT" 2>/dev/null || true
  $COMPOSE up -d --build >/dev/null 2>&1 || true
  fail "docker compose up failed"
fi

# 7. Health check.
PORT="$(sed -n 's/^[[:space:]]*PORT=//p' .env | tail -n 1)"
PORT="${PORT:-8080}"
HEALTHY=""
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://localhost:${PORT}/healthz" >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 2
done
if [ -z "$HEALTHY" ]; then
  echo "[update] new version unhealthy — rolling back to ${PREV_COMMIT:0:8}"
  git checkout --quiet "$PREV_COMMIT" 2>/dev/null || true
  $COMPOSE up -d --build >/dev/null 2>&1 || true
  fail "health check failed after update; rolled back"
fi

# 8. Success. The restarted backend sends an immediate heartbeat with $NEWV.
rm -f "$RESULT_FILE"
echo "[update] OK — now running v$NEWV"
