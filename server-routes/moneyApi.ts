import { Request, Response } from "express";
import * as jwt from "jsonwebtoken";
import { prisma } from "../server";
import { JwtPayload } from "jsonwebtoken";
import Stripe from "stripe";

export function setupMoneyApi(app: any) {

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2024-06-20'
  });

  app.post("/api/addMoney", async (req: Request, res: Response) => {
    const { token, amount } = req.body;

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

      // Ensure decoded is an object and has the username property
      if (typeof decoded === 'object' && 'username' in decoded) {
        const username = decoded.username;

        const user = await prisma.gameplayUser.findFirst({
          where: {
            username: username,
          },
        });

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

    const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

    if (!decoded) {
      return res.status(401).json({ message: "Invalid token" });
    }

    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: (decoded as JwtPayload).username as string,
      },
    });

    if (user) {
      await prisma.gameplayUser.update({
        where: {
          username: (decoded as JwtPayload).username as string,
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

    const decoded = jwt.verify(token as string, process.env.JWT_SECRET || "");

    if (!decoded) {
      return res.status(401).json({ message: "Invalid token" });
    }

    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: (decoded as JwtPayload).username as string,
      },
    });

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
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

      if (typeof decoded === 'string' || !decoded.username) {
        return res.status(401).json({ message: "Invalid token" });
      }

      // Retrieve the user from the database
      const user = await prisma.gameplayUser.findFirst({
        where: {
          username: decoded.username,
        },
      });

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

  app.post('/api/payment-intent', async (req: Request, res: Response) => {
    const { token, productId, price } = req.body;

    if (!token || typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ message: "Token is required and must be a non-empty string." });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as { username: string; };
      const username = decoded.username;
      if (!username) {
        return res.status(401).json({ message: "Invalid token: Username is missing." });
      }

      // Fetch user by username
      const user = await prisma.users.findUnique({
        where: { username },
        select: { email: true, stripeCustomerId: true }
      });

      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      let customerId = user.stripeCustomerId;
      if (!customerId) {
        // Create a new Stripe customer if not existing
        const newCustomer = await stripe.customers.create({
          email: user.email,
        });
        customerId = newCustomer.id;

        // Store new Stripe customer ID in your database
        await prisma.users.update({
          where: { username },
          data: { stripeCustomerId: customerId }
        });
      }

      // Create a payment intent with the Stripe customer ID
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(price * 100), // Convert price to cents
        currency: 'usd',
        customer: customerId,
        description: `Purchase of product ${productId}`,
        metadata: { productId }
      });

      res.json({
        status: 'pending',
        clientSecret: paymentIntent.client_secret,
      });

    } catch (error) {
      console.error('Error during payment initiation:', error);
      res.status(500).json({
        status: 'failed',
        message: "Server error during payment processing."
      });
    }
  });
}