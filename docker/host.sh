#!/usr/bin/env bash
# One-click host launcher for a self-hosted Missile Wars shard.
#
# Does everything a community host needs, in order:
#   1. Checks Docker + the compose plugin are installed (with install links).
#   2. Runs docker/setup.sh on first launch (generates local secrets in .env).
#   3. Registers this shard with the official coordinator and saves
#      COORDINATOR_URL + SHARD_API_KEY + SHARD_ID into .env.
#   4. Starts the stack: docker compose up -d --build
#   5. Verifies the shard locally (/healthz) and probes public reachability,
#      with guidance when the port looks closed from the internet.
#
# Usage:  ./docker/host.sh   (from anywhere; it cd's to the repo root)
set -euo pipefail

cd "$(dirname "$0")/.."

OFFICIAL_COORDINATOR_URL="https://backend-coordinator.vercel.app"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '[OK] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*"; }
fail() { printf '[FAIL] %s\n' "$*"; }

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
    case "$(uname -s)" in
        Darwin)
            echo "  Start Docker Desktop from Applications, wait until it says Docker is running,"
            echo "  then re-run ./docker/host.sh."
            echo "  macOS does not use systemctl, so 'sudo systemctl start docker' will not work."
            ;;
        Linux)
            echo "  Start Docker with:  sudo systemctl start docker"
            echo "  To run docker without sudo:  sudo usermod -aG docker \$USER  (then log out/in)"
            ;;
        *)
            echo "  Start Docker Desktop and wait until it says Docker is running, then re-run this script."
            ;;
    esac
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
./docker/setup.sh

# Read a KEY=value from .env (last occurrence wins; ignores commented lines).
env_get() {
    sed -n "s/^[[:space:]]*$1=//p" .env | tail -n 1
}

PORT="$(env_get PORT)"
PORT="${PORT:-8080}"

# -------------------------------------------------------- step 3: registration
bold "3/5 Official coordinator registration..."

COORDINATOR_URL="$(env_get COORDINATOR_URL)"
SHARD_API_KEY="$(env_get SHARD_API_KEY)"

json_field() { # json_field <json> <key> - crude extractor, prefers jq
    if command -v jq >/dev/null 2>&1; then
        printf '%s' "$1" | jq -r ".. | .${2}? // empty" | head -n 1
    else
        printf '%s' "$1" | sed -n "s/.*\"${2}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n 1
    fi
}

json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\r//g' | tr -d '\n'
}

json_bool() {
    printf '%s' "$1" | tr -d '[:space:]' | sed -n "s/.*\"$2\":\\(true\\|false\\).*/\\1/p" | head -n 1
}

valid_email() {
    case "$1" in
        *@*.*) return 0 ;;
        *) return 1 ;;
    esac
}

read_required() {
    prompt="$1"
    value=""
    while [ -z "$value" ]; do
        printf '%s' "$prompt" >&2
        read -r value
        if [ -z "$value" ]; then
            warn "Please type something here. Empty answers cannot be registered." >&2
        fi
    done
    printf '%s' "$value"
}

read_region() {
    set -- us-east us-west canada south-america eu-west eu-central uk africa asia australia
    count=$#
    other=$((count + 1))
    echo "Region - pick the location closest to your server:" >&2
    i=1
    for r in "$@"; do
        printf '  %2d. %s\n' "$i" "$r" >&2
        i=$((i + 1))
    done
    printf '  %2d. Other (type your own)\n' "$other" >&2
    while :; do
        printf 'Enter a number 1-%d: ' "$other" >&2
        read -r choice
        case "$choice" in
            ''|*[!0-9]*)
                warn "Please enter a number between 1 and $other." >&2
                continue
                ;;
        esac
        if [ "$choice" -ge 1 ] && [ "$choice" -lt "$other" ]; then
            eval "printf '%s' \"\${$choice}\""
            return 0
        elif [ "$choice" -eq "$other" ]; then
            read_required 'Custom region label (example: me-central, sa-east): '
            return 0
        fi
        warn "Please enter a number between 1 and $other." >&2
    done
}

read_available_name() {
    value=""
    while [ -z "$value" ]; do
        candidate="$(read_required 'Server name players will see (example: Official Main): ')"
        response="$(curl -fsS --get --max-time 10 --data-urlencode "name=$candidate" "$REG_COORD/shards/name-available" || true)"
        available="$(json_bool "$response" available)"
        if [ "$available" = "true" ]; then
            value="$candidate"
        elif [ "$available" = "false" ]; then
            warn "That server name is already taken. Pick a different name." >&2
        else
            warn "Could not check that name right now. Registration will still verify it at the end." >&2
            value="$candidate"
        fi
    done
    printf '%s' "$value"
}

if [ -n "$COORDINATOR_URL" ] && [ -n "$SHARD_API_KEY" ]; then
    ok "Already registered (COORDINATOR_URL + SHARD_API_KEY set) - heartbeats enabled"
elif [ ! -t 0 ]; then
    fail "This launcher registers public shards with $OFFICIAL_COORDINATOR_URL, but this shell cannot answer prompts."
    echo "  Run ./docker/host.sh in an interactive terminal, or pre-fill .env with:"
    echo "    COORDINATOR_URL=$OFFICIAL_COORDINATOR_URL"
    echo "    SHARD_API_KEY=<api key returned by /shards/register>"
    echo "    SHARD_ID=<shard id returned by /shards/register>"
    exit 1
else
    REG_COORD="$OFFICIAL_COORDINATOR_URL"
    PUBLIC_IP="$(curl -fsS --max-time 5 https://api.ipify.org || true)"

    echo "This server must introduce itself to the Missile Wars backend coordinator:"
    echo "  $REG_COORD/shards/register"
    echo ""
    echo "Use real public details here. The phone app will copy these values later."
    echo "Do not use localhost, 127.0.0.1, db, backend, or a Docker container name."
    echo ""

    REG_NAME="$(read_available_name)"
    REG_REGION="$(read_region)"

    DEFAULT_HTTP="http://${PUBLIC_IP:-YOUR_PUBLIC_IP}:${PORT}"
    echo ""
    echo "Public HTTP URL:"
    echo "  This is the normal web address for this backend from OUTSIDE this computer."
    echo "  If you bought a domain and set up HTTPS, use that, for example:"
    echo "    https://play.example.com"
    echo "  If this is a VPS or home server without a domain, this script guessed:"
    echo "    $DEFAULT_HTTP"
    echo "  The guessed IP comes from the internet seeing this machine. If your router"
    echo "  forwards a different port, or your cloud provider gave you a DNS name, type"
    echo "  the correct full URL instead. Include http:// or https:// at the front."
    printf 'Public HTTP URL [%s]: ' "$DEFAULT_HTTP"
    read -r REG_HTTP
    REG_HTTP="${REG_HTTP:-$DEFAULT_HTTP}"

    DEFAULT_WS="$(printf '%s' "$REG_HTTP" | sed 's/^https/wss/; s/^http/ws/')"
    echo ""
    echo "Public WebSocket URL:"
    echo "  This is usually the same address with ws:// instead of http://, or wss://"
    echo "  instead of https://. The default below is normally correct."
    printf 'Public WebSocket URL [%s]: ' "$DEFAULT_WS"
    read -r REG_WS
    REG_WS="${REG_WS:-$DEFAULT_WS}"

    REG_CONTACT=""
    while ! valid_email "$REG_CONTACT"; do
        printf 'Owner contact email (required, example: you@example.com): '
        read -r REG_CONTACT
        if ! valid_email "$REG_CONTACT"; then
            warn "Please enter an email address with an @ and a domain. This lets admins contact you if your server breaks."
        fi
    done

    BODY=$(printf '{"name":"%s","region":"%s","publicHttpUrl":"%s","publicWsUrl":"%s","ownerContact":"%s"}' \
        "$(json_escape "$REG_NAME")" \
        "$(json_escape "$REG_REGION")" \
        "$(json_escape "$REG_HTTP")" \
        "$(json_escape "$REG_WS")" \
        "$(json_escape "$REG_CONTACT")")

    echo "Registering with $REG_COORD ..."
    RESPONSE="$(curl -fsS --max-time 15 -H 'Content-Type: application/json' \
        -d "$BODY" "$REG_COORD/shards/register")" || {
        fail "Registration failed - check the public URLs and try again."
        echo "  Nothing was saved to .env. Re-run ./docker/host.sh to retry."
        exit 1
    }

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
        ok "Registered (shard id: ${SHARD_ID:-unknown}). API key saved to .env - it is revocable and safe to keep here."
        COORDINATOR_URL="$REG_COORD"
    else
        fail "Unexpected response from coordinator:"
        echo "  $RESPONSE"
        exit 1
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
    warn "Could not determine your public IP - skipping the port-forwarding check."
else
    if curl -fsS --max-time 8 "http://${PUBLIC_IP}:${PORT}/healthz" >/dev/null 2>&1; then
        ok "Publicly reachable! Players connect via: http://${PUBLIC_IP}:${PORT}"
    else
        warn "Could not reach http://${PUBLIC_IP}:${PORT}/healthz from this machine."
        echo "  Port ${PORT} looks closed from the internet. To fix:"
        echo "   - Home network: forward TCP ${PORT} to this machine on your router."
        echo "   - VPS/cloud:    open TCP ${PORT} in the provider firewall/security group."
        echo "   - Linux host:   allow it locally, e.g.  sudo ufw allow ${PORT}/tcp"
        echo "  Note: some home routers block 'hairpin' connections from inside the same"
        echo "  network, so this probe can be a false negative. Ask someone outside your"
        echo "  network to open the URL above to confirm."
    fi
fi

echo ""
bold "Done. Useful commands:"
echo "  $COMPOSE logs -f backend    # tail server logs"
echo "  $COMPOSE down               # stop (DB data persists)"
echo "  ./docker/host.sh            # restart / re-check any time"
