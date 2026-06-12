#!/usr/bin/env bash
# One-click host launcher for a self-hosted Missile Wars shard.
#
# Does everything a community host needs, in order:
#   1. Checks Docker + the compose plugin are installed (with install links).
#   2. Runs docker/setup.sh on first launch (generates local secrets in .env).
#   3. Optionally registers this shard with the coordinator and saves
#      COORDINATOR_URL + SHARD_API_KEY into .env.
#   4. Starts the stack: docker compose up -d --build
#   5. Verifies the shard locally (/healthz) and probes public reachability,
#      with guidance when the port looks closed from the internet.
#
# Usage:  ./docker/host.sh   (from anywhere; it cd's to the repo root)
set -euo pipefail

cd "$(dirname "$0")/.."

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✘\033[0m %s\n' "$*"; }

# ---------------------------------------------------------------- step 1: deps
bold "1/5 Checking Docker..."

if ! command -v curl >/dev/null 2>&1; then
    fail "curl is required by this script. Install it (e.g. apt install curl) and re-run."
    exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
    fail "Docker is not installed."
    case "$(uname -s)" in
        Linux)
            echo "  Install Docker Engine (includes the compose plugin):"
            echo "    https://docs.docker.com/engine/install/"
            echo "  Quick install on most distros:"
            echo "    curl -fsSL https://get.docker.com | sh"
            ;;
        Darwin)
            echo "  Install Docker Desktop for Mac:"
            echo "    https://docs.docker.com/desktop/setup/install/mac-install/"
            ;;
        *)
            echo "  On Windows, use docker/host.ps1 in PowerShell, or install Docker Desktop:"
            echo "    https://docs.docker.com/desktop/setup/install/windows-install/"
            ;;
    esac
    echo "  Then re-run ./docker/host.sh"
    exit 1
fi

if ! docker info >/dev/null 2>&1; then
    fail "Docker is installed but the daemon is not running (or you lack permission)."
    echo "  Start Docker (Desktop) or: sudo systemctl start docker"
    echo "  To run docker without sudo:  sudo usermod -aG docker \$USER  (then log out/in)"
    exit 1
fi

if docker compose version >/dev/null 2>&1; then
    COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE="docker-compose"
else
    fail "The Docker compose plugin is missing."
    echo "  Install it: https://docs.docker.com/compose/install/"
    exit 1
fi
ok "Docker is ready ($COMPOSE)"

# ------------------------------------------------------------- step 2: secrets
bold "2/5 Local secrets (.env)..."
if [ -f .env ]; then
    ok ".env already exists — keeping it"
else
    ./docker/setup.sh
fi

# Read a KEY=value from .env (last occurrence wins; ignores commented lines).
env_get() {
    sed -n "s/^[[:space:]]*$1=//p" .env | tail -n 1
}

PORT="$(env_get PORT)"
PORT="${PORT:-8080}"

# -------------------------------------------------------- step 3: registration
bold "3/5 Coordinator registration (optional)..."

COORDINATOR_URL="$(env_get COORDINATOR_URL)"
SHARD_API_KEY="$(env_get SHARD_API_KEY)"

json_field() { # json_field <json> <key>  — crude extractor, prefers jq
    if command -v jq >/dev/null 2>&1; then
        printf '%s' "$1" | jq -r ".. | .${2}? // empty" | head -n 1
    else
        printf '%s' "$1" | sed -n "s/.*\"${2}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n 1
    fi
}

if [ -n "$COORDINATOR_URL" ] && [ -n "$SHARD_API_KEY" ]; then
    ok "Already registered (COORDINATOR_URL + SHARD_API_KEY set) — heartbeats enabled"
elif [ ! -t 0 ]; then
    warn "Non-interactive shell — skipping registration. Shard runs standalone."
else
    printf 'Register this shard with a coordinator so players can discover it? [y/N] '
    read -r REPLY
    if [ "$REPLY" = "y" ] || [ "$REPLY" = "Y" ]; then
        PUBLIC_IP="$(curl -fsS --max-time 5 https://api.ipify.org || true)"
        printf 'Coordinator URL (e.g. https://coordinator.example.com): '
        read -r REG_COORD
        REG_COORD="${REG_COORD%/}"
        printf 'Shard name (shown to players): '
        read -r REG_NAME
        printf 'Region (e.g. eu-west, us-east): '
        read -r REG_REGION
        DEFAULT_HTTP="http://${PUBLIC_IP:-YOUR_PUBLIC_IP}:${PORT}"
        printf 'Public HTTP URL [%s]: ' "$DEFAULT_HTTP"
        read -r REG_HTTP
        REG_HTTP="${REG_HTTP:-$DEFAULT_HTTP}"
        DEFAULT_WS="$(printf '%s' "$REG_HTTP" | sed 's/^http/ws/')"
        printf 'Public WebSocket URL [%s]: ' "$DEFAULT_WS"
        read -r REG_WS
        REG_WS="${REG_WS:-$DEFAULT_WS}"
        printf 'Owner contact (email/discord, optional): '
        read -r REG_CONTACT

        BODY=$(printf '{"name":"%s","region":"%s","publicHttpUrl":"%s","publicWsUrl":"%s","ownerContact":"%s"}' \
            "$REG_NAME" "$REG_REGION" "$REG_HTTP" "$REG_WS" "$REG_CONTACT")
        echo "Registering with $REG_COORD ..."
        RESPONSE="$(curl -fsS --max-time 15 -H 'Content-Type: application/json' \
            -d "$BODY" "$REG_COORD/shards/register")" || {
            fail "Registration failed — check the coordinator URL and try again later."
            echo "  The shard will still start; re-run ./docker/host.sh to retry."
            RESPONSE=""
        }
        if [ -n "$RESPONSE" ]; then
            API_KEY="$(json_field "$RESPONSE" apiKey)"
            SHARD_ID="$(json_field "$RESPONSE" shardId)"
            if [ -n "$API_KEY" ]; then
                {
                    echo ""
                    echo "# Coordinator registration (written by docker/host.sh; key shown once by the coordinator)"
                    echo "COORDINATOR_URL=$REG_COORD"
                    echo "SHARD_API_KEY=$API_KEY"
                    echo "SHARD_ID=$SHARD_ID"
                } >> .env
                ok "Registered (shard id: ${SHARD_ID:-unknown}). API key saved to .env — it is revocable and safe to keep here."
                COORDINATOR_URL="$REG_COORD"
            else
                fail "Unexpected response from coordinator:"
                echo "  $RESPONSE"
            fi
        fi
    else
        echo "Skipping — the shard runs standalone. Re-run ./docker/host.sh any time to register."
    fi
fi

# ------------------------------------------------------------- step 4: launch
bold "4/5 Starting the shard (this builds the image on first run)..."
$COMPOSE up -d --build

# ------------------------------------------------------- step 5: reachability
bold "5/5 Checking the shard is reachable..."

HEALTH_OK=""
for _ in $(seq 1 30); do
    if curl -fsS --max-time 2 "http://localhost:${PORT}/healthz" >/dev/null 2>&1; then
        HEALTH_OK=1
        break
    fi
    sleep 2
done

if [ -n "$HEALTH_OK" ]; then
    ok "Shard is up locally: http://localhost:${PORT}/healthz"
else
    fail "Shard did not become healthy within 60s."
    echo "  Inspect logs with: $COMPOSE logs -f backend"
    exit 1
fi

PUBLIC_IP="$(curl -fsS --max-time 5 https://api.ipify.org || true)"
if [ -z "$PUBLIC_IP" ]; then
    warn "Could not determine your public IP — skipping the port-forwarding check."
else
    if curl -fsS --max-time 8 "http://${PUBLIC_IP}:${PORT}/healthz" >/dev/null 2>&1; then
        ok "Publicly reachable!  Players connect via: http://${PUBLIC_IP}:${PORT}"
    else
        warn "Could not reach http://${PUBLIC_IP}:${PORT}/healthz from this machine."
        echo "  Port ${PORT} looks closed from the internet. To fix:"
        echo "   - Home network: forward TCP ${PORT} to this machine on your router."
        echo "   - VPS/cloud:    open TCP ${PORT} in the provider firewall/security group."
        echo "   - Linux host:   allow it locally, e.g.  sudo ufw allow ${PORT}/tcp"
        echo "  Note: some home routers block 'hairpin' connections from inside the same"
        echo "  network, so this probe can be a false negative — ask someone outside your"
        echo "  network to open the URL above to confirm."
    fi
fi

echo ""
bold "Done. Useful commands:"
echo "  $COMPOSE logs -f backend    # tail server logs"
echo "  $COMPOSE down               # stop (DB data persists)"
echo "  ./docker/host.sh            # restart / re-check any time"
