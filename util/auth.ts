import * as jwt from "jsonwebtoken";
import { createPublicKey } from "crypto";
import axios from "axios";

// Phase 3 of DISTRIBUTED_HOSTING_PLAN.md: the shard no longer signs session
// tokens — the coordinator does (RS256), and this module verifies them against
// the coordinator's public JWKS. Two modes, decided by environment:
//
//   Distributed (COORDINATOR_URL + SHARD_API_KEY set): issueToken() asks the
//   coordinator to mint; verifyToken() checks RS256 signature via cached JWKS
//   and, when SHARD_ID is set, that the token's audience is this shard.
//
//   Solo/local (no COORDINATOR_URL): legacy HS256 with JWT_SECRET, exactly the
//   old behavior, so self-hosted shards work with zero extra infrastructure.
//
// Legacy HS256 tokens also stay *verifiable* in distributed mode while
// JWT_SECRET remains set, so existing 30-day sessions survive the migration;
// drop JWT_SECRET after a month to retire them.
//
// verifyToken keeps its synchronous signature — every protected endpoint
// inlines `verifyToken(token)` in a try/catch and none of them change.

export const TOKEN_TTL = "30d";

const JWKS_REFRESH_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

let cachedSecret: string | undefined;

export function getJwtSecret(): string {
    if (!cachedSecret) {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
            throw new Error(
                "JWT_SECRET is not set. Refusing to sign or verify tokens with an empty secret — set JWT_SECRET in the environment (.env locally, eb setenv on Elastic Beanstalk)."
            );
        }
        cachedSecret = secret;
    }
    return cachedSecret;
}

export interface TokenPayload extends jwt.JwtPayload {
    username: string;
    // Stable identity from the coordinator (`sub`). Absent on legacy HS256
    // tokens and on pre-Firebase accounts (whose sub is "user:<username>").
    firebaseUID?: string;
    // Firebase-derived staff/debug flag, stamped by the coordinator (Staff or
    // Debug identity badge). Only ever present on coordinator-minted RS256
    // tokens; never on legacy/solo HS256 tokens (which default-deny).
    staff?: boolean;
}

function coordinatorUrl(): string | undefined {
    return process.env.COORDINATOR_URL?.replace(/\/$/, "");
}

function distributedMode(): boolean {
    return Boolean(coordinatorUrl() && process.env.SHARD_API_KEY);
}

// Exposed so routes that must not exist in distributed mode (the old
// client-callable coin/item grants, replaced by the coordinator-verified
// purchase voucher flow) can refuse there while staying available for
// solo/local hosting and legacy app builds.
export function isDistributedMode(): boolean {
    return distributedMode();
}

// ------------------------------------------------------------- JWKS cache

// kid -> PEM public key. Kept as PEM so the hot path stays jwt.verify (sync).
const publicKeys = new Map<string, string>();
let jwksFetchPromise: Promise<void> | null = null;

async function fetchJwks(): Promise<void> {
    const base = coordinatorUrl();
    if (!base) return;
    const { data } = await axios.get(`${base}/.well-known/jwks.json`, { timeout: 10000 });
    const keys: Array<Record<string, unknown>> = data?.keys ?? [];
    for (const k of keys) {
        const kid = typeof k.kid === "string" ? k.kid : "default";
        const pem = createPublicKey({ key: k as never, format: "jwk" })
            .export({ type: "spki", format: "pem" })
            .toString();
        publicKeys.set(kid, pem);
    }
    if (publicKeys.size === 0) {
        throw new Error("Coordinator JWKS contained no keys");
    }
}

// Deduplicates concurrent fetches (e.g. a burst of requests with an unknown
// kid after the coordinator rotates its key).
function refreshJwks(): Promise<void> {
    if (!jwksFetchPromise) {
        jwksFetchPromise = fetchJwks()
            .catch((error) => {
                console.error("[auth] JWKS fetch failed:", (error as Error).message);
                throw error;
            })
            .finally(() => {
                jwksFetchPromise = null;
            });
    }
    return jwksFetchPromise;
}

// Called once at boot from server.ts. Throws synchronously on misconfiguration
// (neither coordinator nor JWT_SECRET); the initial JWKS fetch runs in the
// background with retries so boot isn't blocked on coordinator availability —
// verifyToken simply rejects RS256 tokens until the keys arrive.
export function initAuth(): void {
    if (!distributedMode() && !process.env.JWT_SECRET) {
        throw new Error(
            "No token verification configured. Set COORDINATOR_URL + SHARD_API_KEY (distributed) or JWT_SECRET (solo/local hosting)."
        );
    }

    if (distributedMode()) {
        const retry = (attempt: number) =>
            refreshJwks().catch(() => {
                const delay = Math.min(60000, 2 ** attempt * 1000);
                setTimeout(() => retry(attempt + 1), delay).unref();
            });
        retry(0);
        setInterval(() => {
            refreshJwks().catch(() => {});
        }, JWKS_REFRESH_INTERVAL).unref();
    }
}

// ------------------------------------------------------------ issue/verify

// Mints a session token. In distributed mode the coordinator signs (RS256,
// aud = this shard, sub = firebaseUID); solo mode keeps the legacy local
// HS256 token. This replaced the old synchronous signToken(username).
export async function issueToken(username: string, firebaseUID?: string | null): Promise<string> {
    if (distributedMode()) {
        const { data } = await axios.post(
            `${coordinatorUrl()}/auth/shard-token`,
            { username, firebaseUID: firebaseUID || undefined },
            {
                headers: { Authorization: `Bearer ${process.env.SHARD_API_KEY}` },
                timeout: 10000,
            }
        );
        return data.data.token;
    }
    return jwt.sign({ username }, getJwtSecret(), { expiresIn: TOKEN_TTL });
}

// Throws (JsonWebTokenError / TokenExpiredError) on bad, expired, or
// malformed tokens — callers keep the existing verify-inside-try/catch shape.
export function verifyToken(token: string): TokenPayload {
    const header = decodeHeader(token);

    if (header.alg === "RS256") {
        const kid = header.kid ?? "default";
        const pem = publicKeys.get(kid);
        if (!pem) {
            // Unknown kid: likely a key rotation (or boot-time fetch still in
            // flight). Kick a refresh for the *next* request and fail this one.
            refreshJwks().catch(() => {});
            throw new jwt.JsonWebTokenError("Verification key not available for this token");
        }
        const decoded = jwt.verify(token, pem, {
            algorithms: ["RS256"],
            // Without SHARD_ID we can't know our own audience, so any token
            // from this coordinator is accepted. Set SHARD_ID to prevent
            // tokens minted for other shards from working here.
            audience: process.env.SHARD_ID || undefined,
        });
        if (typeof decoded === "string" || !decoded.username) {
            throw new jwt.JsonWebTokenError("Token payload missing username");
        }
        const payload = decoded as TokenPayload;
        if (payload.sub && !payload.sub.startsWith("user:")) {
            payload.firebaseUID = payload.sub;
        }
        return payload;
    }

    // Legacy HS256 path: same maxAge bound as before so no-exp tokens age out
    // from iat. Disappears entirely once JWT_SECRET is dropped from the env.
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"], maxAge: TOKEN_TTL });
    if (typeof decoded === "string" || !decoded.username) {
        throw new jwt.JsonWebTokenError("Token payload missing username");
    }
    return decoded as TokenPayload;
}

// Phase 9: a purchase grant voucher minted by the coordinator (RS256, same
// JWKS as session tokens). Separate from verifyToken because a voucher carries
// no username, must be RS256 (never the legacy HS256 path), and is identified
// by its scope. `sub` is the buyer's firebaseUID; callers cross-check it
// against the session token before crediting.
export interface VoucherGrant {
    kind: "coins" | "item";
    amount?: number;
    itemName?: string;
}

export interface VoucherPayload extends jwt.JwtPayload {
    scope: string;
    txId: string;
    productId: string;
    grant: VoucherGrant;
}

export function verifyVoucher(token: string): VoucherPayload {
    const header = decodeHeader(token);
    if (header.alg !== "RS256") {
        throw new jwt.JsonWebTokenError("Purchase vouchers must be coordinator-signed (RS256)");
    }
    const kid = header.kid ?? "default";
    const pem = publicKeys.get(kid);
    if (!pem) {
        refreshJwks().catch(() => {});
        throw new jwt.JsonWebTokenError("Verification key not available for this voucher");
    }
    const decoded = jwt.verify(token, pem, {
        algorithms: ["RS256"],
        audience: process.env.SHARD_ID || undefined,
    });
    if (typeof decoded === "string" || decoded.scope !== "purchase:grant") {
        throw new jwt.JsonWebTokenError("Not a purchase voucher");
    }
    const payload = decoded as VoucherPayload;
    if (!payload.sub || !payload.txId || !payload.grant || typeof payload.grant !== "object") {
        throw new jwt.JsonWebTokenError("Voucher missing required claims");
    }
    return payload;
}

function decodeHeader(token: string): { alg: string; kid?: string } {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === "string" || !decoded.header?.alg) {
        throw new jwt.JsonWebTokenError("Malformed token");
    }
    return decoded.header as { alg: string; kid?: string };
}
