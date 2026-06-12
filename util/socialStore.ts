import * as admin from "firebase-admin";
import { prisma } from "../server";

// Phase 4 of DISTRIBUTED_HOSTING_PLAN.md: Firebase central is the source of
// truth for the social graph. Friendships are stored as uid-keyed edges —
// /friends/<uid>/<friendUid> = true — which survive both shard migration and
// username changes (the long-standing rename problem with username arrays).
//
// Postgres `Users.friends` is kept up to date as a DERIVED READ-CACHE only:
// the gameplay loops (websocket visibility, damage processing, proximity)
// read it on their hot paths and live in the same droplet as the DB. The
// cache and its read sites are deleted together in Phase 5.
//
// Fallbacks, both deliberate:
//  - Shards without Firebase Admin (community/solo hosts have no
//    firebasecred.json) write Postgres only — their social graph is local
//    until Phase 5 moves social entirely off shards.
//  - Accounts without a firebaseUID (legacy pre-Firebase users) stay
//    Postgres-only; the Phase 5 migration script reconciles them.

interface SocialUser {
  username: string;
  firebaseUID: string | null;
}

function firebaseReady(): boolean {
  return admin.apps.length > 0;
}

function centralEligible(user: SocialUser, friend: SocialUser): boolean {
  return firebaseReady() && Boolean(user.firebaseUID) && Boolean(friend.firebaseUID);
}

// Adds a one-directional edge (this game's "friend request" semantics: a
// one-sided edge is a pending request, edges both ways make a friendship).
export async function addFriendEdge(user: SocialUser, friend: SocialUser): Promise<void> {
  if (centralEligible(user, friend)) {
    // Source-of-truth write. If this fails the whole operation fails — we
    // never let the cache get ahead of Firebase central.
    await admin.database().ref(`friends/${user.firebaseUID}/${friend.firebaseUID}`).set(true);
  }
  await prisma.users.update({
    where: { username: user.username },
    data: { friends: { push: friend.username } },
  });
}

export async function removeFriendEdge(
  user: SocialUser & { friends: string[] },
  friend: SocialUser
): Promise<void> {
  if (centralEligible(user, friend)) {
    await admin.database().ref(`friends/${user.firebaseUID}/${friend.firebaseUID}`).remove();
  }
  await prisma.users.update({
    where: { username: user.username },
    data: { friends: { set: user.friends.filter((f) => f !== friend.username) } },
  });
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
