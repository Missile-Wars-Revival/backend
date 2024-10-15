import { prisma } from "../server";
import { Request, Response } from "express";
import { verifyToken } from "../utils/jwt";

export function setupHealthApi(app: any) {
    //isAlive
    app.patch("/api/isAlive", async (req: Request, res: Response) => {
        const token = req.query.token;

        // Check if token is provided and is a valid string
        if (typeof token !== 'string' || !token.trim()) {
            return res.status(400).json({ message: "Token is required and must be a non-empty string." });
        }

        try {
            // Verify the token
            const claims = await verifyToken(token);

            if (typeof req.body.isAlive !== 'boolean') {
                return res.status(400).json({ message: "isAlive status must be provided and be a boolean." });
            }

            const updatedUser = await prisma.gameplayUser.update({
                where: {
                    username: claims.username
                },
                data: {
                    isAlive: req.body.isAlive
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
        } catch (error) {
            console.error("Error updating isAlive status:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    });

    app.post("/api/getisAlive", async (req: Request, res: Response) => {
        const { token } = req.body;

        const claims = await verifyToken(token);

        if (!claims) {
            return res.status(401).json({ message: "Invalid token" });
        }

        const user = await prisma.gameplayUser.findFirst({
            where: {
                username: claims.username
            },
        });

        if (user) {
            res.status(200).json({ isAlive: user.isAlive });
        } else {
            res.status(404).json({ message: "User not found" });
        }
    });

    //health
    app.post("/api/getHealth", async (req: Request, res: Response) => {
        const { token } = req.body;

        const claims = await verifyToken(token)

        if (!claims) {
            return res.status(401).json({ message: "Invalid token" });
        }

        const user = await prisma.gameplayUser.findFirst({
            where: {
                username: claims.username
            },
        });

        if (user) {
            res.status(200).json({ health: user.health });
        } else {
            res.status(404).json({ message: "User not found" });
        }
    });

    app.post("/api/addHealth", async (req: Request, res: Response) => {
        const { token, amount } = req.body;

        try {
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
        } catch (error) {
            res.status(500).json({ message: "Error verifying token" });
        }
    });

    app.post("/api/removeHealth", async (req: Request, res: Response) => {
        const { token, amount } = req.body;

        try {
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
        } catch (error) {
            res.status(500).json({ message: "Error updating health" });
        }
    });

    app.post("/api/setHealth", async (req: Request, res: Response) => {
        const { token, newHealth } = req.body;

        try {
            const claims = await verifyToken(token);

            const username = claims.username;

            const user = await prisma.gameplayUser.findUnique({
                where: { username: username },
            });

            if (!user) {
                res.status(404).json({ message: "User not found" });
                return
            }

            const clampedHealth = Math.max(0, Math.min(newHealth, 100));
            const newIsAlive = clampedHealth > 0;

            await prisma.gameplayUser.update({
                where: { username: username },
                data: {
                    health: clampedHealth,
                    isAlive: newIsAlive,
                },
            });

            res.status(200).json({ message: "Health set", health: clampedHealth, isAlive: newIsAlive });
        } catch (error) {
            res.status(500).json({ message: "Error setting health" });
        }
    });
}