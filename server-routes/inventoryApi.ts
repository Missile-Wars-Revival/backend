import { Request, Response } from "express";
import { isDistributedMode, verifyToken } from "../util/auth";
import { ensureGameplayUserForToken } from "../util/provisionUser";
import { prisma } from "../server";

// Resolves the inventory category for an item: another player's copy first
// (matches whatever convention is already live on this shard), then the
// weapon type tables so brand-new shards/items still work.
export async function resolveItemCategory(itemName: string): Promise<string | null> {
    const existing = await prisma.inventoryItem.findFirst({
        where: { name: itemName },
        select: { category: true },
    });
    if (existing) return existing.category;

    const [missile, landmine, other] = await Promise.all([
        prisma.missileType.findUnique({ where: { name: itemName } }),
        prisma.landmineType.findUnique({ where: { name: itemName } }),
        prisma.otherType.findUnique({ where: { name: itemName } }),
    ]);
    if (missile) return "Missiles";
    if (landmine) return "Landmines";
    if (other) return "Other";
    return null;
}

export function setupInventoryApi(app: any) {
    app.post("/api/addItem", async (req: Request, res: Response) => {
        // Phase 9: this client-callable grant is a forge-a-missile hole in
        // distributed mode (any JWT could mint inventory). Premium items now
        // arrive via the coordinator-verified purchase voucher
        // (/api/redeemPurchase). Kept solo/local-only, where the host owns
        // their own world anyway.
        if (isDistributedMode()) {
            return res.status(403).json({ message: "Direct item grants are disabled on networked servers. Premium items are delivered through a verified purchase voucher." });
        }
        const { token, itemName, category } = req.body;

        try {
            // Verify the token and ensure it's decoded as an object
            const decoded = verifyToken(token);

            if (typeof decoded === 'string' || !decoded.username) {
                return res.status(401).json({ message: "Invalid token" });
            }

            // Validate up front — passing undefined through to the Prisma
            // create produces an opaque "invalid invocation" 500.
            if (typeof itemName !== 'string' || !itemName.trim() || typeof category !== 'string' || !category.trim()) {
                return res.status(400).json({ message: "itemName and category are required" });
            }

            // Retrieve the user, provisioning the player on this shard if needed
            const user = await ensureGameplayUserForToken(decoded);

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
            const decoded = verifyToken(token);

            if (typeof decoded === 'string' || !decoded.username) {
                return res.status(401).json({ message: "Invalid token" });
            }

            if (!itemName || !quantity) {
                return res.status(400).send('Missing required fields');
            }

            const user = await ensureGameplayUserForToken(decoded);

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
            const decoded = verifyToken(token);

            if (typeof decoded === 'string' || !decoded.username) {
                return res.status(401).json({ message: "Invalid token" });
            }

            if (typeof itemName !== 'string' || !itemName.trim() || typeof quantity !== 'number' || quantity <= 0) {
                return res.status(400).send('Missing required fields');
            }

            const user = await ensureGameplayUserForToken(decoded);

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
                return res.status(200).json({ message: "Item added successfully" });
            }

            // If item does not exist, create a new entry
            const category = await resolveItemCategory(itemName);

            if (!category) {
                return res.status(404).json({ message: "Item category not found" });
            }

            await prisma.inventoryItem.create({
                data: {
                    name: itemName,
                    quantity: quantity,
                    category: category,
                    userId: user.id,
                },
            });

            return res.status(200).json({ message: "Item added successfully" });
        } catch (error) {
            console.error("Add item failed: ", error);
            return res.status(500).json({ message: "Add item failed" });
        }
    });

}