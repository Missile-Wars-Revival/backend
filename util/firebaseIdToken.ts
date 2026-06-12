import * as admin from "firebase-admin";
import axios from "axios";

// Phase 5: community shards never hold firebasecred.json, so they cannot run
// admin.auth().verifyIdToken locally. This helper verifies a client's Firebase
// ID token with whichever capability the shard has:
//   1. Local Firebase Admin SDK (owner deployment with firebasecred.json).
//   2. Coordinator POST /auth/verify-id-token (any registered shard).
// Throws when the token is invalid or when neither capability is configured.

export interface VerifiedIdToken {
  uid: string;
  email: string | null;
  name: string | null;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedIdToken> {
  if (admin.apps.length > 0) {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      name: (decoded.name as string | undefined) ?? null,
    };
  }

  const coordinatorUrl = process.env.COORDINATOR_URL?.replace(/\/$/, "");
  const shardApiKey = process.env.SHARD_API_KEY;
  if (coordinatorUrl && shardApiKey) {
    const { data } = await axios.post(
      `${coordinatorUrl}/auth/verify-id-token`,
      { idToken },
      { headers: { Authorization: `Bearer ${shardApiKey}` }, timeout: 10000 }
    );
    return {
      uid: data.data.uid,
      email: data.data.email ?? null,
      name: data.data.name ?? null,
    };
  }

  throw new Error(
    "Cannot verify Firebase ID tokens: no firebasecred.json and no COORDINATOR_URL/SHARD_API_KEY configured."
  );
}
