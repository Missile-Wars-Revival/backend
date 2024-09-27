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

    app.get("/api/getWeaponTypes", async (req: Request, res: Response) => {
        try {
            // Fetch all missile types
            const missileTypes = await prisma.missileType.findMany();

            // Fetch all landmine types
            const landmineTypes = await prisma.landmineType.findMany();
            
            const otherTypes = await prisma.otherType.findMany();

            // Return both missile types and landmine types
            res.status(200).json({
                missileTypes,
                landmineTypes,
                otherTypes
            });
        } catch (error) {
            console.error("Failed to fetch weapon types: ", error);
            res.status(500).json({ message: "Failed to fetch weapon types" });
        }
    });

    app.post('/api/deduct-inventory', async (req: Request, res: Response) => {
        const { token, itemName, quantity } = req.body;

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

            if (typeof decoded === 'string' || !decoded.username) {
                return res.status(401).json({ message: "Invalid token" });
            }

            if (!itemName || !quantity) {
                return res.status(400).send('Missing required fields');
            }

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
                    data: { quantity: existingItem.quantity - quantity },
                });

                // Successful deduct item response
                return res.status(200).json({ message: "Item deducted successfully" });
            } else {
                return res.status(404).json({ message: "Item not found in inventory" });
            }
        } catch (error) {
            console.error("Deduct item failed: ", error);
            return res.status(500).json({ message: "Deduct item failed" });
        }
    });

    app.post('/api/add-inventory', async (req: Request, res: Response) => {
        const { token, itemName, quantity } = req.body;

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

            if (typeof decoded === 'string' || !decoded.username) {
                return res.status(401).json({ message: "Invalid token" });
            }

            if (!itemName || !quantity) {
                return res.status(400).send('Missing required fields');
            }

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
                    data: { quantity: existingItem.quantity + quantity },
                });
            } if (!existingItem) {
                // If item does not exist, create a new entry

                const itemCategory = await prisma.inventoryItem.findFirst({
                    where: { name: itemName },
                });

                if (!itemCategory) {
                    return res.status(404).json({ message: "Item category not found" });
                }

                await prisma.inventoryItem.create({
                    data: {
                        name: itemName,
                        quantity: quantity,
                        category: itemCategory.category,
                        userId: user.id,
                    },
                });
                
            } else {
                return res.status(404).json({ message: "Item not found in inventory" });
            }
        } catch (error) {
            console.error("Deduct item failed: ", error);
            return res.status(500).json({ message: "Deduct item failed" });
        }
    });

}