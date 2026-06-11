import { GameplayUser, Prisma } from "@prisma/client";
import { verifyToken } from "../util/auth";
import { prisma } from "../server";
import { Request, Response } from "express";
import { getRandomCoordinates } from "../runners/entitymanagment";
import { sendNotification } from "../runners/notificationhelper";
import {
  authenticateUser,
  findUsableInventoryItem,
  incrementStat,
  calculateTimeToImpact,
} from "../util/entityPlacementHelpers";

//Entering missiles and landmines into DB

// Shared by firemissile@loc and firemissile@player: validates the missile
// type and inventory, then consumes the item, bumps stats and creates the
// missile in one transaction.
async function fireMissileAt(
  user: GameplayUser,
  type: string,
  destLat: string,
  destLong: string
): Promise<{ status: number; message: string }> {
  const userLocation = await prisma.locations.findUnique({
    where: { username: user.username },
  });
  if (!userLocation) {
    return { status: 404, message: "User location not found" };
  }

  const missileType = await prisma.missileType.findUnique({
    where: { name: type },
  });
  if (!missileType) {
    return { status: 404, message: "Missile type not found" };
  }

  const existingItem = await findUsableInventoryItem(user.id, { name: type });
  if (!existingItem) {
    return { status: 404, message: "Missile not found in inventory" };
  }

  const timeToImpact = calculateTimeToImpact(
    userLocation.latitude,
    userLocation.longitude,
    destLat,
    destLong,
    missileType.speed
  );

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.inventoryItem.update({
      where: { id: existingItem.id },
      data: { quantity: { decrement: 1 } },
    });
    await incrementStat(tx, user.id, "numMissilesPlaced");
    await tx.missile.create({
      data: {
        destLat,
        destLong,
        radius: missileType.radius,
        damage: missileType.damage,
        type,
        sentBy: user.username,
        sentAt: new Date(),
        status: "Incoming",
        currentLat: userLocation.latitude,
        currentLong: userLocation.longitude,
        timeToImpact,
      },
    });
  });

  return { status: 200, message: "Missile fired successfully" };
}

export function setupEntityApi(app: any) {
  app.post("/api/firemissile@loc", async (req: Request, res: Response) => {
    const { token, destLat, destLong, type } = req.body;

    try {
      const { user, error } = await authenticateUser(token);
      if (error) {
        return res.status(error.status).json({ message: error.message });
      }

      const result = await fireMissileAt(user, type, destLat, destLong);
      res.status(result.status).json({ message: result.message });
    } catch (error) {
      console.error("Missile firing failed: ", error);
      res.status(500).json({ message: "Missile firing failed" });
    }
  });

  app.post("/api/firemissile@player", async (req: Request, res: Response) => {
    const { token, playerusername, type } = req.body;

    try {
      const { user, error } = await authenticateUser(token);
      if (error) {
        return res.status(error.status).json({ message: error.message });
      }

      const playerLocation = await prisma.locations.findUnique({
        where: { username: playerusername },
      });
      if (!playerLocation) {
        return res.status(404).json({ message: "Player location not found" });
      }

      const result = await fireMissileAt(
        user,
        type,
        playerLocation.latitude,
        playerLocation.longitude
      );

      if (result.status === 200) {
        await sendNotification(
          playerusername,
          "Incoming Missile!",
          `A missile has been fired at you by ${user.username}!`,
          user.username
        );
      }

      res.status(result.status).json({ message: result.message });
    } catch (error) {
      console.error("Missile firing failed: ", error);
      res.status(500).json({ message: "Missile firing failed" });
    }
  });

  app.post("/api/placelandmine", async (req: Request, res: Response) => {
    const { token, locLat, locLong, landminetype } = req.body;

    try {
      const { user, error } = await authenticateUser(token);
      if (error) {
        return res.status(error.status).json({ message: error.message });
      }

      const landmineType = await prisma.landmineType.findUnique({
        where: { name: landminetype },
      });
      if (!landmineType) {
        return res.status(404).json({ message: "Landmine type not found" });
      }

      const existingItem = await findUsableInventoryItem(user.id, {
        name: landminetype,
      });
      if (!existingItem) {
        return res
          .status(404)
          .json({ message: "Landmine not found in inventory" });
      }

      // landmine duration is in hours
      const durationInMilliseconds = landmineType.duration * 3600000;

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.inventoryItem.update({
          where: { id: existingItem.id },
          data: { quantity: { decrement: 1 } },
        });
        await incrementStat(tx, user.id, "numLandminesPlaced");
        await tx.landmine.create({
          data: {
            placedBy: user.username,
            locLat,
            locLong,
            type: landminetype,
            damage: landmineType.damage,
            Expires: new Date(Date.now() + durationInMilliseconds),
          },
        });
      });

      res.status(200).json({ message: "Landmine added to map successfully" });
    } catch (error) {
      console.error("Add item failed: ", error);
      res.status(500).json({ message: "Add landmine to map failed" });
    }
  });

  app.post("/api/steppedonlandmine", async (req: Request, res: Response) => {
    const { token, landmineid, landminedamage } = req.body;

    try {
      const { user, error } = await authenticateUser(token);
      if (error) {
        return res.status(error.status).json({ message: error.message });
      }

      await prisma.gameplayUser.update({
        where: { username: user.username },
        data: { health: user.health - landminedamage },
      });

      //Logic to alert user and reward that placed landmine here!!

      //delete landmine
      const result = await prisma.landmine.delete({
        where: {
          id: landmineid,
        },
      });

      res.status(200).json({
        message: `${result} Landmine removed successfully with id ${landmineid}`,
      });
    } catch (error) {
      console.error("Add item failed: ", error);
      res.status(500).json({ message: "Landmine removed failed" });
    }
  });

  //this will take a location, item name
  app.post("/api/placeloot", async (req: Request, res: Response) => {
    const { token, locLat, locLong } = req.body;

    try {
      const { user, error } = await authenticateUser(token);
      if (error) {
        return res.status(error.status).json({ message: error.message });
      }

      const existingItem = await findUsableInventoryItem(user.id, {
        category: "Loot Drops",
      });
      if (!existingItem) {
        return res
          .status(404)
          .json({ message: "Loot drop not found in inventory" });
      }

      // Randomly choose a rarity
      const rarities = ["Common", "Uncommon", "Rare"];
      const rarity = rarities[Math.floor(Math.random() * rarities.length)];

      // Generate random coordinates within 100m radius
      const randomCoordinates = getRandomCoordinates(
        parseFloat(locLat),
        parseFloat(locLong),
        100
      );
      const randomlocLat = randomCoordinates.latitude.toFixed(6);
      const randomlocLong = randomCoordinates.longitude.toFixed(6);

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.inventoryItem.update({
          where: { id: existingItem.id },
          data: { quantity: { decrement: 1 } },
        });
        await incrementStat(tx, user.id, "numLootPlaced");
        await tx.loot.create({
          data: {
            locLat: randomlocLat,
            locLong: randomlocLong,
            rarity,
            Expires: new Date(Date.now() + 86400000), // Expires in 24 hours
          },
        });
      });

      res.status(200).json({ message: "Loot placed successfully" });
    } catch (error) {
      console.error("Add item failed: ", error);
      res.status(500).json({ message: "Add loot to map failed" });
    }
  });

  app.post("/api/placeshield", async (req: Request, res: Response) => {
    const { token, type, loclat, loclong } = req.body;

    try {
      const { user, error } = await authenticateUser(token);
      if (error) {
        return res.status(error.status).json({ message: error.message });
      }

      if (!["Shield", "UltraShield"].includes(type)) {
        return res.status(400).json({ message: "Invalid shield type" });
      }

      const shieldType = await prisma.otherType.findUnique({
        where: { name: type },
      });
      if (!shieldType) {
        return res.status(400).json({ message: "Invalid shield type" });
      }

      const existingItem = await findUsableInventoryItem(user.id, {
        name: type,
        category: "Other",
      });
      if (!existingItem) {
        return res
          .status(400)
          .json({ message: "Shield not available in inventory" });
      }

      // shield duration is in minutes
      const durationInMilliseconds = shieldType.duration * 60 * 1000;

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.inventoryItem.update({
          where: { id: existingItem.id },
          data: { quantity: { decrement: 1 } },
        });
        await tx.other.create({
          data: {
            locLat: loclat,
            locLong: loclong,
            type,
            placedBy: user.username,
            radius: shieldType.radius,
            Expires: new Date(Date.now() + durationInMilliseconds),
          },
        });
      });

      res.status(200).json({ message: `${type} placed successfully` });
    } catch (error) {
      console.error("Shield placement failed:", error);
      res.status(500).json({ message: "Shield placement failed" });
    }
  });

  app.post("/api/lootpickup", async (req: Request, res: Response) => {
    const { token, lootid, amount } = req.body;
    try {
      const { user, error } = await authenticateUser(token);
      if (error) {
        return res.status(error.status).json({ message: error.message });
      }

      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.gameplayUser.update({
          where: { username: user.username },
          data: {
            money: user.money + amount,
            rankPoints: user.rankPoints + 200,
          },
        });

        const existingLootPickup = await tx.statistics.findFirst({
          where: { userId: user.id },
        });

        if (existingLootPickup) {
          await tx.statistics.update({
            where: { id: existingLootPickup.id },
            data: { numLootPickups: { increment: 1 } },
          });
        } else {
          await tx.statistics.create({
            data: { userId: user.id, numLootPickups: 1 },
          });
        }

        return tx.loot.delete({
          where: { id: parseInt(lootid) },
        });
      });

      res.status(200).json({
        message: "Transaction completed successfully",
        details: result,
      });
    } catch (error) {
      console.error("Transaction failed: ", error);
      res.status(500).json({ message: "Transaction failed" });
    }
  });

  app.post("/api/deathreward", async (req: Request, res: Response) => {
    const { token, itemType, type, sentby } = req.body;

    if (!token || !itemType || !type || !sentby) {
        return res.status(400).json({ success: false, message: "Missing required parameters" });
    }

    try {
        const decoded = verifyToken(token);
        if (typeof decoded === 'string' || !decoded.username) {
            return res.status(401).json({ success: false, message: "Invalid token" });
        }

        if (decoded.username === sentby) {
            return res.status(400).json({ success: false, message: "You cannot claim your own death rewards" });
        }

        const killedUsername = decoded.username;

        const sender = await prisma.gameplayUser.findUnique({
            where: { username: sentby },
        });

        if (!sender) {
            return res.status(404).json({ success: false, message: "Sender not found" });
        }

        let rewardAmount = 0;
        let rankPointsReward = 0;

        if (itemType === "landmine") {
            const landmineType = await prisma.landmineType.findUnique({
                where: { name: type },
            });
            if (landmineType) {
                rewardAmount = Math.round(landmineType.price * 1.5);
                rankPointsReward = 30; // Base rank points for landmine kill
            }
        } else if (itemType === "missile") {
            const missileType = await prisma.missileType.findUnique({
                where: { name: type },
            });
            if (missileType) {
                rewardAmount = Math.round(missileType.price * 1.5);
                rankPointsReward = 40; // Base rank points for missile kill
            }
        }

        if (rewardAmount === 0) {
            return res.status(400).json({ success: false, message: "Invalid item type or type" });
        }

        // Add bonus rank points based on item price, but cap it
        const bonusPoints = Math.min(Math.round(rewardAmount / 100), 20); // 1 additional point per 100 coins, max 20 bonus points
        rankPointsReward += bonusPoints;

        // Cap total rank points reward
        rankPointsReward = Math.min(rankPointsReward, 67); // Ensure it never exceeds 67 points

        // Update sender's money and rank points
        await prisma.gameplayUser.update({
            where: { id: sender.id },
            data: {
                money: { increment: rewardAmount },
                rankPoints: { increment: rankPointsReward },
            },
        });

        // Create a notification for the sender (killer)
        await prisma.notifications.create({
            data: {
                userId: sender.username,
                title: "Kill Reward",
                body: `You've been rewarded ${rewardAmount} coins and ${rankPointsReward} rank points for killing ${killedUsername} with your ${itemType}!`,
                sentby: "server",
            },
        });

        res.status(200).json({
            success: true,
            message: "Death reward processed successfully",
            reward: {
                coins: rewardAmount,
                rankPoints: rankPointsReward,
            },
        });

    } catch (error) {
        console.error("Death reward processing failed: ", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});
}
