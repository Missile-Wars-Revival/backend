# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The Missile Wars backend — an Express + TypeScript server for a real-time, location-based multiplayer game. PostgreSQL via Prisma, WebSockets via express-ws, Firebase Admin (auth, Realtime Database chat, Storage profile images, FCM push), nodemailer for password-reset emails. The Expo frontend lives in `../frontend`; the shared message/type contract is the **`middle-earth`** package (`../middle-earth`, installed from GitHub `Missile-Wars-Revival/middle-earth`). There is no test suite.

## Commands

```bash
npm run dev          # nodemon + ts-node (tsconfig.server.json), watches server.ts, routes/, server-routes/
npm start            # tsc build to dist/, copies firebasecred.json + public/ in, runs node dist/server.js
                     # (uses cp — works in bash/WSL, not PowerShell)
npx tsc --noEmit --project tsconfig.server.json   # type check

npx prisma generate          # regenerate client (also runs on postinstall)
npx prisma migrate dev       # apply schema changes
npx prisma studio            # GUI database editor

eb deploy --staged           # AWS Elastic Beanstalk deploy — run `npm run build` first (dist/ must exist)

./docker/setup.sh            # one-time: generate .env with local Postgres password + JWT secret
docker compose up -d --build # self-host stack: Postgres + prisma db push + backend (see README)
```

Required setup: `.env` (loaded via `dotenv` at the top of server.ts) with `DATABASE_URL`, `PORT`, and **either** `COORDINATOR_URL` + `SHARD_API_KEY` (distributed: coordinator mints/verifies tokens, verifies Firebase ID tokens, and relays pushes) **or** `JWT_SECRET` (solo/local hosting) — the server exits at boot if neither is set. Optional: `SHARD_ID` (JWT audience check), `EMAIL_*` vars (password-reset emails, owner deployment), `VERBOSE_MODE="ON"`, `GIT_SHA` (reported in heartbeats), `AUTO_UPDATE` (Phase 12; default on — set `false` to opt a distributed shard out of coordinator-driven self-update). `firebasecred.json` (Firebase service-account key, **owner deployment only — never give it to community shards**) goes in the repo root; without it the server boots and runs fine, skipping the global chat message listener, Firebase Storage profile images, and Firebase account-management ops.

## Architecture

### Entry point and import-time side effects

`server.ts` does everything at module load: creates and **exports the shared `prisma` client** (every other module imports it via `import { prisma } from "../server"`), initializes Firebase, starts all background `setInterval` loops, and registers routes. Importing `server.ts` starts the whole server — there is no separation between app construction and listening, which is part of why there are no tests.

### Directory map

- `server-routes/` — the real API. Each file exports a `setupXxxApi(app)` function called from `server.ts`. Auth, entities (missiles/landmines/loot), friends, health, inventory, money, leagues, notifications, ranks, users, profile images, the web map API, and `websocket.ts`. **Phase 9 payment boundary:** the client-callable grants `/api/addMoney` (`moneyApi.ts`) and `/api/addItem` (`inventoryApi.ts`) are gated solo-mode-only (`isDistributedMode()`); in distributed mode premium goods arrive only via `/api/redeemPurchase`, which verifies a coordinator-minted RS256 voucher (`verifyVoucher` in `util/auth.ts`) and dedupes on `RedeemedPurchase.txId`.
- `util/auth.ts` — the single source of truth for JWT handling: `initAuth()` (boot check + JWKS fetch loop), `issueToken(username, firebaseUID?)` (async; coordinator-minted RS256 when `COORDINATOR_URL`+`SHARD_API_KEY` are set, local HS256 via `JWT_SECRET` for solo hosting), `verifyToken(token)` (sync; RS256 via cached coordinator JWKS with `SHARD_ID` audience check, legacy HS256 fallback while `JWT_SECRET` is set). Never call `jwt.sign`/`jwt.verify` directly in route code.
- `runners/` — background game loops started from `server.ts`: entity expiry/movement and loot spawning (30s intervals), proximity notifications and loot pickup (15s), damage processing, shield breakers, hourly league management, Firebase message listener, notification helper. `coordinatorClient.ts` also sends the 30s coordinator heartbeat and (Phase 12) acts on the heartbeat's update decision — running `docker/update.sh`/`update.ps1` to self-update, serialized by a lock file, skippable with `AUTO_UPDATE=false`, deferred while players are connected unless the release is `critical`.
- `interfaces/` — zod schemas + TS types for request bodies (`api.ts`, `common.ts`).
- `prisma/schema.prisma` — `Users` (account: email, optional argon2 password, `firebaseUID`, `friends String[]`) is separate from `GameplayUser` (game state: health, money, rank, inventory, location), joined on `username`. Locations, entities (Missile/Landmine/Loot/Other + their `*Type` price tables), Statistics, Leagues, Notifications.
- `public/` — static web map (`/map` route).
- `bots.ts`, `export-script.ts`, `import-script.ts` — AI bots (currently disabled in server.ts) and DB migration utilities.

### Auth model (read this before touching any endpoint)

There is **no auth middleware**. Every protected handler inlines the same pattern, using the shared helper from `util/auth.ts`:

```ts
const decoded = verifyToken(token); // throws on bad/expired token — keep it inside try/catch
```

- The token is issued at login/register via `await issueToken(username, firebaseUID?)`. In distributed mode the **coordinator** signs it (RS256, 12h expiry, `sub` = firebaseUID, `aud` = shard id); in solo mode it's a local HS256 token with a **30-day expiry** (legacy HS256 tokens also verify with `maxAge` so no-exp tokens age out from `iat`). Clients send it in the request **body** (`token` field) or query string — not an Authorization header. `POST /api/refresh` exchanges a still-valid token for a fresh one.
- Login is Firebase-first: the client signs in with Firebase, posts the Firebase `idToken` to `/api/login` / `/api/register` / `/api/oauth-login`, the server verifies it with `admin.auth().verifyIdToken`, then issues its own JWT. A legacy username/password path (argon2) still exists for pre-Firebase accounts; password resets null the local password to migrate users onto Firebase. **These routes now serve solo hosting and legacy app builds only** — the Phase 8 distributed app authenticates via Firebase + the coordinator and never calls them; its accounts reach this shard by **auto-provisioning at websocket connect**: a coordinator-signed token whose user has no local row creates `Users` + `GameplayUser` on the spot (`server-routes/websocket.ts`).
- Credential endpoints in `authRoutes.ts` are rate-limited per IP with `express-rate-limit` (requires the `trust proxy` setting in server.ts). Password-reset codes come from `crypto.randomInt`.
- The WebSocket authenticates once at connection time (`server-routes/websocket.ts`): `Authorization: Bearer` header preferred, `Sec-WebSocket-Protocol` or `?token=` query param as fallbacks. It then tracks the session (IP, last login) in the `Sessions` table.
- Identity is the **username**, which is mutable (`/api/changeUsername` reissues the JWT and rewrites friends lists, Firebase RTDB, and Storage paths). Tokens issued before a rename stop resolving to a user.

When adding an endpoint, follow the existing inline-verify pattern and look up the user by `decoded.username` — don't invent a new scheme, but match `userApi.ts` or `entityApi.ts` style.

### WebSocket protocol

Messages are msgpack-compressed and encoded/decoded with `zip`/`unzip` from `middle-earth`. The server keeps an in-memory cache of entities/players and pushes periodic state to connected clients; the frontend treats the WebSocket as the primary data channel and REST as secondary. If you change message shapes, the change belongs in `middle-earth` (types + serialization), then both repos consume it.

## Conventions and gotchas

- CommonJS output (`tsconfig.server.json`), relative imports only, no path aliases.
- Handlers respond with `res.status(...).json({ message: ... })`; errors are try/caught per-handler and logged with `console.error`. `logVerbose` (websocket.ts) gates chatty logs behind `VERBOSE_MODE=ON`.
- Coordinates are stored as **strings** in the DB (`latitude`/`longitude`/`locLat`/`locLong`); parse before doing math (geolib/turf are used for distance work).
- Firebase operations are wrapped in try/catch and intentionally non-fatal in several flows (username change, password reset) — the Postgres update proceeds even if Firebase fails. Preserve that ordering.
- `firebasecred.json` and `.env` are secrets — never commit or print them.
- Some filenames are misspelled (`notificaitonApi.ts`, `usermanagment.ts`, `leaguemanagment.ts`) — keep the existing names; renames break imports across the codebase.
