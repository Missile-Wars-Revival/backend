import * as admin from "firebase-admin";
import axios from "axios";

// Phase 6 social cutover: clients write friendship edges
// (/friends/<uid>/<friendUid>) to Firebase central directly under the
// security rules. Shards keep Users.friends only as a gameplay cache.

const FRIEND_CACHE_TTL_MS = 30_000;

const friendCache = new Map<string, { expiresAt: number; usernames: string[] }>();

function firebaseReady(): boolean {
  return admin.apps.length > 0;
}

function coordinatorUrl(): string | undefined {
  return process.env.COORDINATOR_URL?.replace(/\/$/, "");
}

function normalizeUsernames(values: unknown[], ownUsername?: string): string[] {
  return [...new Set(
    values
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && value.length <= 64 && value !== ownUsername)
  )];
}

function normalizeFriendRelayPayload(value: unknown): string[] {
  const rawEntries = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value as Record<string, unknown>)
      : [];

  return normalizeUsernames(rawEntries.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const username = record.username ?? record.friendUsername ?? record.name;
    return typeof username === "string" ? [username] : [];
  }));
}

function friendUidsFromSnapshotValue(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([, edge]) => edge !== false && edge !== null)
    .map(([uid]) => uid);
}

async function readCentralFriendUsernamesViaAdmin(firebaseUID: string): Promise<string[]> {
  const snap = await admin.database().ref(`friends/${firebaseUID}`).get();
  const friendUids = snap.exists() ? friendUidsFromSnapshotValue(snap.val()) : [];
  const names = await Promise.all(
    friendUids.map(async (friendUid) => {
      const nameSnap = await admin.database().ref(`profiles/${friendUid}/username`).get();
      return nameSnap.exists() ? String(nameSnap.val()) : null;
    })
  );
  return normalizeUsernames(names);
}

async function readCentralFriendUsernamesViaCoordinator(firebaseUID: string): Promise<string[] | null> {
  const base = coordinatorUrl();
  const shardApiKey = process.env.SHARD_API_KEY;
  if (!base || !shardApiKey) return null;

  try {
    const { data } = await axios.post(
      `${base}/relay/friends`,
      { firebaseUID },
      {
        headers: { Authorization: `Bearer ${shardApiKey}` },
        timeout: 10000,
      }
    );
    return normalizeFriendRelayPayload(data?.data?.friends ?? data?.data?.usernames ?? data?.friends ?? []);
  } catch (error) {
    const message = axios.isAxiosError(error)
      ? `${error.response?.status ?? ""} ${error.message}`.trim()
      : (error as Error).message;
    console.error(`[socialStore] central friends relay failed for ${firebaseUID}:`, message);
    return null;
  }
}

export async function getCentralFriendUsernames(firebaseUID: string | null | undefined): Promise<string[] | null> {
  if (!firebaseUID) return null;

  const cached = friendCache.get(firebaseUID);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.usernames;
  }

  try {
    const usernames = firebaseReady()
      ? await readCentralFriendUsernamesViaAdmin(firebaseUID)
      : await readCentralFriendUsernamesViaCoordinator(firebaseUID);

    if (usernames) {
      friendCache.set(firebaseUID, { expiresAt: Date.now() + FRIEND_CACHE_TTL_MS, usernames });
      return usernames;
    }
  } catch (error) {
    console.error(`[socialStore] central friends read failed for ${firebaseUID}:`, (error as Error).message);
  }

  return null;
}

export async function getFriendUsernames(user: {
  username: string;
  firebaseUID?: string | null;
  friends?: string[] | null;
}): Promise<string[]> {
  const central = await getCentralFriendUsernames(user.firebaseUID);
  if (central) {
    return normalizeUsernames(central, user.username);
  }
  return normalizeUsernames(user.friends ?? [], user.username);
}

// Keeps /profiles/<uid>/username in sync after a rename. The coordinator
// bootstraps the profile on every token mint, but tokens live 12h; without
// this, friends would see the stale name until the next login/refresh.
export async function syncProfileUsername(firebaseUID: string | null, newUsername: string): Promise<void> {
  if (!firebaseReady() || !firebaseUID) return;
  try {
    await admin.database().ref(`profiles/${firebaseUID}/username`).set(newUsername);
  } catch (error) {
    console.error(`[socialStore] profile username sync failed for ${firebaseUID}:`, (error as Error).message);
  }
}
