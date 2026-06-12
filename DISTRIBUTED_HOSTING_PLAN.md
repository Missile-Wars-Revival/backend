# Distributed / Community-Hosted Backend — Implementation Plan

> **Source of truth** for the distributed-hosting design. The coordinator repo's
> `PLAN.md` and other docs should follow this file.

> Goal: let other people host the Missile Wars backend ("shards") on their own
> VMs (e.g. DigitalOcean droplets) so the project owner isn't the only one
> paying for compute, while a small central **coordinator** on Vercel keeps the
> network safe, knows which shards are online, and routes each player to the
> best one.

## The one security law this whole design follows

**A secret a machine *uses* is a secret the machine's owner can *read*.**

There is no way to ship an encrypted `.env` / runtime-fetched secret / obfuscated
binary that a host with root cannot extract from process memory. (The only real
exception is hardware TEEs — AWS Nitro Enclaves etc. — which need special
hardware, are a heavy build, and still leak traffic because the host controls
the network. Out of scope.)

So we do **not** try to hide secrets on the host. Instead we make sure a host
**never holds a secret worth stealing**:

| Today's secret        | Risk if leaked                              | New handling                                                        |
| --------------------- | ------------------------------------------- | ------------------------------------------------------------------- |
| `JWT_SECRET` (HS256)  | Forge a token for **any** user              | Switch to **asymmetric** keys. Coordinator holds private key (mints); shard holds only the **public** key (verifies). Public keys are safe to read. |
| `firebasecred.json`   | Full admin over the entire Firebase project | **Never leaves the coordinator.** Login/register/push run there.    |
| `DATABASE_URL`        | Full read/write of all players              | Each shard runs its **own local Postgres** with a locally generated password. No shared DB credential exists. |
| Email creds           | Send mail as you                            | **Never leaves the coordinator.** Password-reset email runs there.  |

What a shard *does* hold: a **revocable, shard-scoped API key** (for talking to
the coordinator) and a **public** JWT verification key. Both are safe even when
the host reads them.

**Residual risk (cannot be engineered away):** a host can see the traffic of
*their own* connected players — their tokens and live locations. Mitigated by
short-lived, shard-scoped tokens and the **unverified-server warning** in the
frontend (see Server trust). Social data in Firebase central is not exposed to
shard hosts; live gameplay traffic to an unverified shard still is. Document
this honestly in `SECURITY.md`.

## Architecture

```
                    ┌──────────────────────────────────────────┐
                    │  Coordinator (Vercel)                   │   ← holds ALL real secrets
                    │  - login/register (Firebase Auth)         │
                    │  - mints JWTs (private key)               │
                    │  - admin portal (verify servers)          │
                    │  - FCM push relay + email               │
                    │  - reads/writes coordinator state in RTDB │
                    └──────┬──────────────▲────────────────────┘
                           │ JWKS public  │ heartbeats (30s, shard → coordinator):
                           │ key, relay   │ player count, version, git-sha
                           ▼              │
   ┌────────────────────────────────────────────────┐
   │  Community shard (droplet, docker-compose)     │
   │  - Express backend (verify-only auth)          │
   │  - its OWN local Postgres (own generated pw)   │
   │  - gameplay/world state only (see data split)    │
   │  - sends heartbeats TO the coordinator         │
   │  - secrets it holds: only a revocable,         │
   │    shard-scoped API key + public JWT key       │
   └────────────────────────────────────────────────┘
                           ▲
        Expo app ──────────┘  asks coordinator "best server near me?",
                              reads social data from Firebase central,
                              connects directly to shard via WS
                           ▲
                           │
                    ┌──────┴───────────────────────────────────────┐
                    │  Firebase central (global RTDB + Auth)         │
                    │  /coordinator/*  — server registry, verified,  │
                    │                  heartbeats (admin SDK only) │
                    │  /friends/*      — friends + requests        │
                    │  /profiles/*     — avatar, display info      │
                    │  /chat/*         — chat (existing)           │
                    │  /notifications/* — prefs + FCM tokens         │
                    └──────────────────────────────────────────────┘
```

### Coordinator has no database of its own

The coordinator is a **stateless-ish HTTP service on Vercel** backed entirely by
**Firebase**:

- **Firebase Auth** — verify `idToken` on login/register.
- **Firebase RTDB** — all coordinator control-plane state: registered shards,
  API-key hashes, `verified` flags, last-heartbeat timestamps, player counts,
  session audit log, and (later) global account identity rows.
- **Firebase Admin SDK** — the only writer to `/coordinator/*` paths; clients
  never read those paths directly.

There is **no `schema.prisma` and no Postgres/Neon in `backend-coordinator`**.
That was a mistaken early scaffold and must be removed. The coordinator does
**not** receive gameplay data and does **not** run `prisma db push` on boot.
Shards **push** heartbeats to the coordinator; the coordinator **records** them
in RTDB.

Deploy `rtdbrules.json` (in `backend-coordinator/`) to the Firebase project so
`/coordinator/*` is locked to the Admin SDK while social paths remain
`firebaseUID`-scoped for client read/write.

### Control plane vs data plane (why this does NOT add gameplay lag)

The coordinator is on the **control plane**. Live gameplay — the WebSocket
stream, REST calls, and the 15s/30s game loops — talks **only to the shard**,
whose Postgres is on the **same droplet**, so the hot path never round-trips
through Vercel. The coordinator is only hit for: login (once/session), "best
server" lookup (once at startup), token refresh (background), push relay, and
**async heartbeats from shards** (every 30s). It can even *reduce* lag by
routing players to a geographically nearer shard.

> Contrast: the rejected "shared DB behind a coordinator API" design **does** add
> lag — every Prisma call becomes a remote HTTP hop and the game loops hammer it.
> We are deliberately **not** doing that. Each shard's data stays local.

### Hybrid data split: global social, per-shard gameplay

Each shard has its own Postgres for **gameplay and world state**. Accounts/
identity are **global** (one login works everywhere, issued by the coordinator).
**Social and non-game-essential profile data** live in **Firebase central** so
they survive server migration — a player who switches shards keeps their friends,
contact details, chat history, and notification preferences.

| Data | Where it lives | Why |
| ---- | -------------- | --- |
| Server registry, verified flags, heartbeats | **Firebase RTDB** `/coordinator/shards/*` | Coordinator control plane; admin SDK only |
| Friends list, friend requests | **Firebase RTDB** `/friends/*` | Must not be wiped when a user migrates shards |
| Profile / contact details (avatar, display info) | **Firebase RTDB** `/profiles/*` | Identity/social; not tied to one game world |
| Chat messages | **Firebase RTDB** `/chat/*` (existing) | Already global; friends can message across shards |
| Notification prefs + FCM tokens | **Firebase RTDB** `/notifications/*` | Tied to the person, not a shard |
| Account auth (Firebase UID, email, username) | **Firebase Auth + RTDB** `/coordinator/users/*` | Minting tokens; never on shards |
| Inventory, money, level, rank, stats | **Per-shard Postgres** | Game economy is world-local |
| Live location, entities, leagues, missiles/loot | **Per-shard Postgres** | Hot gameplay path; must stay local |

**Server migration behaviour:** when a user picks a different shard, their
Firebase social graph and profile come with them. Gameplay state (inventory,
in-world progress, local statistics) does **not** — that is intentional: each
shard is a separate game world. The coordinator may later offer optional
export/import tooling, but that is out of scope for v1.

For a location-based game, the coordinator routes physically-near players to
the same regional shard, so people near each other share a world anyway.

### Server trust: verified vs unverified

Community hosts can read traffic on **their own** shard (see residual risk above).
We cannot prevent that, but we **can** label which servers the project owner has
reviewed and tell users honestly before they connect.

| Status | Meaning | User experience |
| ------ | ------- | ----------------- |
| **Verified** | Project owner has reviewed and trusts this host (own infra or vetted community server). | Shown with a verified badge; no extra warning. |
| **Unverified** | Registered with the coordinator but not reviewed by the project owner. | **Mandatory warning** before connect: their information may not be secure — including **live location**, auth tokens in transit, and other gameplay traffic visible to the host. User must acknowledge to proceed. |
| **Offline** | Registered shard missed the configured heartbeat window (5-10 missed 30s heartbeats; default 5). | Hidden from discovery until heartbeats resume. |
| **Disabled** | Delisted by admin. | Hidden from discovery; cannot obtain a scoped token. |

Verification is a **trust label**, not a cryptographic guarantee. It tells users
which hosts the project owner stands behind. Unverified servers remain playable
(open registration model) but with informed consent.

### Admin portal (coordinator web UI)

The project owner manages the server directory through a **login-protected admin
webpage** hosted on the coordinator (not a public API key alone). Capabilities:

- View all registered shards (pending, active, offline, disabled).
- **Set verified / unverified** status per shard (written to RTDB).
- Approve pending registrations, disable or delist bad actors.
- Edit a shard's public HTTP/WebSocket URLs in the server directory. This is
  discovery metadata, separate from JWT signing keys and shard API keys.
- Rotate shard API keys, view heartbeat/load/player counts.
- Rotate JWT signing keys.

Auth for the admin UI: coordinator-held credentials (e.g. `ADMIN_API_KEY` or
dedicated admin login). This is where verification status is **set**; the
public `GET /servers` response exposes `verified: boolean` (and related display
fields) so the frontend can render badges and warnings.

## Phased implementation

### Phase 1 — Dockerize the shard (no behavior change, zero risk)

Goal: anyone can stand up a working backend + DB with one command. Useful even
if we stop here.

- [x] `Dockerfile` for the backend (multi-stage: build with `tsconfig.server.json`, run `dist/server.js`).
- [x] `docker-compose.yml`: backend + Postgres service + a one-shot migrate step (`prisma db push` until migrations are checked in).
- [x] Setup script (`docker/setup.sh`) that **generates a local DB password on first run** and writes the shard's `.env` (so `DATABASE_URL` is never a shared value); container entrypoint assembles `DATABASE_URL` from the parts.
- [x] `.env.example` documenting only the *safe* vars a host sets (PORT, coordinator URL, shard API key).
- [x] Host setup docs in README.
- [x] **One-click host launcher** (`docker/host.sh` + `docker/host.ps1`): single entry point that (a) detects Docker / compose and **prompts to install** with OS-specific links when missing, (b) runs `setup.sh` on first launch, (c) registers the shard with the official coordinator and writes `COORDINATOR_URL` + `SHARD_API_KEY` + `SHARD_ID` into `.env`, (d) starts `docker compose up -d --build`, (e) runs a **port-forwarding check** after boot (local healthz + public-IP reachability probe with clear guidance when the port is closed).
- [x] **Shard → coordinator heartbeat** in `backend/` (`runners/coordinatorClient.ts`): every 30s `POST /shards/heartbeat` with player count + version when `COORDINATOR_URL` and `SHARD_API_KEY` are set.

> **Prisma belongs only in `backend/`** (per-shard gameplay DB). Community
> hosts run `prisma db push` inside their own docker-compose stack — that is
> correct. The coordinator must never do this.

### Phase 2 — Coordinator MVP on Vercel + Firebase RTDB

New repo/app in `../backend-coordinator` (Express + Firebase Admin + jose).
Holds the real secrets. **No Prisma, no Neon, no `schema.prisma`.**

- [x] Remove mistaken Prisma scaffold from `backend-coordinator` (`prisma/`,
      `@prisma/client`, `DATABASE_URL` env var, migrate commands).
- [x] RTDB-backed store for coordinator state (`/coordinator/shards`,
      `/coordinator/shardKeyIndex`, `/coordinator/shardNameIndex`,
      `/coordinator/sessions`; `/coordinator/users` lands with the Phase 3
      auth split — nothing writes it yet).
- [ ] Add and deploy `backend-coordinator/rtdbrules.json` — lock `/coordinator`
      to Admin SDK; scope social paths to `auth.uid`. *(Rules file is written;
      deploying it to Firebase — and merging the existing chat-path rules —
      is still pending.)*
- [x] `POST /shards/register` → issue a shard-scoped API key (show once); new shards default to **unverified**.
- [x] `POST /shards/heartbeat` (auth: shard key) → shard pushes load, player count, version, last-seen; coordinator writes to RTDB.
- [x] `GET /servers` / `GET /servers/best?lat=&lon=` → read shard list from RTDB; include `verified`, player count, region; filter disabled/offline/stale.
- [x] `GET /.well-known/jwks.json` → **public** JWT verification key(s).
- [x] Key management: RS256 keypair via `npm run generate-keys`; private key in host env, public key served via JWKS.
- [x] **Admin portal** (login-protected web UI at `/admin`): list shards, approve/disable, **toggle verified**, edit public URLs, rotate keys. Backed by `ADMIN_API_KEY`.
- [x] `POST /auth/select-server` → short-lived (12h) RS256 token with `sub` = firebaseUID, `aud` = shard id (placeholder identity check until Phase 3 moves full login here).

### Phase 3 — Auth split (highest-risk phase; touches every protected endpoint's assumptions)

- [x] **Coordinator is the only signer.** Implemented as `POST /auth/shard-token` (auth: shard API key): the shard keeps running its login/register/oauth-login route *handlers* (user records live in shard Postgres until Phase 4) but every token is minted by the coordinator, `aud` locked to the calling shard. Password-reset email stays on the shard for the same reason — it reads/writes shard Postgres; it moves when Phase 4 centralizes accounts.
- [x] Token payload: include **`firebaseUID`** (stable identity, `sub`; legacy pre-Firebase accounts get `sub = user:<username>`), `username`, `aud` = shard id, short expiry (12h). Fixes the current mutable-username-as-identity bug where renames break tokens.
- [x] **Backend** `util/auth.ts`: `verifyToken` becomes **public-key verify** (fetch + cache JWKS, background refresh, refetch on unknown kid) + audience check via `SHARD_ID`. `signToken` is removed from the shard — `issueToken()` calls the coordinator. *(Deliberate residuals until Phase 5: legacy HS256 tokens stay verifiable while `JWT_SECRET` is set so live 30-day sessions survive migration, and solo/local shards without a coordinator still sign locally.)*
- [x] `POST /api/refresh` → kept on the shard, now mints the fresh token via the coordinator; the coordinator also exposes `POST /auth/refresh` for clients that talk to it directly.
- [x] Keep the existing inline `verifyToken(token)` call sites working — the signature of the helper stays the same, only its internals change. This is what keeps the blast radius of this phase contained. *(Verified: all ~60 call sites untouched; only the 11 `signToken` call sites changed to `await issueToken(...)`.)*

### Phase 4 — Firebase central for social data

Move non-game-essential, migration-sensitive data out of per-shard Postgres into
the central Firebase project (coordinator holds admin creds; clients read/write
social data directly with `rtdbrules.json` keyed on `firebaseUID`).

- [x] Finalize RTDB paths in `rtdbrules.json`: `/profiles/$uid` (authed read,
      owner write, validated fields), `/friends/$uid` (owner only),
      `/friendRequests/$uid/$fromUid` (sender or recipient writes, recipient
      reads), `/notificationPreferences/$uid` + `/notificationTokens/$uid`
      (owner only). Chat stays on its existing paths — which are
      `conversations/*` and `users/<username>/*` in the live app (not
      `/chat/*`); those keep the current authed read/write model. *(Deploying
      the rules to the Firebase project is still a manual pending step.)*
- [x] **Coordinator** is the write authority for profile bootstrap: every token
      mint (`/auth/shard-token`, `/auth/select-server`, `/auth/refresh`) upserts
      `/profiles/<uid>` = `{username, lastShardId, updatedAt}` via the admin SDK
      (`src/social.ts`); non-fatal when Firebase is unreachable. Clients
      read/update own profile + friends per the security rules.
- [x] **Shard** stops being the source of truth for friendships: `addFriend`/
      `removeFriend` now write uid-keyed edges `/friends/<uid>/<friendUid>` to
      Firebase central via `util/socialStore.ts` (rename-proof, unlike the old
      username arrays), and renames sync `/profiles/<uid>/username`.
      *(Honest residuals: Postgres `Users.friends` is kept consistent as a
      derived read-cache because the gameplay loops — websocket visibility,
      damage, proximity — read it on hot paths; cache + read sites are removed
      together in Phase 5. Accounts without a `firebaseUID` and shards without
      Firebase admin creds stay Postgres-only until the Phase 5 migration.
      There is no separate `FriendRequests` write path — requests are
      one-sided edges in this game's design.)*
- [x] Friend-location lookups: a shard's DB only ever holds players connected
      to it, so live coords are inherently per-shard; cross-shard friend
      presence is the coordinator-maintained `lastShardId` in `/profiles/<uid>`
      (clients read it per security rules — frontend wiring is Phase 6).

### Phase 5 — Shard changes

- [x] **Migration script**: `npm run migrate:social` (`backend/scripts/
      migrate-social-to-firebase.ts`) — dry-run by default, `-- --apply` to
      write. Exports friends (as uid edges), profiles, push tokens, and
      notification preferences for every user with a `firebaseUID`; reports
      and skips legacy accounts without one. Idempotent. Owner-run with
      `firebasecred.json` + production `DATABASE_URL`. *(Not yet run against
      production.)*
- [ ] **Shard DB cleanup** — *partial.* Done: `FriendRequests` model dropped
      from `prisma/schema.prisma` (no active write path existed) along with
      its delete-cleanups and dead schema in `interfaces/common.ts`/
      `export-script.ts`. Remaining: dropping `Users.friends` and the friends
      API routes requires the Phase 6 frontend first — the live app still
      calls those routes, and the gameplay loops (websocket visibility,
      damage, proximity) still read the Postgres cache; removing them is the
      atomic cutover once clients talk to Firebase central directly.
- [x] `server.ts` Firebase Admin is now fully optional on shards: ID-token
      login/register/oauth verify via the coordinator's
      `POST /auth/verify-id-token` when there is no local admin SDK
      (`util/firebaseIdToken.ts`). *(Reframed from "strip": the **owner**
      deployment keeps `firebasecred.json` deliberately — the global chat
      message listener needs exactly one long-lived process, which Vercel
      can't host, and chat is global so community shards never needed it.
      Without creds a shard also skips Storage profile images and Firebase
      account-management ops like password/email changes.)*
- [x] `runners/`: coordinator **`POST /relay/push`** (auth: shard key,
      rate-limited 240/min per shard) reads tokens + preferences from Firebase
      central (`/notificationTokens`, `/notificationPreferences`) and sends
      via the **Expo push service** — correction: sends were never FCM-admin,
      they're Expo, so shards *can* push without Firebase; the relay's value
      is that community shards don't hold player push tokens. The shard's
      `NotificationService` falls back to the relay when it has no local
      token; full cutover (clients registering tokens centrally only) is
      Phase 6.
- [x] Wire the **30s heartbeat loop on the shard** — done in Phase 1
      (`runners/coordinatorClient.ts`, started from `server.ts`; skips cleanly
      when `COORDINATOR_URL` + `SHARD_API_KEY` are unset for solo/local
      hosting).
- [x] Required setup slimmed: boot needs `DATABASE_URL` (always local/own) and
      either coordinator vars or `JWT_SECRET` (solo). Email vars and
      `firebasecred.json` are optional, owner-deployment-only. `CLAUDE.md`
      and `.env.example` updated. *(README host docs still describe the
      Phase 1 flow — worth a pass when Phase 6 lands.)*

### Phase 6 — Frontend

- [x] Replace hardcoded `EXPO_PUBLIC_BACKEND_URL` in `api/axios-instance.ts` with
      server-discovery: `api/server-discovery.ts` queries the coordinator,
      auto-picks the nearest **verified** shard on first launch (manual
      override via the picker; unverified is never auto-picked), persists the
      choice in AsyncStorage (`selectedServer`, hydrated before the provider
      tree mounts), and points axios (per-request baseURL) **and** the
      WebSocket (resolved at connect time) at the chosen shard.
- [x] Only the **coordinator URL** (`EXPO_PUBLIC_COORDINATOR_URL`) and Firebase
      client config need to be baked into the app build.
      `EXPO_PUBLIC_BACKEND_URL` / `_WEBSOCKET_URL` remain supported as
      dev/solo-hosting fallbacks when no coordinator is configured or no
      server is selected.
- [ ] Login/register at coordinator; gameplay REST/WS at chosen shard; friends/
      profile/chat/notification prefs at **Firebase central**. *(Partial by
      architecture: gameplay REST/WS follow the chosen shard now, and chat is
      already client↔Firebase. Login/register stay pointed at the shard —
      per the Phase 3 design the shard validates and the **coordinator
      signs**, so no client change is needed until accounts centralize.
      Friends/profile/notification prefs still go through shard REST — they
      move with the social/push-token cutovers below.)*
- [x] **Unverified-server warning**: selecting a `verified: false` shard in the
      picker opens a blocking modal (host can see live location, username,
      in-game activity) requiring explicit acknowledgment; the accept is
      remembered per server id, and re-warned for each different unverified
      shard.
- [x] Verified badge on server picker for `verified: true` shards (and an
      "Unverified" tag otherwise), shown in both the list and the selected row
      (`components/ServerPicker.tsx`, wired into the login screen).
- [x] Coordinator marks active shards **offline** after the configured missed
      heartbeat window (`OFFLINE_AFTER_MISSED_HEARTBEATS`, default 5; allowed
      5-10). The next valid heartbeat moves `offline` shards back to `active`;
      offline shards are hidden from discovery.
- [x] Coordinator admin web page shows the registered shard details needed for
      operations: name, id, description, owner contact, region, public HTTP/WS
      URLs, status/listability, verified state, player count, heartbeat time,
      version, git SHA, coordinates, created/updated timestamps, and actions.
- [x] **Push-token cutover**: the client writes its Expo token to
      `/notificationTokens/<uid>` and mirrors preference changes to
      `/notificationPreferences/<uid>` (both `auth.uid`-scoped);
      logout removes the central token. `Users.notificationToken` is dropped
      from the shard schema along with the login/register pushToken writes and
      the `/api/updateNotificationToken` / `notificationTokenStatus` /
      `deleteNotificationToken` endpoints. `NotificationService` resolves
      delivery from Firebase central (admin SDK on the owner deployment,
      coordinator `/relay/push` on community shards). *(Known gap: legacy
      accounts without a Firebase session can't register a token — rules key
      on `auth.uid` — so they don't receive pushes; password reset migrates
      them to Firebase.)*
- [x] **Social cutover**: clients write uid edges to `/friends/<uid>` and a
      request entry to the target's `/friendRequests` inbox (`api/friends.ts`);
      `/api/friends`, `/api/addFriend`, `/api/removeFriend` and
      `/api/searchfriendsadded` are deleted from the shard. The client keeps an
      RTDB listener on its own edges and (re)declares the username list over
      the websocket (`friendsDeclare`) on connect and on every change.
      *(Design deviations, deliberate: `Users.friends` is NOT dropped — it
      survives as the client-DECLARED gameplay cache written only by the
      `friendsDeclare` handler, because friendly-fire exemption and
      friendsOnly visibility must keep working for OFFLINE friends, which a
      session-scoped in-memory graph cannot do. All ~100 gameplay read sites
      and the mutuality rule keep working unchanged — declaring strangers
      still gains nothing unless they declare back. Friend-request pushes now
      fire from the declaration diff, capped at 3 adds per declare so a
      first-time sync on a fresh shard can't blast a whole friends list. The
      friends-list UI still consumes the websocket `friends` payload, sourced
      from the declared cache.)*
      **Rules changed for this cutover — re-deploy `rtdbrules.json`:**
      `/friends/$uid` is now authed-read (clients need the back-edge for
      mutuality; friend lists were never private in the old REST API), and
      `/profiles` gained root authed-read + `.indexOn: ["username"]` for the
      username→uid lookup.

### Phase 7 — Post-login server selection + server history

Goal: make the distributed flow explicit and user-controlled. The app should
authenticate the person first, then ask where they want to play, then connect to
that shard. Server selection becomes a first-class step instead of a silent
startup default.

- [x] **Frontend login flow**: a full-screen selector
      (`components/ServerSelectScreen.tsx`) gates the gameplay shell —
      `ServerSessionGate` in `app/_layout.tsx` wraps the signed-in Stack, so
      both fresh logins and cold starts pass through it before anything
      connects. It shows online shards (verified badge, region, player count)
      and a "Recent servers" section from coordinator history. *(Deviation,
      deliberate: the login screen KEEPS its small Phase 6 picker — login
      itself still talks to a shard (`/api/lookup` + `/api/login`; the shard
      validates, the coordinator signs, per Phase 3), so the user needs a
      login target before they authenticate. The post-login selector is the
      authoritative "where do I play" step.)*
- [x] **No automatic unverified selection**: the selector never auto-picks
      anything; the quick "Continue" card only ever targets the most recent
      still-listable **verified** shard. Unverified picks go through the same
      blocking warning + per-server acknowledgment as Phase 6 (the modal is
      now a shared component exported from `ServerPicker.tsx`).
- [x] **Connecting transition**: implemented as a per-app-session "server
      confirmed" flag in `api/server-discovery.ts` that the websocket hook
      subscribes to — in distributed mode the socket cannot connect until the
      selector confirms. After the pick, the selector mints the token, persists
      the selection (axios/WS resolve URLs from it), then holds
      `ConnectingScreen` until the first gameplay payload (`healthdata`)
      arrives or a 15s safety timeout fires.
- [x] **Coordinator stores server history in Firebase RTDB**:
      `store.recordServerUse()` writes
      `/coordinator/users/<uid>/serverHistory/<shardId>` =
      `{ firstUsedAt, lastUsedAt, useCount, lastServerName, lastRegion,
      lastVerified }` via an RTDB transaction (display fields are snapshots so
      delisted servers still render). Admin SDK only — the existing
      `/coordinator` rules already lock it, **no rules re-deploy needed** for
      Phase 7. Legacy accounts record under `user:<username>`.
- [x] **History in the server list**: `GET /servers` accepts an optional
      `Authorization: Bearer <Firebase idToken>`; when valid the response adds
      `history` (sorted by `lastUsedAt` desc) with an `available` flag joined
      against the currently-listable set. A missing/expired token silently
      degrades to the anonymous response — discovery never fails over
      identity. Unavailable history entries render dimmed and unpressable;
      `select-server` refuses non-listable shards server-side regardless.
- [x] **Selection write path**: `POST /auth/select-server` now reads the
      canonical username from `/profiles/<uid>/username` (token claims only as
      fallback for first-ever mints), mints the shard JWT, bootstraps the
      profile (`lastShardId`), and records history. `/auth/shard-token` and
      `/auth/refresh` record history too (compatibility). History writes are
      non-fatal — they never break a mint.
- [x] **Resume behaviour**: session confirmation is in-memory per JS session,
      so every cold start with a Firebase-backed session shows the selector
      (recents first, Continue quick action); returning from background within
      the same session does not re-ask. Sign-out resets the flag. *(Honest
      limits: legacy accounts — no `firebaseUID` in SecureStore — and the dev
      offline token skip the selector entirely; their identity is shard-local,
      so server switching is meaningless for them. If the coordinator is
      unreachable at selection time, picking the already-selected server falls
      back to the existing shard token instead of locking the player out.)*
- [x] **Local/solo fallback**: when `EXPO_PUBLIC_COORDINATOR_URL` is unset the
      session is always auto-confirmed and the selector never mounts — the
      direct-backend flow is byte-for-byte the old behavior.
      **Addition this phase required (shard side): server-migration
      onboarding.** A coordinator-signed token for a user the shard has never
      seen used to fail websocket auth, which would have made switching
      servers impossible. `websocket.ts` now provisions `Users` +
      `GameplayUser` on first connect when the token carries a `firebaseUID`
      (identity proven by the coordinator's signature; fresh world, default
      gameplay state). It refuses when that `firebaseUID` already exists
      locally under a different username (central rename not applied here) or
      when the username is taken by a different identity. Legacy HS256 tokens
      never provision.

### Phase 8 — Coordinator-only authentication (email / Apple / Google)

Goal: authentication touches **only Firebase Auth and the coordinator** — no
game server is contacted until the player has picked one in the post-login
selector. Enabled by Phase 7's shard provisioning: a brand-new account's
`Users`/`GameplayUser` rows are created at first websocket connect, so the app
never needs shard `/api/register` or `/api/login` in distributed mode.

- [x] **Email login is Firebase-direct**: the login form takes email +
      password and calls `signInWithEmailAndPassword` — the shard
      `/api/lookup` username→email resolution is gone from the distributed
      flow. Apple/Google likewise stop calling shard `/api/oauth-login`; the
      Firebase session alone is the authentication.
- [x] **Usernames are allocated centrally**: coordinator
      `POST /auth/claim-username` (auth: Firebase ID token) transactionally
      claims the lowercased name in `/coordinator/usernameIndex` and writes
      `/profiles/<uid>/username`; `GET /auth/username-available` backs the
      register form. Availability also consults existing profiles (indexed
      query) so pre-claim accounts keep their names. Format rule matches the
      shards' historic one: 3-20 letters/numbers.
- [x] **Register**: username availability check → Firebase `createUser` →
      claim. A lost claim race doesn't strand the account — the session gate
      re-asks via `components/UsernameClaimScreen.tsx`, which is also how
      first-time Apple/Google users pick their name (prefilled from their
      display name).
- [x] **`/auth/select-server` returns `username`** and the client caches it
      (SecureStore) — with email login the app otherwise wouldn't know the
      game username. The session gate also caches it from the profile on
      every cold start.
- [x] **`/profiles` writes locked to the Admin SDK** in `rtdbrules.json`
      (clients only ever read profiles — verified). Usernames can now only
      enter via the coordinator's uniqueness-checked claim, the mint
      bootstrap, or the owner shard's rename sync.
      **This changes `rtdbrules.json` again — re-deploy it** (bundle with the
      still-pending Phase 6 deploy).
- [x] **Password reset via Firebase** (`sendPasswordResetEmail`) in
      distributed mode — no shard email creds, no reset-code entry in the
      app. The username-reminder option is hidden (login is by email).
- [x] **Server picker removed from the login screen** — authentication no
      longer needs a target, so the Phase 6 inline picker is gone from
      `app/login.tsx`; the post-login full-screen selector is the only
      server choice. (`ServerPicker.tsx` survives as the home of the shared
      badge/warning-modal components.)
- [x] **Selector de-duplicated**: each server appears in exactly one section —
      the Continue card swallows its own history row, "Recent" holds the rest
      (capped at 5), and the directory section ("Other servers", or "All
      servers" when there's nothing above it) lists only what hasn't been
      shown. A lone server renders once instead of three times.

*Honest residuals:* solo/no-coordinator builds keep the legacy username login
and the shard keeps `/api/lookup`/`/api/login`/`/api/register`/
`/api/oauth-login` for them and for old app versions. **Legacy accounts
without a Firebase identity cannot sign in through the new distributed flow
at all** (they could before via the shard's argon2 path) — they need an old
app build or a solo shard; their argon2-only credentials never worked with
Firebase anyway. Renames still run through shard `/api/changeUsername`, which
updates the profile but not the claim index — the old name stays reserved and
rename centralization is future work. Claims are unique case-insensitively,
but the existing-profile check is exact-match, so a case-variant of a
pre-claim name can slip through. The `__DEV__` offline bypass only exists in
the solo login path now.

### Phase 9 — Payment migration (RevenueCat verification moves to the coordinator)

Goal: real-money purchases are verified by the **coordinator**, never trusted
from the client and never requiring a secret on a shard.

**Current state (what's wrong):** the app configures RevenueCat with the
*public* SDK keys (`EXPO_PUBLIC_REVENUECAT_API_KEY_APPLE/GOOGLE`) — those are
designed to ship in the binary and are fine. The hole is server-side: after a
purchase, `store.tsx` checks `customerInfo.entitlements.active[...]` **in
client JS** and then calls the shard's `/api/addMoney` / `/api/addItem` with a
client-chosen amount. Nothing verifies the purchase server-side — any valid
JWT can mint coins with one curl. The RevenueCat **secret** key (`sk_...`)
exists nowhere in the repos yet; per the one security law it must live on the
coordinator only.

- [ ] **Stable purchase identity**: call `Purchases.logIn(firebaseUID)` at
      sign-in so RevenueCat's `app_user_id` is the same identity the
      coordinator mints tokens for (today it's an anonymous ID, which makes
      server-side attribution impossible). Log out of RevenueCat on sign-out.
- [ ] **Coordinator `POST /purchases/redeem`** (auth: Firebase ID token, same
      pattern as `/auth/claim-username`): coordinator holds
      `REVENUECAT_SECRET_KEY` in its env, calls RevenueCat REST
      (`GET /v1/subscribers/{firebaseUID}`) to confirm the transaction exists
      for that user, and records the RevenueCat transaction id in RTDB
      (`/coordinator/purchases/<txId>`) so each purchase redeems **once**
      (storing which shard received the grant — shards are separate worlds).
      Optionally add a RevenueCat **webhook** receiver later for audit.
- [ ] **Grant delivery via signed voucher**: the coordinator mints a
      short-lived RS256 grant token (`sub` = firebaseUID, `aud` = target shard
      id, claims `{grant, amount|item, txId}`) with the **same private key**
      it already uses for auth tokens. The client presents it to the shard's
      new `POST /api/redeemPurchase`; the shard verifies it with the JWKS it
      already caches (`util/auth.ts`) and credits coins / inventory. Zero new
      secrets on shards; no coordinator→shard credential needed.
- [ ] **Shard replay protection**: shard stores redeemed `txId`s (new small
      Prisma table) and refuses a voucher it has seen.
- [ ] **Close the holes**: delete `/api/addMoney` and the client-callable
      `/api/addItem` from the shard (or gate them solo-mode-only behind
      `JWT_SECRET`, like the legacy login routes). Rewire `store.tsx`'s
      `buyItem` to the redeem round-trip (purchase → coordinator redeem →
      voucher → shard) and drop the client-side entitlement check as the
      authority.
- [ ] **Fix the consumable semantics while moving**: coin packs are
      consumables — `entitlements.active['Coins']` is the wrong check
      (entitlements model subscriptions/non-consumables). Server-side
      verification should read the subscriber's non-subscription transaction
      list; don't port the client bug.
- [x] **Stripe removal**: `stripeCustomerId` dropped from `Users` in
      `prisma/schema.prisma` — it was the only Stripe artifact in either repo
      (no package, route, or webhook ever existed). The `donate.stripe.com`
      links in the frontend settings screen are hosted donation URLs, not
      purchase logic, and stay.

*Honest residuals:* a community host can still grant themselves infinite coins
**in their own world** — inherent and acceptable (the economy is world-local).
This phase protects the **payment boundary**: nobody receives paid goods
without a real store transaction, redeemed exactly once, and verified/owner
shards' economies can't be inflated by arbitrary clients. Solo/no-coordinator
hosts have no secret-key holder, so premium purchases are
distributed-mode-only (the coin shop works everywhere).

### Phase 10 — Temporary legacy Firebase reconciliation window

Goal: for a limited migration window, let users who already created or confirmed
a Firebase Auth account finish being linked to their old main-db account
automatically. The Firebase account proves control of the email address; the
owner/main database is used only as a legacy lookup source to recover username,
friend list, and missing central RTDB rows.

**Problem this phase fixes:** some production users exist in the main Postgres
database with an email address and possibly a Firebase Auth account, but their
`Users.firebaseUID`, `/profiles/<uid>`, `/friends/<uid>`, notification prefs,
and coordinator username claim/index may not all be populated yet. In the Phase
8 distributed login flow, those users can authenticate with Firebase but still
look like incomplete or brand-new central accounts.

- [ ] **Enable only on the owner/main shard**: add a temporary
      `LEGACY_ACCOUNT_RECONCILIATION_UNTIL` env var (date, e.g. three months
      from rollout). Community shards must not run this flow because they do
      not hold the canonical historical database.
- [ ] **Firebase login reconciliation path**: when `/api/login` or the
      coordinator login/bootstrap flow receives a verified Firebase ID token,
      first look up `Users.firebaseUID = uid`; if absent, look up
      `Users.email = decoded.email`. Only continue when Firebase reports the
      email as verified. Never link by unverified email.
- [ ] **Safe linking rules**: if email lookup finds exactly one legacy user
      whose `firebaseUID` is empty, set `Users.firebaseUID = uid` in a
      transaction. Refuse and log if the email maps to multiple users, the UID
      is already linked to a different username, or the legacy row has a
      conflicting Firebase UID.
- [ ] **Central username/profile repair**: after linking, upsert
      `/profiles/<uid>` with `{ username, updatedAt, migratedFromLegacy: true }`
      and claim/reserve the username in `/coordinator/usernameIndex` using the
      same case-insensitive key as Phase 8. If the username is already claimed
      by the same UID, continue; if claimed by another UID, stop and require
      manual support because the identity boundary is ambiguous.
- [ ] **Friend-list migration on demand**: copy the legacy
      `Users.friends[]` username list to uid-keyed RTDB edges. For each friend,
      resolve the friend's `firebaseUID` from the main DB. Write
      `/friends/<uid>/<friendUid> = true` only when the friend has a UID; report
      skipped friends without UIDs so they can be backfilled when those users
      reconcile later. Do not create friend requests during this repair.
- [ ] **Notification preferences repair**: if a linked legacy user has
      `NotificationPreferences`, upsert `/notificationPreferences/<uid>` with
      those flags. Do not restore old push tokens from Postgres; Phase 6 made
      clients register current Expo tokens directly to RTDB.
- [ ] **Make the migration idempotent**: expose a reusable helper/script, e.g.
      `reconcileLegacyFirebaseUser(uid, email)` and
      `npm run reconcile:legacy-social -- --email user@example.com`, so support
      can run it manually and login can call the same code. Re-running should
      only fill missing rows or confirm they already match.
- [ ] **Audit and support visibility**: write a coordinator/admin audit row
      under `/coordinator/accountReconciliations/<uid>` with timestamp, source
      email, linked username, counts of migrated friend edges/prefs, skipped
      friends, and any refusal reason. Add an admin-listable report of legacy
      users still missing `firebaseUID`.
- [ ] **Retirement plan**: once the window expires and the report is empty (or
      acceptable), disable the env flag, remove email-based legacy linking from
      login, and keep only explicit admin/support reconciliation for stragglers.

*Security boundary:* Firebase email verification is the only automatic proof
accepted here. Password knowledge from the old shard is not required, but an
unverified Firebase email is not enough. Username/friend data flows only from
the owner database to central RTDB, never from a community shard into the global
social graph.

### Phase 11 — Gameplay privacy/damage validation + host setup QA

Goal: validate the gameplay behavior that matters most after the distributed
hosting work: clients must see the intended diffused player location, diffused
players must remain easy to select in the UI, missile damage must apply to
everyone in radius regardless of friendship, and Docker hosting docs must be
tested like a first-time community host would use them.

#### 11A — Diffused location contract

- [ ] **Define the authoritative location payload**: the websocket
      `playerlocations` message must send the display-safe diffused
      coordinates for other players, not their precise `Locations.latitude` /
      `Locations.longitude`. Precise coordinates may remain server-only for
      damage, proximity, anti-cheat, and movement validation.
- [ ] **Add an explicit precision flag/type**: extend the websocket payload with
      a field such as `locationPrecision: "precise" | "diffused"` or a
      dedicated `diffusedPlayerLocation` message type. The `middle-earth`
      package may need a versioned WS message/type update so old clients do not
      silently misread the new shape.
- [ ] **Validate click/tap hit testing**: reproduce the current issue where a
      diffused player is harder to click, then verify the frontend marker uses
      the rendered diffused coordinate and a stable hit area. The tap target
      must not depend on hidden precise coordinates or marker jitter.
- [ ] **Update player details copy**: the player-details UI should clearly say
      the shown location is approximate/diffused, not precise. Do not expose
      exact coordinates through details, debug text, or nested payload fields.
- [ ] **Regression tests / fixture**: add a test or recorded websocket fixture
      where a precise server location diffuses to a different client location,
      and assert the outgoing `playerlocations` payload contains only the
      diffused coordinate plus the precision marker.

#### 11B — Missile damage validation

- [ ] **Separate visibility from damage eligibility**: friendsOnly/friendship
      filters can decide which missiles/entities a player sees, but damage
      processing must evaluate every active player against every impacted
      missile in radius. A friend/ally relationship must not suppress missile
      damage.
- [ ] **Friendly fire is intentional for missiles**: missiles should damage all
      players in radius, including mutual friends/allies and the sender, unless
      an explicit protection rule applies (shield, grace period, dead player,
      inactive location, or outside radius).
- [ ] **Audit sender/self-damage behavior**: confirm the sender is included in
      the damage pass when they are inside the blast radius. Notifications and
      rewards should not create nonsensical self-reward/self-elimination loops;
      define the expected reward behavior before shipping the fix.
- [ ] **Add targeted tests**: cover at least these cases: friend in radius takes
      missile damage, sender in radius takes missile damage, non-friend in
      radius takes missile damage, player outside radius does not, shielded
      player does not, grace-period player does not.
- [ ] **Keep landmine rules separate**: landmine ownership/friend behavior can
      be reviewed separately; do not accidentally change landmine behavior while
      fixing missile blast damage.

#### 11C — Docker docs and first-time host validation

- [ ] **Fresh-machine walkthrough**: run the README/community-host setup from a
      clean checkout with no existing `.env`, containers, or volumes. Verify
      `./docker/host.sh` and `.\docker\host.ps1` document prerequisites,
      generate local DB credentials, register with the coordinator, start
      services, run `prisma db push`, and print the usable public URL.
- [ ] **Failure-path docs**: validate common failures have clear next steps:
      Docker missing, Docker daemon stopped, port already in use, port not
      forwarded, coordinator unreachable, bad shard API key, health check
      failing, and database container not ready.
- [ ] **Version/update path**: document the exact update flow for hosts pulling
      a new backend version (`git pull`, rebuild, migrate, preserve DB volume),
      plus how to wipe/reset intentionally.
- [ ] **Smoke-test checklist**: add a short post-setup checklist: `/healthz`
      works locally, public reachability check passes, coordinator admin shows
      heartbeat/player count, server appears in discovery, a test user can
      select it, websocket connects, and location/missile loops run.
- [ ] **Docs match implementation**: ensure `.env.example`, README, host
      scripts, Dockerfile, `docker-compose.yml`, and coordinator registration
      messages all use the same env var names and do not mention deprecated
      Firebase/admin secrets for community shards.

### Phase 12 — Coordinator-driven shard auto-update

Goal: when a new backend release is published by bumping `backend/package.json`,
community shards should notice the version mismatch the next time they talk to
the coordinator and update themselves with minimal host involvement.

**Release source of truth:** `backend/package.json` version. A release is
created only from an annotated git tag matching that version
(`backend-vX.Y.Z`) and a published container image/digest or git commit SHA.
The coordinator stores the latest approved release metadata in RTDB, e.g.
`/coordinator/releases/backend/latest = { version, gitSha, imageDigest,
minimumSupportedVersion, rolloutPercent, migrationRequired, publishedAt }`.

- [ ] **Coordinator release metadata endpoint**: add
      `GET /releases/backend/latest` and include the same release fields in the
      shard heartbeat response. The heartbeat request already sends the shard's
      current `version` and `gitSha`; the response should say whether the shard
      is `current`, `update_available`, `update_required`, or `blocked`.
- [ ] **Version policy**: coordinator compares semantic versions, not strings.
      Patch/minor releases can be optional or gradual via `rolloutPercent`;
      security fixes or protocol-breaking releases set `minimumSupportedVersion`
      so outdated shards are hidden from discovery until updated.
- [ ] **Shard update agent**: extend `runners/coordinatorClient.ts` so a shard
      that receives `update_available` schedules a local update instead of only
      logging it. Updates must be serialized with a lock file so repeated
      heartbeats cannot start overlapping pulls/builds.
- [ ] **Updater script**: add `backend/docker/update.sh` and
      `backend/docker/update.ps1` used by both the heartbeat-triggered updater
      and manual host runs. The script should:
      1. fetch the approved tag/commit or pull the approved image digest,
      2. verify it matches coordinator release metadata,
      3. preserve `.env` and Postgres volumes,
      4. run `docker compose pull` or `docker compose build`,
      5. run the migrate step,
      6. restart the backend,
      7. wait for `/healthz`,
      8. send an immediate heartbeat with the new version.
- [ ] **Rollback and failure reporting**: if update or health check fails, keep
      the previous container/image running when possible, write a local update
      log, and report `updateFailed: { fromVersion, toVersion, reason }` in the
      next heartbeat so the admin portal can surface broken hosts.
- [ ] **Admin portal visibility**: show each shard's `version`, `gitSha`,
      `updateStatus`, `lastUpdateAttempt`, and `lastUpdateError`. Add a manual
      "request update" action that marks a shard for update on its next
      heartbeat without needing shell access to the host.
- [ ] **Safety controls**: hosts can set `AUTO_UPDATE=false` to opt out, but the
      coordinator may mark old versions unavailable for player routing. Auto
      updates should not run while active players are connected unless the
      release is marked `critical`; otherwise wait for zero players or a quiet
      window.
- [ ] **Docs and test matrix**: document automatic and manual update paths,
      including Docker image vs git checkout mode, Windows PowerShell, failed
      migration recovery, and how to intentionally pin a version. Add a smoke
      test that starts an old shard, publishes fake release metadata, observes
      update scheduling, and confirms the shard returns with the new
      `package.json` version in its heartbeat.

*Security boundary:* auto-update cannot make an untrusted host trustworthy; a
host can always modify local code or disable the updater. The coordinator uses
version status only for discovery/routing and admin visibility. Verified status
still means human trust in the host, not proof that the binary is unmodified.

## File-level change map (known from current code)

| File | Change |
| ---- | ------ |
| `backend/util/auth.ts` | HS256 → asymmetric verify-only; drop `signToken` on shard |
| `backend/server-routes/authRoutes.ts` | Move login/register/reset/oauth to coordinator; **Phase 10** temporary owner-shard legacy email→Firebase UID reconciliation |
| `backend/server-routes/*` (friends/profile) | **Phase 5** — delete social routes after Firebase cutover (no proxies) |
| `backend/server.ts` | **Phase 5** — strip Firebase init; heartbeat loop already live |
| `backend/runners/coordinatorClient.ts` | **Done** — 30s heartbeat to coordinator; **Phase 12** consume release metadata from heartbeat responses and schedule locked auto-updates |
| `backend/runners/*` (push/notification) | **Phase 5** — FCM send → coordinator `/relay/push` |
| `backend/prisma/schema.prisma` | **Phase 5** — drop social models after migration script |
| `backend/scripts/migrate-social-to-firebase.ts` | **Phase 5** — one-time Postgres → Firebase central export; **Phase 10** share/idempotently reuse repair logic for users linked later |
| `backend/scripts/reconcile-legacy-firebase-user.ts` | **Phase 10** — new owner-only support script for email/UID linking + RTDB social backfill |
| `backend/docker/host.sh` | **New** — one-click launcher: Docker detection, setup, register, port check |
| `backend/docker/host.ps1` | **New** — Windows equivalent of `host.sh` |
| `frontend/api/axios-instance.ts` | Coordinator discovery + shard select + unverified warning UI |
| `frontend/api/server-discovery.ts` | **Phase 7 done** — history in server list, `/auth/select-server` client, per-session confirmation gate |
| `frontend/api/friends.ts` | Read/write Firebase central instead of shard REST |
| `frontend/components/ServerSelectScreen.tsx` | **Phase 7 done** — full-screen post-login selector; holds `ConnectingScreen` until first gameplay payload |
| `frontend` login/navigation flow | **Phase 7 done** — `ServerSessionGate` in `app/_layout.tsx`: login, then selector, then gameplay |
| `frontend` WebSocket setup | Point at chosen shard URL; **Phase 7** — waits for session confirmation |
| `backend/server-routes/websocket.ts` | **Phase 7 done** — provision migrated users on first coordinator-token connect; **Phase 11** send diffused player locations + precision metadata |
| `backend/runners/damageProcessor.ts` | **Phase 11** — missile damage must ignore friendship/friendsOnly visibility filters and include allies/sender in radius |
| `backend/docker/update.sh` | **Phase 12** — new Unix updater used by heartbeat-triggered and manual updates |
| `backend/docker/update.ps1` | **Phase 12** — new Windows updater used by heartbeat-triggered and manual updates |
| `middle-earth` package | **Phase 11** — version WS message/type support for diffused-location metadata if the payload shape changes |
| **coordinator** `../backend-coordinator/` | Vercel + Firebase RTDB; auth, directory, JWKS, relay, **admin portal** — **no Prisma** |
| **coordinator** `src/routes/auth.ts` | **Phase 7 done** — history recorded on select-server/shard-token/refresh; profile username preferred; **Phase 10** account bootstrap must tolerate centrally repaired legacy profiles |
| **coordinator** server-list/discovery route | **Phase 7 done** — optional ID-token auth adds the user's history to `GET /servers` |
| **coordinator** `rtdbrules.json` | **New** — lock `/coordinator/*`; `firebaseUID`-scoped social paths |
| **coordinator** `src/store.ts` | RTDB read/write for shards, users, sessions, and **Phase 7 done** server history; **Phase 10** reconciliation audit rows |
| **coordinator** release route/store | **Phase 12** — latest backend release metadata, semver policy, heartbeat update instructions, admin update status |
| **coordinator** `src/routes/purchases.ts` | **Phase 9** — new: RevenueCat secret-key verification, RTDB purchase ledger, grant-voucher minting |
| `backend/server-routes/moneyApi.ts` | **Phase 9** — delete `/api/addMoney`; add voucher-verified `/api/redeemPurchase` |
| `backend/prisma/schema.prisma` | **Phase 9** — redeemed-`txId` table for voucher replay protection; **done**: `stripeCustomerId` dropped |
| `frontend/app/_layout.tsx` | **Phase 9** — `Purchases.logIn(firebaseUID)` after sign-in, logout on sign-out |
| `frontend/app/(tabs)/store.tsx` | **Phase 9** — `buyItem` → coordinator redeem → shard voucher flow; drop client entitlement check as authority |
| `frontend` map/player marker components | **Phase 11** — click/tap target follows diffused marker position and remains easy to select |
| `frontend` player-details UI | **Phase 11** — say location is approximate/diffused, not precise |
| `README.md` / `.env.example` / `docker/*` | **Phase 11** — validate community-host docs against a clean first-time setup and failure paths |

## Effort / risk

- **Phase 1–2:** small, days each. Standalone, no risk to current deploy.
- **Phase 3:** riskiest — touches the assumptions of every authenticated
  endpoint. Contained because `util/auth.ts` is already the single source of
  truth for JWTs.
- **Phase 4:** moderate — stand up Firebase central paths + rules; coordinator
  bootstraps profiles; shard stops writing social data to Postgres.
- **Phase 5:** moderate — migration script, atomic Prisma/route removal, strip
  Firebase Admin from shard. Run the script before dropping models.
- **Phase 6:** moderate — frontend server discovery + social reads/writes against
  Firebase central.
- **Phase 7:** moderate — mostly frontend navigation/state sequencing plus a
  small coordinator RTDB history API. Low gameplay risk if the selector gates
  connection before REST/WS are pointed at a shard.
- **Phase 9:** moderate — one new coordinator route + RTDB ledger, one new
  shard endpoint reusing the existing JWKS verify path, and a `store.tsx`
  rewire. Riskiest part is deleting `/api/addMoney`/`addItem` while old app
  builds still call them — gate by app version or keep solo-mode-only.
- **Phase 10:** moderate/high operational risk — identity repair touches old
  account ownership. Keep it owner-shard-only, email-verified, idempotent,
  audited, and time-limited so it solves migration fallout without becoming a
  permanent ambiguous login path.
- **Phase 11:** moderate gameplay/regression risk — damage and location privacy
  touch hot websocket/game-loop paths. Keep precise coordinates server-only,
  separate visibility from damage, and ship with targeted tests plus a manual
  Docker first-time-host checklist.
- **Phase 12:** moderate/high operational risk — self-updating code can take a
  host offline if release metadata, migrations, or Docker rebuilds are wrong.
  Keep release metadata explicit, updates locked/serialized, health-checked,
  rollback-aware, and visible in the admin portal.

## Decided

1. **Host trust model** — **open registration** with **verified / unverified**
   labels. Unverified servers stay playable; users get a mandatory security
   warning (location, tokens, host visibility). Project owner sets verification
   via the coordinator admin portal.
2. **Social data** — **Firebase central (RTDB)** for friends, profile/contact
   details, chat, notification prefs. **Per-shard Postgres** for inventory,
   economy, live gameplay. Friend lists must survive shard migration.
3. **Chat** — **global Firebase RTDB** (existing); not per-shard.
4. **Coordinator storage** — **Firebase RTDB only** for server registry,
   verified status, heartbeats, and global account rows. **No Postgres/Prisma in
   `backend-coordinator`.** Shards push heartbeats; the coordinator records them.
5. **Shard self-host UX** — one-click `docker/host.sh` (and `.ps1` on Windows):
   detect missing Docker and prompt install, auto-generate local secrets, optional
   coordinator registration, and port-forwarding reachability check with actionable
   guidance (community hosts must forward `PORT` on their router).
6. **Player server choice UX** — after authentication, the frontend prompts the
   user to choose a server. The coordinator records recently used servers in
   Firebase RTDB so the selector can offer a clear "continue/recent" flow on
   later launches.
7. **Legacy account reconciliation** — temporary, owner-main-db-only
   email-verified Firebase UID linking is acceptable for the migration window.
   Community shards must never be allowed to write recovered social identity
   into central RTDB.
8. **Missile friendly fire** — missiles are area-of-effect damage and should
   hurt every eligible player in radius, including allies/friends and the
   sender. Friendship controls visibility/social UX, not blast immunity.
9. **Location privacy contract** — player location sent to other clients should
   be display-safe/diffused when diffusion applies; precise location remains a
   backend-only gameplay input unless the viewer is explicitly allowed to see
   precision.
10. **Shard version/update policy** — `backend/package.json` is the version source
   of truth. Shards report it in heartbeats; the coordinator can instruct
   auto-update, hide unsupported versions from discovery, and surface failures
   in the admin portal.

## Open decisions to settle before/while building

1. **Key algorithm** — ~~RS256 vs Ed25519~~ **Decided: RS256** (the shard's
   `jsonwebtoken` stack verifies RSA universally; implemented in coordinator).
2. **Token lifetime** — **Decided: 12h** shard tokens (`TOKEN_TTL_HOURS`,
   coordinator env). Refresh cadence still open.
3. **Release artifact strategy** — decide whether community shards update from
   git tags, published Docker image digests, or both. Prefer image digests for
   reproducibility; keep git checkout mode only if hosts are expected to build
   locally.
4. **Firebase store for social** — ~~RTDB vs Firestore~~ **Decided: RTDB for v1**
   (consistent with chat; single `rtdbrules.json` covers coordinator + social).
5. **Admin portal stack** — **Decided: same deploy** — a single static page
   served by the coordinator at `/admin`, gated by `ADMIN_API_KEY`.
6. **Port-forward check implementation** — external probe API vs self-hosted
   checker; must work from a typical home/VPS host and print the public URL
   players will use.
7. **Phase 10 expiry date** — choose the exact rollout date and sunset date
   for `LEGACY_ACCOUNT_RECONCILIATION_UNTIL`; default recommendation is three
   months after deployment, then support-only manual reconciliation.
8. **Diffusion algorithm ownership** — decide whether the backend owns the
   diffusion calculation or whether `middle-earth` should expose a shared
   deterministic helper used by both backend tests and frontend fixtures.
9. **Self-damage rewards** — decide whether a missile sender who eliminates
   themselves receives no reward, a penalty only, or the existing reward path
   with safeguards. Do this before changing missile damage logic.
