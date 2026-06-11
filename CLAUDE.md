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
```

Required setup: `.env` (loaded via `dotenv` at the top of server.ts) with `JWT_SECRET` (**required — the server exits at boot if unset**), `DATABASE_URL`, `PORT`, `EMAIL_HOST/PORT/SECURE/USER/PASS/FROM`, optional `VERBOSE_MODE="ON"`. `firebasecred.json` (Firebase service-account key) goes in the repo root; if missing the server still boots but skips Firebase init, push notifications, and the message listener — Firebase-token login paths will fail at runtime.

## Architecture

### Entry point and import-time side effects

`server.ts` does everything at module load: creates and **exports the shared `prisma` client** (every other module imports it via `import { prisma } from "../server"`), initializes Firebase, starts all background `setInterval` loops, and registers routes. Importing `server.ts` starts the whole server — there is no separation between app construction and listening, which is part of why there are no tests.

### Directory map

- `server-routes/` — the real API. Each file exports a `setupXxxApi(app)` function called from `server.ts`. Auth, entities (missiles/landmines/loot), friends, health, inventory, money, leagues, notifications, ranks, users, profile images, the web map API, and `websocket.ts`.
- `util/auth.ts` — the single source of truth for JWT handling: `getJwtSecret()` (fail-fast if `JWT_SECRET` unset), `signToken(username)`, `verifyToken(token)`. Never call `jwt.sign`/`jwt.verify` directly in route code.
- `runners/` — background game loops started from `server.ts`: entity expiry/movement and loot spawning (30s intervals), proximity notifications and loot pickup (15s), damage processing, shield breakers, hourly league management, Firebase message listener, notification helper.
- `interfaces/` — zod schemas + TS types for request bodies (`api.ts`, `common.ts`).
- `prisma/schema.prisma` — `Users` (account: email, optional argon2 password, `firebaseUID`, `friends String[]`) is separate from `GameplayUser` (game state: health, money, rank, inventory, location), joined on `username`. Locations, entities (Missile/Landmine/Loot/Other + their `*Type` price tables), Statistics, Leagues, Notifications.
- `public/` — static web map (`/map` route).
- `bots.ts`, `export-script.ts`, `import-script.ts` — AI bots (currently disabled in server.ts) and DB migration utilities.

### Auth model (read this before touching any endpoint)

There is **no auth middleware**. Every protected handler inlines the same pattern, using the shared helper from `util/auth.ts`:

```ts
const decoded = verifyToken(token); // throws on bad/expired token — keep it inside try/catch
```

- The token is the backend's own JWT, signed at login/register via `signToken(username)` with payload `{ username }` and a **30-day expiry** (`verifyToken` also passes `maxAge` so legacy no-exp tokens age out from `iat`). Clients send it in the request **body** (`token` field) or query string — not an Authorization header. `POST /api/refresh` exchanges a still-valid token for a fresh one.
- Login is Firebase-first: the client signs in with Firebase, posts the Firebase `idToken` to `/api/login` / `/api/register` / `/api/oauth-login`, the server verifies it with `admin.auth().verifyIdToken`, then issues its own JWT. A legacy username/password path (argon2) still exists for pre-Firebase accounts; password resets null the local password to migrate users onto Firebase.
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
