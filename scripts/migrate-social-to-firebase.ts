// One-time Phase 5 migration: copy social data from this shard's Postgres to
// Firebase central. Owner-only — requires firebasecred.json in the repo root
// and DATABASE_URL pointing at the production database.
//
//   npm run migrate:social                # dry run (default)
//   npm run migrate:social -- --apply     # write to Firebase
//
// What it writes, per user with a firebaseUID (legacy accounts without one
// are reported and skipped — they migrate when they next log in via Firebase):
//   /profiles/<uid>            { username, updatedAt }
//   /friends/<uid>/<friendUid> true        (only when the friend has a uid)
//   /notificationPreferences/<uid> { ...prisma NotificationPreferences flags }
//
// (Push tokens were exported by the original Phase 5 run; the Postgres column
// was dropped in Phase 6 — clients now register tokens centrally themselves.)
//
// Idempotent: every write is an upsert keyed on stable uids; rerunning is safe.

import { PrismaClient } from "@prisma/client";
import * as admin from "firebase-admin";

const apply = process.argv.includes("--apply");
const prisma = new PrismaClient();

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const serviceAccount = require("../firebasecred.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL:
      process.env.FIREBASE_DATABASE_URL ||
      "https://missile-wars-432403-default-rtdb.firebaseio.com",
  });
  const db = admin.database();

  const users = await prisma.users.findMany({
    select: {
      username: true,
      firebaseUID: true,
      friends: true,
      notificationPreferences: true,
    },
  });

  const uidByUsername = new Map<string, string>();
  for (const u of users) {
    if (u.firebaseUID) uidByUsername.set(u.username, u.firebaseUID);
  }

  let profiles = 0;
  let edges = 0;
  let skippedUsers = 0;
  let skippedEdges = 0;
  let tokens = 0;
  let prefs = 0;

  // Batch everything into one multi-path update per user to keep RTDB traffic
  // sane on large databases.
  for (const user of users) {
    if (!user.firebaseUID) {
      skippedUsers++;
      console.log(`skip (no firebaseUID): ${user.username}`);
      continue;
    }
    const uid = user.firebaseUID;
    const update: Record<string, unknown> = {
      [`profiles/${uid}/username`]: user.username,
      [`profiles/${uid}/updatedAt`]: Date.now(),
    };
    profiles++;

    for (const friendUsername of user.friends) {
      const friendUid = uidByUsername.get(friendUsername);
      if (!friendUid) {
        skippedEdges++;
        console.log(`skip edge (friend has no firebaseUID): ${user.username} -> ${friendUsername}`);
        continue;
      }
      update[`friends/${uid}/${friendUid}`] = true;
      edges++;
    }

    if (user.notificationToken) {
      update[`notificationTokens/${uid}`] = user.notificationToken;
      tokens++;
    }

    if (user.notificationPreferences) {
      const { id: _id, userId: _userId, ...flags } = user.notificationPreferences;
      update[`notificationPreferences/${uid}`] = flags;
      prefs++;
    }

    if (apply) {
      await db.ref().update(update);
    }
  }

  console.log(
    `\n${apply ? "MIGRATED" : "DRY RUN (use --apply to write)"}: ` +
      `${profiles} profiles, ${edges} friend edges, ${tokens} push tokens, ${prefs} preference sets. ` +
      `Skipped: ${skippedUsers} users and ${skippedEdges} edges without firebaseUID.`
  );
}

main()
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit();
  });
