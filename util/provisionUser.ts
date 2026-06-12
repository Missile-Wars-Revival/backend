import { Prisma, Users } from "@prisma/client";
import { prisma } from "../server";
import type { TokenPayload } from "./auth";

type LocalUser = Users & { GameplayUser: unknown | null };

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function ensureLocalUserForToken(decoded: TokenPayload): Promise<LocalUser | null> {
  if (!decoded.username) return null;

  let user = await prisma.users.findUnique({
    where: { username: decoded.username },
    include: { GameplayUser: true },
  });

  if (user) {
    if (!user.GameplayUser) {
      try {
        await prisma.gameplayUser.create({ data: { username: decoded.username } });
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
      }
      user = await prisma.users.findUnique({
        where: { username: decoded.username },
        include: { GameplayUser: true },
      });
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
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.users.create({
        data: { username: decoded.username, email: "", firebaseUID: decoded.firebaseUID },
      });
      await tx.gameplayUser.create({ data: { username: decoded.username } });
    });
    console.log(`Provisioned Firebase user on this shard: ${decoded.username}`);
  } catch (error) {
    if (!isUniqueConstraint(error)) {
      console.log(`Failed to provision Firebase user ${decoded.username}:`, (error as Error).message);
      return null;
    }
    // A double connect/request can win the race in another handler. Re-read
    // below and continue if the rows now exist.
  }

  return prisma.users.findUnique({
    where: { username: decoded.username },
    include: { GameplayUser: true },
  });
}
