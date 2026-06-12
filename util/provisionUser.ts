import { GameplayUser, Prisma, Users } from "@prisma/client";
import { prisma } from "../server";
import { resetIdSequence, SerialIdTable } from "./dbSequences";
import type { TokenPayload } from "./auth";

type LocalUser = Users & { GameplayUser: GameplayUser | null };

// New players start at the league-entry minimum (the hourly league runner
// unassigns anyone below 10 points) so a fresh account lands in a Bronze III
// league instead of an empty league screen.
const STARTING_RANK_POINTS = 10;

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// A P2002 from these creates is either a concurrent request winning the race
// (a real duplicate row now exists — fine for ensure-style callers) or a
// stale autoincrement sequence on a database imported with explicit ids. If
// no duplicate explains the conflict, resync the sequence and retry once.
async function createHealingSequence(
  table: SerialIdTable,
  create: () => Promise<unknown>,
  duplicateExists: () => Promise<boolean>
): Promise<void> {
  try {
    await create();
  } catch (error) {
    if (!isUniqueConstraint(error)) throw error;
    if (await duplicateExists()) throw error;
    console.log(`Stale id sequence on ${table} — resyncing and retrying create`);
    await resetIdSequence(table);
    await create();
  }
}

function findWithGameplay(username: string): Promise<LocalUser | null> {
  return prisma.users.findUnique({
    where: { username },
    include: { GameplayUser: true },
  });
}

// Creates whatever per-player gameplay rows are missing for an existing
// Users row: the GameplayUser and its Statistics record. Safe to call when
// some or all rows already exist.
export async function ensureGameplayRecords(username: string): Promise<GameplayUser | null> {
  let gameplayUser = await prisma.gameplayUser.findUnique({ where: { username } });

  if (!gameplayUser) {
    await createHealingSequence(
      "GameplayUser",
      () => prisma.gameplayUser.create({ data: { username, rankPoints: STARTING_RANK_POINTS } }),
      async () => !!(await prisma.gameplayUser.findUnique({ where: { username } }))
    ).catch((error) => {
      // A concurrent request creating the same row is success for us.
      if (!isUniqueConstraint(error)) throw error;
    });
    gameplayUser = await prisma.gameplayUser.findUnique({ where: { username } });
    if (!gameplayUser) return null;
  }

  const stats = await prisma.statistics.findFirst({
    where: { userId: gameplayUser.id },
    select: { id: true },
  });
  if (!stats) {
    // Statistics has no unique constraint, so P2002 here can only be a stale
    // id sequence — heal and retry.
    const userId = gameplayUser.id;
    await createHealingSequence(
      "Statistics",
      () => prisma.statistics.create({ data: { userId } }),
      async () => false
    );
  }

  return gameplayUser;
}

// Full player setup for registration flows: Users row plus all gameplay
// rows. A P2002 that is a genuine duplicate (username/email/firebaseUID
// already taken) is rethrown so callers can keep mapping it to a 409.
export async function createPlayer(data: {
  username: string;
  email?: string;
  password?: string | null;
  firebaseUID?: string | null;
}): Promise<void> {
  const createUser = () =>
    prisma.users.create({
      data: {
        username: data.username,
        email: data.email ?? "",
        password: data.password ?? undefined,
        firebaseUID: data.firebaseUID ?? undefined,
      },
    });

  await createHealingSequence("Users", createUser, async () => {
    const byUsername = await prisma.users.findUnique({ where: { username: data.username } });
    if (byUsername) return true;
    if (!data.firebaseUID) return false;
    return !!(await prisma.users.findUnique({ where: { firebaseUID: data.firebaseUID } }));
  });

  await ensureGameplayRecords(data.username);
}

export async function ensureLocalUserForToken(decoded: TokenPayload): Promise<LocalUser | null> {
  if (!decoded.username) return null;

  let user = await findWithGameplay(decoded.username);

  if (user) {
    if (!user.GameplayUser) {
      await ensureGameplayRecords(decoded.username);
      user = await findWithGameplay(decoded.username);
    }
    return user;
  }

  // Only coordinator/Firebase sessions can be provisioned automatically. A
  // legacy HS256 token for a missing row is genuinely stale or invalid.
  if (!decoded.firebaseUID) return null;

  const existingByUid = await prisma.users.findUnique({
    where: { firebaseUID: decoded.firebaseUID },
  });
  if (existingByUid && existingByUid.username !== decoded.username) {
    console.log(
      `Auth refused: firebaseUID ${decoded.firebaseUID} exists here as "${existingByUid.username}" but token says "${decoded.username}".`
    );
    return null;
  }

  try {
    await createPlayer({ username: decoded.username, email: "", firebaseUID: decoded.firebaseUID });
    console.log(`Provisioned Firebase user on this shard: ${decoded.username}`);
  } catch (error) {
    if (!isUniqueConstraint(error)) {
      console.log(`Failed to provision Firebase user ${decoded.username}:`, (error as Error).message);
      return null;
    }
    // A double connect/request can win the race in another handler. Re-read
    // below and continue if the rows now exist.
  }

  return findWithGameplay(decoded.username);
}

// Convenience for REST routes that only need the GameplayUser row: looks it
// up, auto-provisioning the player (Users + GameplayUser + Statistics) when
// the account hasn't touched this shard yet.
export async function ensureGameplayUserForToken(decoded: TokenPayload): Promise<GameplayUser | null> {
  const user = await ensureLocalUserForToken(decoded);
  return user?.GameplayUser ?? null;
}
