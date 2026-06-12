import { Request, Response } from "express";
import { verifyToken } from "../util/auth";
import { ensureGameplayUserForToken } from "../util/provisionUser";
import { prisma } from "../server";

export function setupMoneyApi(app: any) {

  app.post("/api/addMoney", async (req: Request, res: Response) => {
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

}