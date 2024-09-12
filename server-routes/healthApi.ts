import * as jwt from "jsonwebtoken";
import { prisma } from "../server";
import { Request, Response } from "express";
import { JwtPayload } from "jsonwebtoken";

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
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

            // Ensure the token contains a username
            if (typeof decoded === 'string' || !decoded.username) {
                return res.status(401).json({ message: "Invalid token" });
            }

            if (typeof req.body.isAlive !== 'boolean') {
                return res.status(400).json({ message: "isAlive status must be provided and be a boolean." });
            }

            const updatedUser = await prisma.gameplayUser.update({
                where: {
                    username: decoded.username
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
            res.status(200).json({ isAlive: user.isAlive });
        } else {
            res.status(404).json({ message: "User not found" });
        }
    });

    //health
    app.post("/api/getHealth", async (req: Request, res: Response) => {
        const { token } = req.body;

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
            res.status(200).json({ health: user.health });
        } else {
            res.status(404).json({ message: "User not found" });
        }
    });

    app.post("/api/addHealth", async (req: Request, res: Response) => {
        const { token, amount } = req.body;

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

            // Check if decoded is of type JwtPayload and has a username property
            if (typeof decoded === 'object' && 'username' in decoded) {
                const username = decoded.username;

                const user = await prisma.gameplayUser.findUnique({
                    where: {
                        username: username,
                    },
                });

                if (user) {
                    // Calculate new health without exceeding 100
                    const newHealth = Math.min(user.health + amount, 100);

                    await prisma.gameplayUser.update({
                        where: {
                            username: username,
                        },
                        data: {
                            health: newHealth,
                        },
                    });

                    res.status(200).json({ message: "Health added", health: newHealth });
                } else {
                    res.status(404).json({ message: "User not found" });
                }
            } else {
                // If decoded does not have a username property
                res.status(401).json({ message: "Invalid token" });
            }
        } catch (error) {
            res.status(500).json({ message: "Error verifying token" });
        }
    });

    app.post("/api/removeHealth", async (req: Request, res: Response) => {
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
                    health: user.health - amount,
                },
            });

            res.status(200).json({ message: "Health removed" });
        } else {
            res.status(404).json({ message: "User not found" });
        }
    });

    app.post("/api/setHealth", async (req: Request, res: Response) => {
        const { token, newHealth } = req.body;

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
                    health: newHealth,
                },
            });

            res.status(200).json({ message: "Health set" });
        } else {
            res.status(404).json({ message: "User not found" });
        }
    });
}