import { Request, Response } from "express";
import * as jwt from "jsonwebtoken";
import { prisma } from "../server";
import { JwtPayload } from "jsonwebtoken";

export function setupInventoryApi(app: any) {
    app.post("/api/addItem", async (req: Request, res: Response) => {
        const { token, itemName, category } = req.body;

        try {
            // Verify the token and ensure it's decoded as an object
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

            // Check if the item is already in the user's inventory
            const existingItem = await prisma.inventoryItem.findFirst({
                where: {
                    name: itemName,
                    userId: user.id,
                },
            });

            if (existingItem) {
                // If item exists, update the quantity
                await prisma.inventoryItem.update({
                    where: { id: existingItem.id },
                    data: { quantity: existingItem.quantity + 1 },
                });
            } else {
                // If item does not exist, create a new entry
                await prisma.inventoryItem.create({
                    data: {
                        name: itemName,
                        quantity: 1,
                        category: category,  // Category is directly taken from the request body
                        userId: user.id,
                    },
                });
            }

            // Successful add item response
            res.status(200).json({ message: "Item added successfully" });
        } catch (error) {
            console.error("Add item failed: ", error);
            res.status(500).json({ message: "Add item failed" });
        }
    });

    app.get("/api/getInventory", async (req: Request, res: Response) => {
        const token = req.query.token;

        if (typeof token !== 'string') {
            return res.status(400).json({ message: "Token is required" });
        }

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

            // Fetch the user's inventory
            const inventory = await prisma.inventoryItem.findMany({
                where: {
                    userId: user.id,
                },
                select: {
                    name: true,
                    quantity: true,
                    category: true,
                },
            });

            // Return the inventory
            res.status(200).json(inventory);
        } catch (error) {
            console.error("Failed to fetch inventory: ", error);
            res.status(500).json({ message: "Failed to fetch inventory" });
        }
    });
}