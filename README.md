# Missile Wars Backend

The official backend server for Missile Wars, developed by [longtimeno-c](https://github.com/longtimeno-c).

## ⚠️ License & Usage Notice
This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). This means:

- ✅ You can view and fork this code
- ✅ You can use this code for personal projects
- ✅ You can modify the code
- ❌ You cannot use this code in closed-source commercial projects
- ❗ Any modifications or usage of this code must be made open source
- ❗ You must include the original license and copyright notice

For the full license text, see [LICENSE](LICENSE.md)

Copyright (c) 2024 longtimeno-c. All rights reserved.

## 🚀 Features
- Real-time game state management using WebSockets (Middle Earth Library)
- Secure authentication system
- Push notifications via Firebase and expo notifications
- Email notification system
- Database integration with Prisma

## 📋 Prerequisites

For standard hosting, use Docker. You do **not** need to install Node.js,
Postgres, Prisma, Firebase credentials, or SMTP credentials on the host machine.
The Docker stack runs the backend and its own local Postgres database.

- Docker Engine with the Compose plugin
- `git`
- `curl`
- A public URL or public IP/port that players can reach

Platform notes:

- macOS: install Docker Desktop, then start it before running the launcher.
- Linux VPS: install Docker Engine and make sure your firewall allows the shard
  port, usually TCP `8080`.
- Windows: use Docker Desktop with PowerShell, or use WSL and the Linux/macOS
  command.

Manual Node/Postgres setup is only for local development or custom deployments.
See [Manual development setup](#manual-development-setup).

## 🐳 Standard Setup With Docker

This is the recommended setup for community-hosted shards. It starts a full
shard: backend + local Postgres + one-time schema setup.

```bash
git clone https://github.com/Missile-Wars-Revival/backend.git
cd backend

./docker/host.sh
```

On Windows PowerShell:

```powershell
.\docker\host.ps1
```

The launcher will:

1. Check Docker and Docker Compose are available.
2. Generate a local `.env` file on first run, or repair missing Docker values
   in an existing `.env`.
3. Register your shard with the official coordinator.
4. Build and start the Docker stack.
5. Check `http://localhost:8080/healthz` and warn if the public port looks
   closed.

If macOS or Linux says `Permission denied`, fix the executable bit once:

```bash
chmod +x docker/host.sh docker/setup.sh
./docker/host.sh
```

If Docker is installed but the launcher says the daemon is not running:

- macOS: open Docker Desktop from Applications and wait until it says Docker is
  running. Do not use `systemctl` on macOS.
- Windows: start Docker Desktop and wait until it says Docker is running.
- Linux: start the Docker service:

```bash
sudo systemctl start docker
```

Check the shard is alive:

```bash
curl http://localhost:8080/healthz
```

Expected response:

```text
ok
```

Useful Docker commands:

```bash
docker compose logs -f backend   # tail server logs
docker compose down              # stop; database data persists
docker compose down -v           # stop and wipe the database volume
docker compose up -d --build     # rebuild after pulling updates
```

## 🛠️ Manual Development Setup

Use this path only if you are developing the backend without Docker or running a
custom deployment. Standard shard hosts should use
[Standard Setup With Docker](#standard-setup-with-docker).

Manual prerequisites:

- Node.js (v16.x or higher)
- npm (v8.x or higher)
- PostgreSQL database
- Firebase account for owner-only notification and account-management services
- SMTP server access for password-reset emails, if needed

### 1. Environment Configuration
Create an `.env` file in the root directory. The server boots in one of two
modes (it refuses to start if neither is configured):

```env
# Server Configuration
NODE_ENV="development"
VERBOSE_MODE="ON"
PORT=3000

# Database (always local to this shard — never shared between hosts)
DATABASE_URL="postgresql://user:password@localhost:5432/dbname"

# --- Mode A: distributed (registered community shard) ---
# Written automatically by ./docker/host.sh | .\docker\host.ps1 registration.
# Tokens are minted and verified by the coordinator (RS256, 12h, refreshable);
# Firebase ID-token login and push delivery also go through the coordinator.
COORDINATOR_URL="https://backend-coordinator.vercel.app"
SHARD_API_KEY="mw_shard_..."   # issued at registration, revocable
SHARD_ID="..."                 # enables the JWT audience check

# --- Mode B: solo / local hosting (no coordinator) ---
# JWT_SECRET="your-secure-secret-here"   # local HS256 tokens, 30-day expiry

# Email (OPTIONAL — password-reset emails; owner deployment only)
# EMAIL_HOST=smtp.gmail.com
# EMAIL_PORT=587
# EMAIL_SECURE=false
# EMAIL_USER="your-email@domain.com"
# EMAIL_PASS="your-app-specific-password"
# EMAIL_FROM="noreply@yourdomain.com"
```

Clients exchange a still-valid token for a fresh one via `POST /api/refresh`
in both modes.

### 2. Firebase Setup (owner deployment ONLY)
Community shards must **not** have Firebase credentials — they verify logins
and deliver pushes through the coordinator. Only the project owner's central
deployment does this:

1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com)
2. Download your Firebase service account credentials
3. Rename the credentials file to `firebasecred.json` and place it in the project root
4. This enables the global chat message listener, Firebase Storage profile
   pictures, and Firebase account management (password/email changes).

## 🧭 Docker Hosting Details

Stand up a full shard — backend + its own local Postgres — with one command.
Your shard generates its own secrets locally, so no database credential or
signing key is ever shared between hosts (see
[DISTRIBUTED_HOSTING_PLAN.md](DISTRIBUTED_HOSTING_PLAN.md)).

The launcher checks Docker is installed (with install links if not), generates
your local `.env` on first run or repairs missing Docker values in an existing
`.env`, registers your shard with the official
coordinator at `https://backend-coordinator.vercel.app/shards/register`
(writing `COORDINATOR_URL`, `SHARD_API_KEY`, and `SHARD_ID` into
`.env` — the API key is shown once and is revocable), starts the stack, and
runs a reachability check so you know port forwarding works.

The registration request looks like this:

```bash
curl -X POST "https://backend-coordinator.vercel.app/shards/register" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Official Main",
    "region": "eu-west",
    "publicHttpUrl": "https://YOUR-BACKEND-DOMAIN",
    "publicWsUrl": "wss://YOUR-BACKEND-DOMAIN",
    "ownerContact": "you@example.com"
  }'
```

You normally do **not** need to run that curl command yourself. The Docker
launcher asks you for those values and sends the request for you.

What the prompts mean:

- `Server name`: the friendly name players see in the server list. Example:
  `Official Main`, `London Shard`, or `Alice's Server`. Names are unique. If
  someone already registered that name, the launcher asks you to pick another.
- `Region`: a short location label so players can pick something nearby.
  Examples: `eu-west`, `us-east`, `us-west`, `australia`.
- `Public HTTP URL`: the normal internet address for this backend. This must be
  reachable by a phone that is **not** on your computer. Do not enter
  `localhost`, `127.0.0.1`, `db`, `backend`, or a Docker container name. Those
  only work inside your machine.
- `Public WebSocket URL`: usually the same address with `ws://` instead of
  `http://`, or `wss://` instead of `https://`. If your HTTP URL is
  `https://play.example.com`, the WebSocket URL is normally
  `wss://play.example.com`.
- `Owner contact email`: required. Use an email address you actually read, like
  `you@example.com`. Admins use this if your server is down, misconfigured, or
  needs verification help.

The launcher tries to help with `publicHttpUrl` by asking the internet what IP
address your server appears to have. If your shard listens on port `8080`, it
will suggest something like `http://203.0.113.10:8080`. That guess is only a
guess. If you use a domain, HTTPS proxy, different public port, tunnel, or cloud
load balancer, type the real public URL instead. The correct answer is the one a
player's phone can open from mobile data.

What the Docker stack runs:

- `db` — Postgres 16 with a named volume (`db-data`); password generated by
  `setup.sh`, unique to your machine.
- `migrate` — one-shot `prisma db push` against your local DB, then exits.
- `backend` — the game server on port `8080` (change `PORT` in `.env`).

Notes for hosts:

- `firebasecred.json` is **not** part of a community shard — Firebase ID-token
  login is verified via the coordinator (`/auth/verify-id-token`) and push
  notifications are delivered through the coordinator's rate-limited
  `/relay/push`, so you never hold players' push tokens. Only the project
  owner's deployment mounts it.
- Registered shards heartbeat to the coordinator every 30s (player count +
  version) so players can discover your server. The Docker host launcher now
  registers public shards with the official coordinator before starting them.
- Email settings in `.env` are optional and only used for password-reset
  emails on the owner's deployment.

### Updating your shard (auto-update)

Registered shards check the coordinator for new backend releases on each 30s
heartbeat. When a newer **approved** release exists, the shard runs the updater
itself: it checks out the approved tag (`backend-vX.Y.Z`) or commit, rebuilds
with `docker compose up -d --build` (your `.env` and the Postgres `db-data`
volume are preserved, and migrations run automatically), health-checks
`/healthz`, and **rolls back** to the previous version if anything fails. Auto
updates wait for a quiet moment (no players connected) unless the release is
marked `critical`.

- **Opt out:** set `AUTO_UPDATE=false` in `.env` to never self-update. The
  coordinator may still hide shards on an unsupported version from player
  discovery until you update.
- **Update manually anytime:** `./docker/update.sh` (Linux/macOS) or
  `.\docker\update.ps1` (Windows). Same script the agent uses.
- **Requirement:** the updater runs `docker compose` + `git`, so the backend
  process must be able to reach them — run the launcher on the host, or mount
  the Docker socket and repo into the container. If you can't, use
  `AUTO_UPDATE=false` and run `docker/update.sh` from the host.
- A failed update writes `docker/.update-result.json`; the shard reports the
  failure (`fromVersion`/`toVersion`/`reason`) to the coordinator so the owner's
  admin portal can see broken hosts.

## 🚀 Running the Server Manually

### Install Dependencies
```bash
npm install
```

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm start   # compiles with tsconfig.server.json, then runs dist/server.js
```

## ☁️ AWS Elastic Beanstalk Deployment

### Prerequisites
- AWS CLI installed and configured
- EB CLI installed (`pip install awsebcli`)

### Initialize Elastic Beanstalk Application
```bash
eb init
```
Follow the prompts to select your region, application name, and platform.

### Create Environment
```bash
eb create [environment-name]
```
Creates a new Elastic Beanstalk environment. Replace `[environment-name]` with your desired environment name (e.g., `production`, `staging`).

### Configure Environment Variables
Elastic Beanstalk does not automatically upload your local `.env` file. Set variables on the environment instead.

```bash
# Set variables manually
eb setenv KEY=value OTHER=value
```

# Import all variables from .env
```bash
git add -f .env
```

```bash
# Verify and select an environment
eb list
eb use your-env-name
eb printenv --environment your-env-name
```

### Deploy Code
**Important:** Build the application locally before deploying:
```bash
npx tsc --project tsconfig.server.json
```
This ensures the `dist/` directory is created and included in the deployment bundle. The `dist/` folder contains the compiled JavaScript files and is not ignored in version control.

```bash
eb deploy --staged
```
Deploys your backend code to the active Elastic Beanstalk environment.

### Check Environment Status
```bash
eb status
```
Displays the current status of your Elastic Beanstalk environment.

### View Application Logs
```bash
eb logs
```
Retrieves and displays the logs from your Elastic Beanstalk environment.

### List Environments
```bash
eb list
```
Lists all environments for the current application.

### Switch Environment
```bash
eb use [environment-name]
```
Switches to a different environment as the active deployment target.

### Terminate Environment
```bash
eb terminate [environment-name]
```
Terminates the specified Elastic Beanstalk environment. Use with caution as this will delete the environment and all associated resources.

### Open Application in Browser
```bash
eb open
```
Opens the URL of your Elastic Beanstalk application in your default web browser.

## 🗄️ Database Management (Prisma)

### Schema Management
```bash
# Pull current database schema
npx prisma db pull

# Generate Prisma Client
npx prisma generate

# Open Prisma Studio (GUI database editor)
npx prisma studio
```

### Schema Migrations
```bash
# Create a new migration
npx prisma migrate dev --create-only

# Apply migration
npx prisma migrate dev
```

## 🌐 Distributed Hosting — Owner Operations

Copies social data (friends, profiles, push tokens, notification prefs) from
production Postgres to Firebase central. Needs `firebasecred.json` and the
production `DATABASE_URL`; idempotent, so safe to re-run (e.g. for legacy
accounts that gained a `firebaseUID` after the first pass):

```bash
npm run migrate:social              # dry run
npm run migrate:social -- --apply
```

RTDB security rules live in `../backend-coordinator/rtdbrules.json` — keep the
Firebase console rules in sync with that file when it changes.

### Publishing a backend release (auto-update)

Community shards self-update toward the latest **approved** release. To publish
one (Phase 12):

1. Bump `version` in `backend/package.json` and tag the commit `backend-vX.Y.Z`
   (the version source of truth), then push the tag so shards can fetch it.
2. In the coordinator admin portal (`/admin` → **Backend release**), publish the
   release: set the version, and optionally `minimumSupportedVersion` (makes it
   **mandatory** — older shards are hidden from discovery until they update),
   `rolloutPercent` (gradual/optional rollout), and `critical` (allowed to update
   even while players are connected).

Shards pick it up on their next heartbeat. You can also **Request update** on a
single shard (updates on its next heartbeat without shell access), and the table
shows each shard's version, `updateStatus`, and last update error. Release
publishing is manual today — there is no CI step wired to the git tag yet.

## 📦 Data Migration Tools

### Export Database
```bash
npx ts-node export-script.ts
```

### Import Database
1. Update your `.env` file with new database credentials
2. Update schema if necessary
3. Run import script:
```bash
npx ts-node import-script.ts
```

## 🤝 Contributing
Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## 📧 Support
For support, please open an issue in the GitHub repository or contact me on [X](https://x.com/ReTristanHill).

## ✨ Acknowledgments
- Middle Earth Library
- Firebase
- Prisma Team
- Expo Team
