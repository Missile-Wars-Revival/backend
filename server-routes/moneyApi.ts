import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { isDistributedMode, verifyToken, verifyVoucher } from "../util/auth";
import { ensureGameplayUserForToken } from "../util/provisionUser";
import { resolveItemCategory } from "./inventoryApi";
import { prisma } from "../server";

export function setupMoneyApi(app: any) {

  app.post("/api/addMoney", async (req: Request, res: Response) => {
    // Phase 9: minting coins from a client-chosen amount is the core payment
    // hole. In distributed mode coins arrive only through the
    // coordinator-verified purchase voucher (/api/redeemPurchase). Solo/local
    // hosts keep it — they own their own economy.
    if (isDistributedMode()) {
      return res.status(403).json({ message: "Direct coin grants are disabled on networked servers. Coins are delivered through a verified purchase voucher." });
    }
    const { token, amount } = req.body;

    try {
      const decoded = verifyToken(token);

      // Ensure decoded is an object and has the username property
      if (typeof decoded === 'object' && 'username' in decoded) {
        const username = decoded.username;

        const user = await ensureGameplayUserForToken(decoded);

        if (user) {
          // Perform the update if the user is found
          await prisma.gameplayUser.update({
            where: {
              username: username,
            },
            data: {
              money: user.money + amount, // Ensure correct arithmetic operation
            },
          });

          res.status(200).json({ message: "Money added" });
        } else {
          res.status(404).json({ message: "User not found" });
        }
      } else {
        res.status(401).json({ message: "Invalid token" });
      }
    } catch (error) {
      res.status(500).json({ message: "Error verifying token" });
    }
  });

  app.post("/api/removeMoney", async (req: Request, res: Response) => {
    const { token, amount } = req.body;

    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({ message: "Invalid token" });
    }

    const user = await ensureGameplayUserForToken(decoded);

    if (user) {
      await prisma.gameplayUser.update({
        where: {
          username: decoded.username,
        },
        data: {
          money: user.money - amount,
        },
      });

      res.status(200).json({ message: "Money removed" });
    } else {
      res.status(404).json({ message: "User not found" });
    }
  });

  app.get("/api/getMoney", async (req: Request, res: Response) => {
    const { token } = req.query;

    const decoded = verifyToken(token as string);

    if (!decoded) {
      return res.status(401).json({ message: "Invalid token" });
    }

    const user = await ensureGameplayUserForToken(decoded);

    if (user) {
      res.status(200).json({ money: user.money });
    } else {
      res.status(404).json({ message: "User not found" });
    }
  });
  app.post("/api/purchaseItem", async (req: Request, res: Response) => {
    const { token, items, money } = req.body;

    try {
      // Verify the token and ensure it's treated as an object
      const decoded = verifyToken(token);

      if (typeof decoded === 'string' || !decoded.username) {
        return res.status(401).json({ message: "Invalid token" });
      }

      // Retrieve the user, provisioning the player on this shard if needed
      const user = await ensureGameplayUserForToken(decoded);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (user.money < money) {
        return res.status(400).json({ message: "Insufficient funds" });
      }

      // Ensure items is an array and contains valid objects
      if (!Array.isArray(items) || !items.every(item => typeof item.product.name === 'string' && typeof item.quantity === 'number' && typeof item.product.category === 'string')) {
        return res.status(400).json({ message: "Invalid items provided" });
      }

      // Start a transaction
      await prisma.$transaction(async (prisma: { gameplayUser: { update: (arg0: { where: { username: any; }; data: { money: number; }; }) => any; }; inventoryItem: { findFirst: (arg0: { where: { name: any; userId: any; }; }) => any; update: (arg0: { where: { id: any; }; data: { quantity: any; }; }) => any; create: (arg0: { data: { name: any; quantity: any; category: any; userId: any; }; }) => any; }; }) => {
        // Update user's money
        await prisma.gameplayUser.update({
          where: { username: decoded.username },
          data: { money: user.money - money },
        });

        for (const item of items) {
          const { name, category } = item.product;

          // Check if the item already exists in the user's inventory
          const existingItem = await prisma.inventoryItem.findFirst({
            where: {
              name: name,
              userId: user.id,
            },
          });

          if (existingItem) {
            // If item exists, update the quantity
            await prisma.inventoryItem.update({
              where: { id: existingItem.id },
              data: { quantity: existingItem.quantity + item.quantity },
            });
          } else {
            // If item does not exist, create a new entry
            await prisma.inventoryItem.create({
              data: {
                name: name,
                quantity: item.quantity,
                category: category,
                userId: user.id,
              },
            });
          }
        }
      });

      // Successful purchase response
      res.status(200).json({ message: "Items purchased" });
    } catch (error) {
      console.error("Transaction failed: ", error);
      res.status(500).json({ message: "Transaction failed" });
    }
  });

  // Phase 9: server-authoritative daily reward. Replaces the old client flow
  // that called /api/addMoney with a client-chosen amount and tracked "claimed
  // today" only in the device's AsyncStorage — that was both a coin-mint hole
  // (any JWT, any amount) and trivially repeatable (clear local storage). The
  // amount and the once-per-day rule are decided here; the check is idempotent
  // per UTC day. Works in both solo and distributed mode.
  const DAILY_REWARD_AMOUNT = 1000;
  app.post("/api/claimDailyReward", async (req: Request, res: Response) => {
    const { token } = req.body;

    try {
      const decoded = verifyToken(token);
      if (typeof decoded === "string" || !decoded.username) {
        return res.status(401).json({ message: "Invalid token" });
      }

      const user = await ensureGameplayUserForToken(decoded);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const now = new Date();
      const lastClaim = user.lastDailyReward ? new Date(user.lastDailyReward) : null;
      const sameUtcDay =
        lastClaim !== null &&
        lastClaim.getUTCFullYear() === now.getUTCFullYear() &&
        lastClaim.getUTCMonth() === now.getUTCMonth() &&
        lastClaim.getUTCDate() === now.getUTCDate();

      if (sameUtcDay) {
        return res.status(200).json({ claimed: false, alreadyClaimed: true, message: "Daily reward already claimed today" });
      }

      // Guard the once-per-day rule against a double-tap race: only credit when
      // the row still shows the old (or null) claim date.
      const updated = await prisma.gameplayUser.updateMany({
        where: {
          username: decoded.username,
          OR: [{ lastDailyReward: null }, { lastDailyReward: user.lastDailyReward }],
        },
        data: {
          money: { increment: DAILY_REWARD_AMOUNT },
          lastDailyReward: now,
        },
      });

      if (updated.count === 0) {
        return res.status(200).json({ claimed: false, alreadyClaimed: true, message: "Daily reward already claimed today" });
      }

      res.status(200).json({ claimed: true, amount: DAILY_REWARD_AMOUNT, message: `Claimed ${DAILY_REWARD_AMOUNT} coins` });
    } catch (error) {
      console.error("Daily reward claim failed: ", error);
      res.status(500).json({ message: "Daily reward claim failed" });
    }
  });

  // Phase 9: redeem a coordinator-signed purchase voucher. The coordinator has
  // already verified the real store transaction and minted this RS256 voucher
  // (aud = this shard); the shard verifies it with the JWKS it caches, dedupes
  // on the transaction id (RedeemedPurchase), and credits the player. No new
  // shard secret is involved.
  app.post("/api/redeemPurchase", async (req: Request, res: Response) => {
    const { token, voucher } = req.body;

    try {
      const decoded = verifyToken(token);
      if (typeof decoded === "string" || !decoded.username) {
        return res.status(401).json({ message: "Invalid token" });
      }

      let grant;
      try {
        grant = verifyVoucher(voucher);
      } catch {
        return res.status(401).json({ message: "Invalid or expired purchase voucher" });
      }

      // The voucher is bound to a firebaseUID; the session token proves which
      // local account is asking. A voucher minted for one identity must not
      // credit another player's account on this shard.
      if (!decoded.firebaseUID || grant.sub !== decoded.firebaseUID) {
        return res.status(403).json({ message: "Voucher does not belong to this account" });
      }

      const user = await ensureGameplayUserForToken(decoded);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Resolve the item category before the transaction so a bad/unknown item
      // fails cleanly instead of half-committing the dedup row.
      let itemCategory: string | null = null;
      if (grant.grant.kind === "item") {
        if (!grant.grant.itemName) {
          return res.status(400).json({ message: "Voucher item grant is missing an item name" });
        }
        itemCategory = await resolveItemCategory(grant.grant.itemName);
        if (!itemCategory) {
          return res.status(400).json({ message: "Granted item is not available on this server" });
        }
      } else if (grant.grant.kind === "coins") {
        if (typeof grant.grant.amount !== "number" || grant.grant.amount <= 0) {
          return res.status(400).json({ message: "Voucher coin grant is invalid" });
        }
      } else {
        return res.status(400).json({ message: "Unknown grant kind" });
      }

      try {
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          // The unique txId is the replay guard — a P2002 here means this
          // voucher's purchase was already credited on this shard.
          await tx.redeemedPurchase.create({
            data: {
              txId: grant.txId,
              username: decoded.username,
              productId: grant.productId ?? "",
              grantKind: grant.grant.kind,
            },
          });

          if (grant.grant.kind === "coins") {
            await tx.gameplayUser.update({
              where: { username: decoded.username },
              data: { money: { increment: grant.grant.amount! } },
            });
          } else {
            const existingItem = await tx.inventoryItem.findFirst({
              where: { name: grant.grant.itemName, userId: user.id },
            });
            if (existingItem) {
              await tx.inventoryItem.update({
                where: { id: existingItem.id },
                data: { quantity: existingItem.quantity + 1 },
              });
            } else {
              await tx.inventoryItem.create({
                data: {
                  name: grant.grant.itemName!,
                  quantity: 1,
                  category: itemCategory!,
                  userId: user.id,
                },
              });
            }
          }
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          // Already credited — return success idempotently so a client retry
          // (or a re-minted voucher) resolves cleanly without double-granting.
          return res.status(200).json({ message: "Purchase already redeemed", alreadyRedeemed: true });
        }
        throw error;
      }

      const message =
        grant.grant.kind === "coins"
          ? `Added ${grant.grant.amount} coins to your account.`
          : `Added ${grant.grant.itemName} to your inventory.`;
      res.status(200).json({ message, alreadyRedeemed: false });
    } catch (error) {
      console.error("Redeem purchase failed: ", error);
      res.status(500).json({ message: "Redeem purchase failed" });
    }
  });

}