import { prisma } from "../server";
import { Request, Response } from "express";
import { verifyToken } from "../utils/jwt";
import { handleAsync } from "../utils/router";
import { z } from "zod";

export function setupHealthApi(app: any) {
    //isAlive
    const IsAliveQuerySchema = z.object({
        token: z.string()
    })
    const IsAliveBodySchema = z.object({
        isAlive: z.boolean()
    })
    app.patch("/api/isAlive", handleAsync(async (req: Request, res: Response) => {
        const { token } = await IsAliveQuerySchema.parseAsync(req.query);
        const { isAlive } = await IsAliveBodySchema.parseAsync(req.body)

        // Verify the token
        const claims = await verifyToken(token);

        const updatedUser = await prisma.gameplayUser.update({
            where: {
                username: claims.username
            },
            data: {
                isAlive: isAlive
            }
        });

        // If no user is found or updated, send a 404 error
        if (!updatedUser) {
            return res.status(404).json({ message: "User not found" });
        }

        // Return the updated user info
        res.status(200).json({
            message: "isAlive status updated successfully",
            user: {
                username: updatedUser.username,
                isAlive: updatedUser.isAlive
            }
        });
    }));

    const GetIsAliveSchema = z.object({
        token: z.string()
    })
    app.post("/api/getisAlive", handleAsync(async (req: Request, res: Response) => {
        const { token } = await GetIsAliveSchema.parseAsync(req.body);

        const claims = await verifyToken(token);

        if (!claims) {
            return res.status(401).json({ message: "Invalid token" });
        }

        const user = await prisma.gameplayUser.findFirst({
            where: {
                username: claims.username
            },
        });

        if (!user) {
            res.status(404).json({ message: "User not found" });
            return
        }

        res.status(200).json({ isAlive: user.isAlive });
    }));

    //health
    const GetHealthSchema = z.object({
        token: z.string()
    })
    app.post("/api/getHealth", async (req: Request, res: Response) => {
        const { token } = await GetHealthSchema.parseAsync(req.body);

        const claims = await verifyToken(token)

        if (!claims) {
            return res.status(401).json({ message: "Invalid token" });
        }

        const user = await prisma.gameplayUser.findFirst({
            where: {
                username: claims.username
            },
        });

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        
        res.status(200).json({ health: user.health });
    });

    const AddHealthSchema = z.object({
        token: z.string(),
        amount: z.number().int().positive().min(0).max(100)
    })
    app.post("/api/addHealth", handleAsync(async (req: Request, res: Response) => {
        const { token, amount } = await AddHealthSchema.parseAsync(req.body);

        const claims = await verifyToken(token)

        const user = await prisma.gameplayUser.findUnique({
            where: {
                username: claims.username,
            },
        });

        if (!user) {
            res.status(404).json({ message: "User not found" });
            return
        }

        // Calculate new health without exceeding 100
        const newHealth = Math.min(user.health + amount, 100);

        await prisma.gameplayUser.update({
            where: {
                username: claims.username,
            },
            data: {
                health: newHealth,
            },
        });

        res.status(200).json({ message: "Health added", health: newHealth });
    }));

    const RemoveHealthSchema = z.object({
        token: z.string(),
        amount: z.number().int().positive().min(0).max(100)
    })
    app.post("/api/removeHealth", handleAsync(async (req: Request, res: Response) => {
        const { token, amount } = await RemoveHealthSchema.parseAsync(req.body);

        const claims = await verifyToken(token)

        const user = await prisma.gameplayUser.findUnique({
            where: { username: claims.username },
        });

        if (!user) {
            res.status(404).json({ message: "User not found" });
            return
        }

        const newHealth = Math.max(user.health - amount, 0);
        const newIsAlive = newHealth > 0;

        await prisma.gameplayUser.update({
            where: { username: claims.username },
            data: {
                health: newHealth,
                isAlive: newIsAlive,
            },
        });

        res.status(200).json({ message: "Health updated", health: newHealth, isAlive: newIsAlive });
    }));

    const SetHealthSchema = z.object({
        token: z.string(),
        newHealth: z.number().int().positive().min(0).max(100)
    })
    app.post("/api/setHealth", handleAsync(async (req: Request, res: Response) => {
        const { token, newHealth } = await SetHealthSchema.parseAsync(req.body);

        const claims = await verifyToken(token);

        const username = claims.username;

        const user = await prisma.gameplayUser.findUnique({
            where: { username: username },
        });

        if (!user) {
            res.status(404).json({ message: "User not found" });
            return
        }

        const newIsAlive = newHealth > 0;

        await prisma.gameplayUser.update({
            where: { username: username },
            data: {
                health: newHealth,
                isAlive: newIsAlive,
            },
        });

        res.status(200).json({ message: "Health set", health: newHealth, isAlive: newIsAlive });
    }));
}