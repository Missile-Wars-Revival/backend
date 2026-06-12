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
- [x] **Admin portal** (login-protected web UI at `/admin`): list shards, approve/disable, **toggle verified**, rotate keys. Backed by `ADMIN_API_KEY`.
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

- [ ] **Frontend login flow**: after login/register/oauth succeeds, route the
      user to a full-screen server selector before mounting gameplay. The
      selector should show online shards from the coordinator, verified status,
      region/player count, and a "previously used" / "recent" section when the
      coordinator has history for this user.
- [ ] **No automatic unverified selection**: verified servers may be suggested
      or highlighted, but unverified servers still require the existing blocking
      warning and per-server acknowledgement before connect.
- [ ] **Connecting transition**: after the user chooses a server, show
      `components/ConnectingScreen.tsx` while the app obtains/refreshes the
      shard token, persists the selected shard, points axios/WebSocket at that
      shard, and waits for the first successful gameplay connection/state load.
      This avoids flashing map/death/gameplay UI while the shard connection is
      still settling.
- [ ] **Coordinator stores server history in Firebase RTDB**: every successful
      server selection/token mint updates a coordinator-owned history path such
      as `/coordinator/users/<uid>/serverHistory/<shardId>` with
      `{ firstUsedAt, lastUsedAt, useCount, lastServerName, lastRegion,
      lastVerified }`. This is written only by the coordinator Admin SDK, never
      directly by clients.
- [ ] **History in the server list**: include the authenticated user's recent
      server history in the existing coordinator server-list/discovery
      response, joined with current shard status/discovery fields. The selector
      should use that history to show recent servers first. Disabled or stale
      shards can be shown as unavailable, but must not be connectable.
- [ ] **Selection write path**: `POST /auth/select-server` should be the single
      authoritative client selection path. After verifying the Firebase ID token
      and confirming the shard is listable, it mints the shard-scoped JWT,
      upserts `/profiles/<uid>.lastShardId`, and records server history.
      Shard-mediated token mints (`/auth/shard-token`) may also record history
      for compatibility, but the Phase 7 frontend should prefer
      `/auth/select-server`.
- [ ] **Resume behaviour**: on app launch with an existing Firebase session,
      show the server selector with the user's recent servers first. A quick
      "continue" action can target the most recent still-listable verified
      shard, but the user should be able to change shards before gameplay
      connects.
- [ ] **Local/solo fallback**: when `EXPO_PUBLIC_COORDINATOR_URL` is unset, keep
      the current direct-backend flow so development and solo hosts still work
      without a selector/history service.

## File-level change map (known from current code)

| File | Change |
| ---- | ------ |
| `backend/util/auth.ts` | HS256 → asymmetric verify-only; drop `signToken` on shard |
| `backend/server-routes/authRoutes.ts` | Move login/register/reset/oauth to coordinator |
| `backend/server-routes/*` (friends/profile) | **Phase 5** — delete social routes after Firebase cutover (no proxies) |
| `backend/server.ts` | **Phase 5** — strip Firebase init; heartbeat loop already live |
| `backend/runners/coordinatorClient.ts` | **Done** — 30s heartbeat to coordinator |
| `backend/runners/*` (push/notification) | **Phase 5** — FCM send → coordinator `/relay/push` |
| `backend/prisma/schema.prisma` | **Phase 5** — drop social models after migration script |
| `backend/scripts/migrate-social-to-firebase.ts` | **Phase 5** — one-time Postgres → Firebase central export |
| `backend/docker/host.sh` | **New** — one-click launcher: Docker detection, setup, register, port check |
| `backend/docker/host.ps1` | **New** — Windows equivalent of `host.sh` |
| `frontend/api/axios-instance.ts` | Coordinator discovery + shard select + unverified warning UI |
| `frontend/api/server-discovery.ts` | **Phase 7** — read history metadata from server list, select via coordinator before gameplay connect |
| `frontend/api/friends.ts` | Read/write Firebase central instead of shard REST |
| `frontend/components/ConnectingScreen.tsx` | **Phase 7** — show while selected shard token + REST/WS connection settles |
| `frontend` login/navigation flow | **Phase 7** — login first, then full-screen server selector, then gameplay |
| `frontend` WebSocket setup | Point at chosen shard URL |
| **coordinator** `../backend-coordinator/` | Vercel + Firebase RTDB; auth, directory, JWKS, relay, **admin portal** — **no Prisma** |
| **coordinator** `src/routes/auth.ts` | **Phase 7** — record server history during `/auth/select-server` |
| **coordinator** server-list/discovery route | **Phase 7** — include authenticated user's server history in the existing server list response |
| **coordinator** `rtdbrules.json` | **New** — lock `/coordinator/*`; `firebaseUID`-scoped social paths |
| **coordinator** `src/store.ts` | RTDB read/write for shards, users, sessions, and **Phase 7** server history |

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

## Open decisions to settle before/while building

1. **Key algorithm** — ~~RS256 vs Ed25519~~ **Decided: RS256** (the shard's
   `jsonwebtoken` stack verifies RSA universally; implemented in coordinator).
2. **Token lifetime** — **Decided: 12h** shard tokens (`TOKEN_TTL_HOURS`,
   coordinator env). Refresh cadence still open.
3. **Shard version gating** — refuse to route players to outdated/modified
   shards via the git-sha in the heartbeat (can delist, cannot prevent modified
   shards from existing).
4. **Firebase store for social** — ~~RTDB vs Firestore~~ **Decided: RTDB for v1**
   (consistent with chat; single `rtdbrules.json` covers coordinator + social).
5. **Admin portal stack** — **Decided: same deploy** — a single static page
   served by the coordinator at `/admin`, gated by `ADMIN_API_KEY`.
6. **Port-forward check implementation** — external probe API vs self-hosted
   checker; must work from a typical home/VPS host and print the public URL
   players will use.
