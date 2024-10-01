import * as jwt from "jsonwebtoken";
import { prisma } from "../server";
import * as argon2 from "argon2";
import nodemailer from 'nodemailer';
import { Login, LoginSchema, Register, RegisterSchema } from "../interfaces/api";
import { NextFunction, Request, Response } from "express";
import { z, ZodError } from "zod";

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

export const validateSchema =
  (schema: z.ZodSchema) =>
    (req: Request, res: Response, next: NextFunction) => {
      try {
        schema.parse(req.body);
        next();
      } catch (error) {
        if (error instanceof ZodError) {
          return res.status(400).json(error.errors);
        }
        next(error); // Pass the error to the next error handler
      }
    };

export async function storeResetCode(userId: number, code: string, expiry: Date) {
    await prisma.passwordResetCodes.create({
        data: {
            userId,
            code,
            expiry,
        },
    });
}

export async function getResetCodeInfo(userId: number, code: string) {
    return await prisma.passwordResetCodes.findFirst({
        where: {
            userId,
            code,
        },
    });
}

export async function deleteResetCode(userId: number) {
    await prisma.passwordResetCodes.deleteMany({
        where: {
            userId,
        },
    });
}

export function generateRandomCode(length: number): string {
    return Math.random().toString().slice(2, 2 + length);
}

export function setupAuthRoutes(app: any) {
    app.post("/api/login", validateSchema(LoginSchema), async (req: Request, res: Response) => {
        const login: Login = req.body;

        const user = await prisma.users.findFirst({
            where: {
                username: login.username,
            },
        });

        if (user && (await argon2.verify(user.password, login.password))) {
            const token = jwt.sign(
                { username: user.username, password: user.password },
                process.env.JWT_SECRET || ""
            );

            await prisma.users.update({
                where: {
                    username: login.username,
                },
                data: {
                    notificationToken: login.notificationToken,
                },
            });

            res.status(200).json({ message: "Login successful", token });
        } else {
            res.status(401).json({ message: "Invalid username or password" });
        }
    });

    app.post("/api/register", validateSchema(RegisterSchema), async (req: Request, res: Response) => {
        const register: Register = req.body;

        try {
            const existingUser = await prisma.users.findFirst({
                where: {
                    username: register.username,
                },
            });

            if (existingUser) {
                return res.status(409).json({ message: "User already exists" });
            }

            if (register.password.length < 8) {
                return res
                    .status(400)
                    .json({ message: "Password must be at least 8 characters long" });
            }

            if (register.username.length < 3) {
                return res
                    .status(400)
                    .json({ message: "Username must be at least 3 characters long" });
            }

            if (!register.username.match(/^[a-zA-Z0-9]+$/)) {
                return res
                    .status(400)
                    .json({ message: "Username must only contain letters and numbers" });
            }

            if (
                !register.password.match(
                    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/
                )
            ) {
                return res.status(400).json({
                    message:
                        "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&#)",
                });
            }

            if (!register.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
                return res.status(400).json({ message: "Invalid email address" });
            }

            if (
                (existingUser as unknown as { email: string })?.email === register.email
            ) {
                return res.status(400).json({ message: "Email already exists" });
            }

            const hashedPassword = await argon2.hash(register.password);

            await prisma.users.create({
                data: {
                    username: register.username,
                    password: hashedPassword,
                    email: register.email,
                    notificationToken: register.notificationToken,
                },
            });

            await prisma.gameplayUser.create({
                data: {
                    username: register.username,
                    createdAt: new Date().toISOString(),
                },
            });

            const token = jwt.sign(
                { username: register.username, password: register.password },
                process.env.JWT_SECRET || ""
            );

            res.status(200).json({ message: "User created", token });
        } catch (error) {
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002' &&
                'meta' in error && typeof error.meta === 'object' && error.meta !== null && 'target' in error.meta) {
                return res.status(409).json({ message: "Username already exists" });
            }
            console.error("Registration error:", error);
            res.status(500).json({ message: "An error occurred during registration" });
        }
    });

    app.post("/api/requestPasswordReset", async (req: Request, res: Response) => {
        const { email } = req.body;

        try {
            const user = await prisma.users.findFirst({ where: { email } });
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            const resetCode = generateRandomCode(6); // Generate a 6-digit code
            const resetCodeExpiry = new Date(Date.now() + 3600000); // Code valid for 1 hour

            await storeResetCode(user.id, resetCode, resetCodeExpiry);

            await transporter.sendMail({
                from: process.env.EMAIL_FROM,
                to: user.email,
                subject: "Password Reset Code",
                text: `Your password reset code is: ${resetCode}. This code will expire in 1 hour.`,
                html: `<p>Your password reset code is: <strong>${resetCode}</strong></p><p>This code will expire in 1 hour.</p>`,
            });

            res.status(200).json({ message: "Password reset code sent to email" });
        } catch (error) {
            console.error("Password reset request failed:", error);
            res.status(500).json({ message: "Failed to process password reset request" });
        }
    });
    
    app.post("/api/resetPassword", async (req: Request, res: Response) => {
        const { email, code, newPassword } = req.body;

        try {
            const user = await prisma.users.findFirst({ where: { email } });
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            const resetInfo = await getResetCodeInfo(user.id, code);
            if (!resetInfo || resetInfo.expiry < new Date()) {
                return res.status(400).json({ message: "Invalid or expired reset code" });
            }

            if (newPassword.length < 8 || !newPassword.match(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/)) {
                return res.status(400).json({
                    message: "New password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character",
                });
            }

            const hashedPassword = await argon2.hash(newPassword);

            await prisma.users.update({
                where: { id: user.id },
                data: { password: hashedPassword },
            });

            await deleteResetCode(user.id);

            res.status(200).json({ message: "Password reset successful" });
        } catch (error) {
            console.error("Password reset failed:", error);
            res.status(500).json({ message: "Failed to reset password" });
        }
    });

    app.post("/api/requestUsernameReminder", async (req: Request, res: Response) => {
        const { email } = req.body;

        try {
            const user = await prisma.users.findFirst({ where: { email } });
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            res.status(200).json({ message: `${user.username}` });
        } catch (error) {
            console.error("Username reminder request failed:", error);
            res.status(500).json({ message: "Failed to process username reminder request" });
        }
    });

    app.post("/api/changePassword", async (req: Request, res: Response) => {
        const { token, newPassword } = req.body;
        if (typeof token !== 'string' || !token.trim()) {
            return res.status(400).json({ message: "Token is required and must be a non-empty string." });
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as { username: string, password: string };
            if (typeof decoded === 'string' || !decoded.username) {
                return res.status(401).json({ message: "Invalid token" });
            }
            const user = await prisma.users.findUnique({ where: { username: decoded.username } });
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            if (newPassword.length < 8 || !newPassword.match(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/)) {
                return res.status(400).json({
                    message: "New password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character",
                });
            }

            const hashedNewPassword = await argon2.hash(newPassword);

            await prisma.users.update({
                where: { username: decoded.username },
                data: { password: hashedNewPassword },
            });

            // Generate a new token with the updated password
            const newToken = jwt.sign(
                { username: decoded.username, password: hashedNewPassword },
                process.env.JWT_SECRET || ""
            );

            res.status(200).json({ 
                message: "Password changed successfully",
                token: newToken
            });
        } catch (error) {
            console.error("Password change failed:", error);
            res.status(500).json({ message: "Failed to change password" });
        }
    });

    app.post("/api/changeUsername", async (req: Request, res: Response) => {
        const { token, newUsername } = req.body;

        if (typeof token !== 'string' || !token.trim()) {
            return res.status(400).json({ message: "Token is required and must be a non-empty string." });
        }

        if (typeof newUsername !== 'string' || !newUsername.trim()) {
            return res.status(400).json({ message: "New username is required and must be a non-empty string." });
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as { username: string, password: string };
            if (typeof decoded === 'string' || !decoded.username) {
                return res.status(401).json({ message: "Invalid token" });
            }

            const user = await prisma.users.findUnique({ where: { username: decoded.username } });
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            if (newUsername.length < 3 || !newUsername.match(/^[a-zA-Z0-9]+$/)) {
                return res.status(400).json({
                    message: "New username must be at least 3 characters long and contain only letters and numbers",
                });
            }

            // Check if the new username already exists (case-insensitive)
            const existingUser = await prisma.users.findFirst({
                where: {
                    username: {
                        equals: newUsername,
                        mode: 'insensitive',
                    },
                },
            });

            if (existingUser) {
                return res.status(409).json({ message: "Username already exists" });
            }

            // Perform the username update in a transaction
            await prisma.$transaction(async (prisma) => {
                // Update the user's username
                await prisma.users.update({
                    where: { username: decoded.username },
                    data: { username: newUsername },
                });

                // Update the gameplayUser's username
                await prisma.gameplayUser.update({
                    where: { username: decoded.username },
                    data: { username: newUsername },
                });

                // Find all users who have the old username in their friends list
                const usersToUpdate = await prisma.users.findMany({
                    where: {
                        friends: {
                            has: decoded.username
                        }
                    },
                    select: {
                        id: true,
                        friends: true
                    }
                });

                // Update each user's friends list
                for (const user of usersToUpdate) {
                    await prisma.users.update({
                        where: { id: user.id },
                        data: {
                            friends: user.friends.map(friend => 
                                friend === decoded.username ? newUsername : friend
                            )
                        }
                    });
                }
            });

            // Generate a new token with the updated username and the current hashed password
            const newToken = jwt.sign(
                { username: newUsername, password: user.password },
                process.env.JWT_SECRET || ""
            );

            res.status(200).json({ 
                message: "Username changed successfully",
                token: newToken 
            });
        } catch (error) {
            console.error("Username change failed:", error);
            res.status(500).json({ message: "Failed to change username" });
        }
    });

    app.post("/api/changeEmail", async (req: Request, res: Response) => {
        const { token, newEmail } = req.body;

        if (typeof token !== 'string' || !token.trim()) {
            return res.status(400).json({ message: "Token is required and must be a non-empty string." });
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
            if (typeof decoded === 'string' || !decoded.username) {
                return res.status(401).json({ message: "Invalid token" });
            }

            if (!newEmail.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
                return res.status(400).json({ message: "Invalid email address" });
            }

            const existingUser = await prisma.users.findFirst({ where: { email: newEmail } });
            if (existingUser) {
                return res.status(409).json({ message: "Email already in use" });
            }

            await prisma.users.update({
                where: { username: decoded.username },
                data: { email: newEmail },
            });

            res.status(200).json({ message: "Email changed successfully" });
        } catch (error) {
            console.error("Email change failed:", error);
            res.status(500).json({ message: "Failed to change email" });
        }
    });

    app.post("/api/deleteAccount", async (req: Request, res: Response) => {
        const { token, username } = req.body;

        if (typeof token !== 'string' || !token.trim()) {
            return res.status(400).json({ message: "Token is required and must be a non-empty string." });
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as { username: string, password: string };
            if (typeof decoded === 'string' || !decoded.username) {
                return res.status(401).json({ message: "Invalid token" });
            }

            // Verify that the username in the token matches the username provided
            if (decoded.username !== username) {
                return res.status(403).json({ message: "Unauthorized to delete this account" });
            }

            // Delete the account and related data
            await prisma.$transaction(async (prisma) => {
                // Delete Notifications
                await prisma.notifications.deleteMany({ where: { userId: username } });

                // Delete FriendRequests
                await prisma.friendRequests.deleteMany({ where: { username: username } });
                await prisma.friendRequests.deleteMany({ where: { friend: username } });

                // Delete BattleSessions
                await prisma.battleSessions.deleteMany({ where: { attackerUsername: username } });
                await prisma.battleSessions.deleteMany({ where: { defenderUsername: username } });

                // Delete Locations
                await prisma.locations.delete({ where: { username: username } }).catch(() => {});

                // Delete InventoryItems
                await prisma.inventoryItem.deleteMany({ where: { GameplayUser: { username: username } } });

                // Delete Statistics
                await prisma.statistics.deleteMany({ where: { GameplayUser: { username: username } } });

                // Delete GameplayUser
                await prisma.gameplayUser.delete({ where: { username: username } }).catch(() => {});

                // Finally, delete the User
                await prisma.users.delete({ where: { username: username } });
            });

            res.status(200).json({ message: "Account deleted successfully" });
        } catch (error) {
            console.error("Account deletion failed:", error);
            res.status(500).json({ message: "Failed to delete account" });
        }
    });
}