import { prisma } from "../server";

// Tables whose primary key is @default(autoincrement()). Inserts that carry
// explicit ids (the import-script database migration, manual restores) do
// NOT advance the underlying Postgres sequence, so every later create() on
// these tables fails with P2002 on `id` until the sequence is resynced.
const SERIAL_ID_TABLES = [
  "Users",
  "GameplayUser",
  "InventoryItem",
  "Statistics",
  "PasswordResetCodes",
  "Landmine",
  "Loot",
  "Other",
  "Messages",
  "Missile",
  "RefreshTokens",
  "Sessions",
  "NotificationPreferences",
] as const;

export type SerialIdTable = (typeof SERIAL_ID_TABLES)[number];

// Points the table's id sequence just past MAX(id). Identifiers can't be
// parameterized; `table` is constrained to the hardcoded list above.
export async function resetIdSequence(table: SerialIdTable): Promise<void> {
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX("id") FROM "${table}"), 0) + 1, false)`
  );
}

// Run once at boot — idempotent and cheap, repairs any sequence left behind
// by an import so fresh registrations and inventory writes don't P2002.
export async function syncAutoIncrementSequences(): Promise<void> {
  for (const table of SERIAL_ID_TABLES) {
    try {
      await resetIdSequence(table);
    } catch (error) {
      console.error(`Failed to sync id sequence for ${table}:`, (error as Error).message);
    }
  }
  console.log("Database id sequences synced");
}
