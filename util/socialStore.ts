import * as admin from "firebase-admin";
import axios from "axios";

// Phase 6 social cutover: clients write friendship edges
// (/friends/<uid>/<friendUid>) to Firebase central directly under the
// security rules — the shard no longer writes the social graph at all. (The
// Phase 4 addFriendEdge/removeFriendEdge helpers lived here until the
// /api/addFriend and /api/removeFriend routes were removed.)
//
// What remains is the rename hook below, which only the owner deployment
// (with firebasecred.json) can run.

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

function friendUidsFromSnapshotValue(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([, edge]) => edge !== false && edge !== null)
    .map(([uid]) => uid);
}

async function getCentralFriendUsernames(firebaseUID: string): Promise<string[] | null> {
  const cached = friendCache.get(firebaseUID);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.usernames;
  }

  try {
    let usernames: string[] | null = null;

    if (firebaseReady()) {
      const snap = await admin.database().ref(`friends/${firebaseUID}`).get();
      const friendUids = snap.exists() ? friendUidsFromSnapshotValue(snap.val()) : [];
      const names = await Promise.all(
        friendUids.map(async (friendUid) => {
          const nameSnap = await admin.database().ref(`profiles/${friendUid}/username`).get();
          return nameSnap.exists() ? String(nameSnap.val()) : null;
        })
      );
      usernames = normalizeUsernames(names);
    } else {
      const base = coordinatorUrl();
      const shardApiKey = process.env.SHARD_API_KEY;
      if (base && shardApiKey) {
        const { data } = await axios.post(
          `${base}/relay/friends`,
          { firebaseUID },
          {
            headers: { Authorization: `Bearer ${shardApiKey}` },
            timeout: 10000,
          }
        );
        usernames = normalizeUsernames(data?.data?.friends ?? data?.data?.usernames ?? []);
      }
    }

    if (usernames) {
      friendCache.set(firebaseUID, { expiresAt: Date.now() + FRIEND_CACHE_TTL_MS, usernames });
      return usernames;
    }
  } catch (error) {
    console.error(`[socialStore] central friend lookup failed for ${firebaseUID}:`, (error as Error).message);
  }

  return null;
}

export async function getFriendUsernames(user: {
  username: string;
  firebaseUID?: string | null;
  friends?: string[] | null;
}): Promise<string[]> {
  if (user.firebaseUID) {
    const central = await getCentralFriendUsernames(user.firebaseUID);
    if (central) {
      return normalizeUsernames(central, user.username);
    }
  }
  return normalizeUsernames(user.friends ?? [], user.username);
}

// Keeps /profiles/<uid>/username in sync after a rename. The coordinator
// bootstraps the profile on every token mint, but tokens live 12h — without
// this, friends would see the stale name until the next login/refresh.
export async function syncProfileUsername(firebaseUID: string | null, newUsername: string): Promise<void> {
  if (!firebaseReady() || !firebaseUID) return;
  try {
    await admin.database().ref(`profiles/${firebaseUID}/username`).set(newUsername);
  } catch (error) {
    console.error(`[socialStore] profile username sync failed for ${firebaseUID}:`, (error as Error).message);
  }
}
