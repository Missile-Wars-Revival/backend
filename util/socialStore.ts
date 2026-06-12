import * as admin from "firebase-admin";
import axios from "axios";
import { prisma } from "../server";

// Phase 6 social cutover: clients write friendship edges
// (/friends/<uid>/<friendUid>) to Firebase central directly under the
// security rules — the shard no longer writes the social graph at all. (The
// Phase 4 addFriendEdge/removeFriendEdge helpers lived here until the
// /api/addFriend and /api/removeFriend routes were removed.)
//
// What remains is the rename hook below, which only the owner deployment
// (with firebasecred.json) can run.

function firebaseReady(): boolean {
  return admin.apps.length > 0;
}

const FRIEND_CACHE_TTL_MS = 30_000;
const friendUsernameCache = new Map<string, { expiresAt: number; usernames: string[] }>();

function normalizeFriendUsernames(value: unknown): string[] {
  const rawEntries = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value as Record<string, unknown>)
      : [];

  return [...new Set(rawEntries.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const username = record.username ?? record.friendUsername ?? record.name;
    return typeof username === "string" ? [username] : [];
  }))].filter((username) => username.length > 0);
}

async function readCentralFriendUsernamesViaAdmin(firebaseUID: string): Promise<string[]> {
  const friendsSnap = await admin.database().ref(`friends/${firebaseUID}`).get();
  if (!friendsSnap.exists()) return [];

  const friendUids = Object.keys(friendsSnap.val() ?? {});
  const usernames = await Promise.all(
    friendUids.map(async (friendUid) => {
      const profileSnap = await admin.database().ref(`profiles/${friendUid}/username`).get();
      const username = profileSnap.exists() ? profileSnap.val() : null;
      return typeof username === "string" && username.trim() ? username.trim() : null;
    })
  );

  return usernames.filter((username): username is string => !!username);
}

async function readCentralFriendUsernamesViaCoordinator(firebaseUID: string): Promise<string[] | null> {
  const coordinatorUrl = process.env.COORDINATOR_URL?.replace(/\/$/, "");
  const shardApiKey = process.env.SHARD_API_KEY;
  if (!coordinatorUrl || !shardApiKey) return null;

  try {
    const { data } = await axios.post(
      `${coordinatorUrl}/relay/friends`,
      { firebaseUID },
      { headers: { Authorization: `Bearer ${shardApiKey}` }, timeout: 10000 }
    );
    return normalizeFriendUsernames(data?.friends);
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

  const cached = friendUsernameCache.get(firebaseUID);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.usernames;
  }

  let usernames: string[] | null = null;
  try {
    usernames = firebaseReady()
      ? await readCentralFriendUsernamesViaAdmin(firebaseUID)
      : await readCentralFriendUsernamesViaCoordinator(firebaseUID);
  } catch (error) {
    console.error(`[socialStore] central friends read failed for ${firebaseUID}:`, (error as Error).message);
    usernames = null;
  }

  if (usernames) {
    friendUsernameCache.set(firebaseUID, {
      expiresAt: Date.now() + FRIEND_CACHE_TTL_MS,
      usernames,
    });
  }

  return usernames;
}

export async function syncLocalFriendsFromCentral(username: string, firebaseUID: string | null | undefined): Promise<string[] | null> {
  const centralFriends = await getCentralFriendUsernames(firebaseUID);
  if (!centralFriends) return null;

  await prisma.users.update({
    where: { username },
    data: { friends: { set: centralFriends.filter((friend) => friend !== username) } },
  });

  return centralFriends;
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
