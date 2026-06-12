import { GameplayUser, Prisma } from "@prisma/client";
import { prisma } from "../server";
import { verifyToken } from "./auth";
import { ensureLocalUserForToken } from "./provisionUser";
import { haversine } from "../runners/entitymanagment";

// Shared building blocks for the entity placement endpoints (missiles,
// landmines, loot, shields). Each endpoint follows the same shape:
// authenticate -> validate type + inventory -> consume item, bump stats and
// create the entity in one transaction.

export type PlacementStatField =
  | "numMissilesPlaced"
  | "numLandminesPlaced"
  | "numLootPlaced";

type AuthResult =
  | { user: GameplayUser; error: null }
  | { user: null; error: { status: number; message: string } };

export async function authenticateUser(token: string): Promise<AuthResult> {
  let username: string;
  try {
    const decoded = verifyToken(token);
    username = decoded.username;
    await ensureLocalUserForToken(decoded);
  } catch {
    return { user: null, error: { status: 401, message: "Invalid token" } };
  }

  const user = await prisma.gameplayUser.findFirst({ where: { username } });
  if (!user) {
    return { user: null, error: { status: 404, message: "User not found" } };
  }
  return { user, error: null };
}

// Returns the inventory item only if the user actually has one to spend.
export async function findUsableInventoryItem(
  userId: number,
  where: { name?: string; category?: string }
) {
  const item = await prisma.inventoryItem.findFirst({
    where: { ...where, userId },
  });
  if (!item || item.quantity < 1) return null;
  return item;
}

// Statistics has no unique constraint on userId, so upsert isn't available —
// keep the find-then-create/update shape, but inside the caller's transaction.
export async function incrementStat(
  tx: Prisma.TransactionClient,
  userId: number,
  field: PlacementStatField
) {
  const existing = await tx.statistics.findFirst({ where: { userId } });
  if (existing) {
    await tx.statistics.update({
      where: { id: existing.id },
      data: { [field]: { increment: 1 } },
    });
  } else {
    await tx.statistics.create({ data: { userId, [field]: 1 } });
  }
}

// Travel time from distance/speed plus a random 5-10 minute delay so missiles
// are never instant at short range.
export function calculateTimeToImpact(
  fromLat: string,
  fromLong: string,
  toLat: string,
  toLong: string,
  speed: number
): Date {
  const distance = haversine(fromLat, fromLong, toLat, toLong);
  let timeToImpact = Math.round((distance / speed) * 1000);

  const minAdditionalTime = 5 * 60 * 1000;
  const maxAdditionalTime = 10 * 60 * 1000;
  timeToImpact +=
    Math.floor(Math.random() * (maxAdditionalTime - minAdditionalTime + 1)) +
    minAdditionalTime;

  return new Date(Date.now() + timeToImpact);
}
