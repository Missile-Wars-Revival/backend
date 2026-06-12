import * as admin from "firebase-admin";

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
