import { Request, Response } from "express";
import { prisma } from "../server";
import { verifyToken } from "../utils/jwt";
import { handleAsync } from "../utils/router";
import { z } from "zod";

export function setupInventoryApi(app: any) {
    const AddItemSchema = z.object({
        token: z.string(),
        itemName: z.string(),
        category: z.string(),
    })
    app.post("/api/addItem", handleAsync(async (req: Request, res: Response) => {
        const { token, itemName, category } = await AddItemSchema.parseAsync(req.body);

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
                data: {
                    quantity: {
                        increment: 1 
                    }
                },
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
    }));

    app.get("/api/getWeaponTypes", handleAsync(async (req: Request, res: Response) => {
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
    }));

    const DeductInventorySchema = z.object({
        token: z.string(),
        itemName: z.string(),
        quantity: z.number().int().min(1)
    })
    app.post('/api/deduct-inventory', handleAsync(async (req: Request, res: Response) => {
        const { token, itemName, quantity } = await DeductInventorySchema.parseAsync(req.body);

        const claims = await verifyToken(token);

        const user = await prisma.gameplayUser.findFirst({
            where: {
                username: claims.username,
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

        if (!existingItem || existingItem.quantity < quantity) {
            return res.status(404).json({ message: "Not enough item in inventory" });
        }
        
        // If item exists, update the quantity
        await prisma.inventoryItem.update({
            where: { id: existingItem.id },
            data: {
                quantity: {
                    decrement: quantity
                }
            },
        });

        // Successful deduct item response
        return res.status(200).json({ message: "Item deducted successfully" });
    }));

    const AddInventorySchema = z.object({
        token: z.string(),
        itemName: z.string(),
        quantity: z.number().int().min(1)
    })
    app.post("/api/add-inventory", handleAsync(async (req: Request, res: Response) => {
        const { token, itemName, quantity } = await AddInventorySchema.parseAsync(req.body);

        const claims = await verifyToken(token)

        const user = await prisma.gameplayUser.findFirst({
            where: {
                username: claims.username,
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
                data: {
                    quantity: {
                        increment: quantity
                    }
                },
            });
        } else {
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
        }

        res.status(200).json({ message: "Item added successfully" })
    }));

}