import { Request, Response } from "express";
import { prisma } from "../server";
import Stripe from "stripe";
import { verifyToken } from "../utils/jwt";
import { handleAsync } from "../utils/router";
import { z } from "zod";

export function setupMoneyApi(app: any) {

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2024-06-20'
  });

  const AddMoneySchema = z.object({
    token: z.string(),
    amount: z.number().int().min(1),
  })
  app.post("/api/addMoney", handleAsync(async (req: Request, res: Response) => {
    const { token, amount } = await AddMoneySchema.parseAsync(req.body);

    const claims = await verifyToken(token);

    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: claims.username,
      },
    });

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return
    }

    // Perform the update if the user is found
    await prisma.gameplayUser.update({
      where: {
        username: claims.username,
      },
      data: {
        money: {
          increment: amount
        }, // Ensure correct arithmetic operation
      },
    });

    res.status(200).json({ message: "Money added" });
  }));

  const RemoveMoneySchema = z.object({
    token: z.string(),
    amount: z.number().int().min(1)
  })
  app.post("/api/removeMoney", handleAsync(async (req: Request, res: Response) => {
    const { token, amount } = await RemoveMoneySchema.parseAsync(req.body);

    const claims = await verifyToken(token);

    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: claims.username
      },
    });

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return
    }

    await prisma.gameplayUser.update({
      where: {
        username: claims.username
      },
      data: {
        money: {
          decrement: amount
        },
      },
    });

    res.status(200).json({ message: "Money removed" });
  }));

  const GetMoneySchema = z.object({
    token: z.string()
  })
  app.get("/api/getMoney", handleAsync(async (req: Request, res: Response) => {
    const { token } = await GetMoneySchema.parseAsync(req.body);

    const claims = await verifyToken(token);

    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: claims.username
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({ money: user.money });
  }));

  const PurchaseItemSchema = z.object({
    token: z.string(),
    items: z.array(
      z.object({
        product: z.object({
          name: z.string(),
          category: z.string(),
        }),
        quantity: z.number().int().min(1)
      })
    ),
    money: z.number().int().min(1)
  })
  app.post("/api/purchaseItem", handleAsync(async (req: Request, res: Response) => {
    const { token, items, money } = await PurchaseItemSchema.parseAsync(req.body);

    // Verify the token and ensure it's treated as an object
    const claims = await verifyToken(token);

    // Retrieve the user from the database
    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: claims.username,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.money < money) {
      return res.status(400).json({ message: "Insufficient funds" });
    }

    // Start a transaction
    await prisma.$transaction(async (prisma) => {
      // Update user's money
      await prisma.gameplayUser.update({
        where: { username: claims.username },
        data: {
          money: {
            decrement: money
          }
        },
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
            data: {
              quantity: {
                increment: item.quantity
              }
            },
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
  }));

  const PaymentIntentSchema = z.object({
    token: z.string(),
    productId: z.number().int().positive(),
    price: z.number()
  })
  app.post('/api/payment-intent', handleAsync(async (req: Request, res: Response) => {
    const { token, productId, price } = await PaymentIntentSchema.parseAsync(req.body);

    const claims = await verifyToken(token);

    // Fetch user by username
    const user = await prisma.users.findUnique({
      where: { username: claims.username },
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
        where: { username: claims.username },
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
  }));
}