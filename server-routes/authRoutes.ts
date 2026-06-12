import { issueToken, verifyToken } from "../util/auth";
import { createPlayer, ensureLocalUserForToken } from "../util/provisionUser";
import { syncProfileUsername } from "../util/socialStore";
import { verifyFirebaseIdToken } from "../util/firebaseIdToken";
import { prisma } from "../server";
import * as argon2 from "argon2";
import nodemailer from 'nodemailer';
import { NextFunction, Request, Response } from "express";
import { z, ZodError } from "zod";
import * as admin from 'firebase-admin';
import { randomInt } from "crypto";
import rateLimit from "express-rate-limit";

// Per-IP limits on credential-related endpoints (requires `trust proxy` to be
// set in server.ts so the client IP survives the Elastic Beanstalk LB).
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
});

const resetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
});

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
    // crypto.randomInt — reset codes must not be predictable
    let code = "";
    for (let i = 0; i < length; i++) {
        code += randomInt(0, 10).toString();
    }
    return code;
}

function generateUsername(displayName: string): string {
    const base = displayName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'player';
    const suffix = Math.random().toString(36).slice(2, 6);
    return `${base}${suffix}`;
}

// Push tokens are no longer accepted here (Phase 6): the client registers its
// Expo token directly in Firebase central (/notificationTokens/<uid>). Any
// notificationToken field old clients still send is simply ignored.

export function setupAuthRoutes(app: any) {
    // Returns the email for a given username (used by client to look up email
    // before Firebase sign-in). Inherently enumerable — rate-limited hard.
    app.post("/api/lookup", authLimiter, async (req: Request, res: Response) => {
        const { username } = req.body;
        if (!username) return res.status(400).json({ message: "Username required" });
        const user = await prisma.users.findFirst({ where: { username } });
        if (!user) return res.status(404).json({ message: "User not found" });
        return res.status(200).json({ email: user.email });
    });

    // Exchanges a still-valid token for a fresh one (sliding 30-day expiry).
    // Clients should call this on app start so active players never expire.
    app.post("/api/refresh", authLimiter, async (req: Request, res: Response) => {
        const { token } = req.body;
        if (typeof token !== 'string' || !token.trim()) {
            return res.status(400).json({ message: "Token is required and must be a non-empty string." });
        }
        try {
            const decoded = verifyToken(token);
            const user = await ensureLocalUserForToken(decoded);
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }
            return res.status(200).json({ message: "Token refreshed", token: await issueToken(user.username, user.firebaseUID) });
        } catch {
            return res.status(401).json({ message: "Invalid or expired token" });
        }
    });

    // OAuth login — verifies Firebase ID token, finds or creates user
    app.post("/api/oauth-login", authLimiter, async (req: Request, res: Response) => {
        const { idToken, displayName } = req.body;
        if (!idToken) return res.status(400).json({ message: "idToken required" });

        try {
            // Local admin SDK when firebasecred.json exists, coordinator
            // verification otherwise (community shards).
            const decoded = await verifyFirebaseIdToken(idToken);
            const { uid, email } = decoded;

            let user = await prisma.users.findFirst({ where: { firebaseUID: uid } });
            if (!user && email) {
                user = await prisma.users.findFirst({ where: { email } });
            }

            if (user) {
                if (!user.firebaseUID) {
                    await prisma.users.update({ where: { id: user.id }, data: { firebaseUID: uid } });
                }
                const token = await issueToken(user.username, user.firebaseUID ?? uid);
                return res.status(200).json({ message: "Login successful", token, username: user.username });
            }

            // New OAuth user — auto-generate a unique username
            let username = generateUsername(displayName || '');
            while (await prisma.users.findFirst({ where: { username } })) {
                username = generateUsername(displayName || '');
            }

            await createPlayer({ username, email: email || '', firebaseUID: uid });

            const token = await issueToken(username, uid);
            return res.status(200).json({ message: "User created", token, username });
        } catch (error) {
            console.error("OAuth login error:", error);
            return res.status(401).json({ message: "Invalid or expired Firebase token" });
        }
    });

    app.post("/api/login", authLimiter, async (req: Request, res: Response) => {
        const { idToken, username, password } = req.body;

        if (idToken) {
            // Firebase auth path
            try {
                const decoded = await verifyFirebaseIdToken(idToken);
                const user = await prisma.users.findFirst({
                    where: { OR: [{ email: decoded.email ?? '' }, { firebaseUID: decoded.uid }] },
                });
                if (!user) return res.status(404).json({ message: "User not found" });
                if (!user.firebaseUID) {
                    await prisma.users.update({ where: { id: user.id }, data: { firebaseUID: decoded.uid } });
                }
                const token = await issueToken(user.username, user.firebaseUID ?? decoded.uid);
                return res.status(200).json({ message: "Login successful", token });
            } catch {
                return res.status(401).json({ message: "Invalid Firebase token" });
            }
        }

        // Legacy username/password path
        if (!username || !password) {
            return res.status(400).json({ message: "Username and password required" });
        }
        const user = await prisma.users.findFirst({ where: { username } });
        if (user && user.password && (await argon2.verify(user.password, password))) {
            const token = await issueToken(user.username, user.firebaseUID);
            return res.status(200).json({ message: "Login successful", token });
        }
        return res.status(401).json({ message: "Invalid username or password" });
    });

    app.post("/api/register", authLimiter, async (req: Request, res: Response) => {
        const { idToken, username, email, password } = req.body;

        if (idToken) {
            // Firebase auth path
            try {
                const decoded = await verifyFirebaseIdToken(idToken);
                const firebaseEmail = decoded.email || email || '';

                if (!username || username.length < 3) {
                    return res.status(400).json({ message: "Username must be at least 3 characters long" });
                }
                if (!username.match(/^[a-zA-Z0-9]+$/)) {
                    return res.status(400).json({ message: "Username must only contain letters and numbers" });
                }

                const [existingByUsername, existingByEmail] = await Promise.all([
                    prisma.users.findFirst({ where: { username } }),
                    firebaseEmail ? prisma.users.findFirst({ where: { email: firebaseEmail } }) : null,
                ]);

                if (existingByUsername) return res.status(409).json({ message: "Username already exists" });
                if (existingByEmail) return res.status(409).json({ message: "Email already registered" });

                await createPlayer({ username, email: firebaseEmail, firebaseUID: decoded.uid });

                const token = await issueToken(username, decoded.uid);
                return res.status(200).json({ message: "User created", token });
            } catch (error: any) {
                if (error?.code === 'P2002') return res.status(409).json({ message: "Username already exists" });
                console.error("Firebase register error:", error);
                return res.status(500).json({ message: "An error occurred during registration" });
            }
        }

        // Legacy path
        try {
            if (!username || !email || !password) {
                return res.status(400).json({ message: "Username, email and password required" });
            }

            const existingUser = await prisma.users.findFirst({ where: { username } });
            if (existingUser) return res.status(409).json({ message: "User already exists" });

            if (password.length < 8) return res.status(400).json({ message: "Password must be at least 8 characters long" });
            if (username.length < 3) return res.status(400).json({ message: "Username must be at least 3 characters long" });
            if (!username.match(/^[a-zA-Z0-9]+$/)) return res.status(400).json({ message: "Username must only contain letters and numbers" });
            if (!password.match(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/)) {
                return res.status(400).json({ message: "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&#)" });
            }
            if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return res.status(400).json({ message: "Invalid email address" });

            const hashedPassword = await argon2.hash(password);

            await createPlayer({ username, password: hashedPassword, email });

            const token = await issueToken(username);
            return res.status(200).json({ message: "User created", token });
        } catch (error) {
            if (typeof error === 'object' && error !== null && 'code' in error && (error as any).code === 'P2002') {
                return res.status(409).json({ message: "Username already exists" });
            }
            console.error("Registration error:", error);
            return res.status(500).json({ message: "An error occurred during registration" });
        }
    });

    app.post("/api/requestPasswordReset", resetLimiter, async (req: Request, res: Response) => {
        const { email } = req.body;

        try {
            const user = await prisma.users.findFirst({ where: { email } });
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            // Delete expired reset codes for this user
            await prisma.passwordResetCodes.deleteMany({
                where: {
                    userId: user.id,
                    expiry: { lte: new Date() }, // Delete codes where expiry is less than or equal to current time
                },
            });

            // Check if a valid reset code already exists
            const existingResetCode = await prisma.passwordResetCodes.findFirst({
                where: {
                    userId: user.id,
                    expiry: { gt: new Date() }, // Check if the expiry is in the future
                },
            });

            let resetCode: string;
            let resetCodeExpiry: Date;

            if (existingResetCode) {
                // Use the existing reset code
                resetCode = existingResetCode.code;
                resetCodeExpiry = existingResetCode.expiry;
            } else {
                // Generate a new reset code
                resetCode = generateRandomCode(6); // Generate a 6-digit code
                resetCodeExpiry = new Date(Date.now() + 3600000); // Code valid for 1 hour
                await storeResetCode(user.id, resetCode, resetCodeExpiry);
            }

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

    app.post("/api/resetPassword", resetLimiter, async (req: Request, res: Response) => {
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

            try {
                const firebaseUser = await admin.auth().getUserByEmail(user.email);
                await admin.auth().updateUser(firebaseUser.uid, { password: newPassword });
            } catch (firebaseError) {
                console.error("Error updating password in Firebase:", firebaseError);
            }

            await prisma.users.update({ where: { id: user.id }, data: { password: null } });
            await deleteResetCode(user.id);

            res.status(200).json({ message: "Password reset successful" });
        } catch (error) {
            console.error("Password reset failed:", error);
            res.status(500).json({ message: "Failed to reset password" });
        }
    });

    app.post("/api/requestUsernameReminder", resetLimiter, async (req: Request, res: Response) => {
        const { email } = req.body;

        // Always answer the same way so this endpoint can't be used to probe
        // which emails have accounts; the username goes to the inbox instead.
        const genericResponse = { message: "If an account exists for that email, a reminder has been sent." };

        try {
            const user = await prisma.users.findFirst({ where: { email } });
            if (!user) {
                return res.status(200).json(genericResponse);
            }

            await transporter.sendMail({
                from: process.env.EMAIL_FROM,
                to: user.email,
                subject: "Your Missile Wars username",
                text: `Your username is: ${user.username}`,
                html: `<p>Your username is: <strong>${user.username}</strong></p>`,
            });

            res.status(200).json(genericResponse);
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
            const decoded = verifyToken(token) as { username: string, password: string };
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

            try {
                const firebaseUser = await admin.auth().getUserByEmail(user.email);
                await admin.auth().updateUser(firebaseUser.uid, { password: newPassword });
            } catch (firebaseError) {
                console.error("Error updating password in Firebase:", firebaseError);
            }

            await prisma.users.update({ where: { username: decoded.username }, data: { password: null } });

            // Generate a new token with the updated password
            const newToken = await issueToken(decoded.username, user.firebaseUID);

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
            const decoded = verifyToken(token) as { username: string, password: string };
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
            await prisma.$transaction(async (prisma: { users: { update: (arg0: { where: { username: string; } | { id: any; }; data: { username: string; } | { friends: any; }; }) => any; findMany: (arg0: { where: { friends: { has: string; }; }; select: { id: boolean; friends: boolean; }; }) => any; }; }) => {
                await prisma.users.update({
                    where: { username: decoded.username },
                    data: { username: newUsername }
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
                            friends: user.friends.map((friend: string) =>
                                friend === decoded.username ? newUsername : friend
                            )
                        }
                    });
                }
                // Update Firebase
                const db = admin.database();
                const storageRef = admin.storage().bucket();

                try {
                    // Update user data in Firebase Realtime Database
                    const userRef = db.ref(`users/${decoded.username}`);
                    const userSnapshot = await userRef.once('value');
                    const userData = userSnapshot.val();
                    if (userData) {
                        await db.ref(`users/${newUsername}`).set(userData);
                        await userRef.remove();
                    }

                    // Update conversations in Firebase Realtime Database
                    const conversationsRef = db.ref('conversations');
                    const conversationsSnapshot = await conversationsRef.once('value');
                    const conversations = conversationsSnapshot.val();
                    for (const [convId, conv] of Object.entries(conversations)) {
                        let updated = false;
                        const conversation = conv as any;

                        // Update participants
                        if (conversation.participants && conversation.participants[decoded.username]) {
                            conversation.participants[newUsername] = conversation.participants[decoded.username];
                            delete conversation.participants[decoded.username];
                            updated = true;
                        }

                        // Update participantsArray
                        if (conversation.participantsArray) {
                            const index = conversation.participantsArray.indexOf(decoded.username);
                            if (index !== -1) {
                                conversation.participantsArray[index] = newUsername;
                                updated = true;
                            }
                        }

                        // Update lastMessage if necessary
                        if (conversation.lastMessage && conversation.lastMessage.senderId === decoded.username) {
                            conversation.lastMessage.senderId = newUsername;
                            updated = true;
                        }

                        if (updated) {
                            await conversationsRef.child(convId).set(conversation);
                        }
                    }

                    // Update profile picture in Firebase Storage
                    const oldFilePath = `profileImages/${decoded.username}`;
                    const newFilePath = `profileImages/${newUsername}`;
                    try {
                        const [fileExists] = await storageRef.file(oldFilePath).exists();
                        if (fileExists) {
                            await storageRef.file(oldFilePath).copy(newFilePath);
                            await storageRef.file(oldFilePath).delete();
                        } else {
                            console.log(`No profile picture found for user ${decoded.username}`);
                        }
                    } catch (error) {
                        console.error("Error updating profile picture in Firebase:", error);
                        // Decide whether to throw this error or handle it gracefully
                        // throw error; // Uncomment this line if you want to trigger a transaction rollback
                    }
                } catch (error) {
                    console.error("Error updating Firebase:", error);
                    // Don't throw the error, as we still want to complete the username change
                }
            });

            // Keep the central profile (what cross-shard friends see) on the
            // new name; non-fatal, the coordinator re-bootstraps it on mint.
            await syncProfileUsername(user.firebaseUID, newUsername);

            // Generate a new token with the updated username. With
            // coordinator-minted tokens identity is the stable firebaseUID,
            // so the rename doesn't invalidate other devices' tokens... but
            // their username claim goes stale; those sessions must refresh.
            const newToken = await issueToken(newUsername, user.firebaseUID);

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
            const decoded = verifyToken(token);
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

            const user = await prisma.users.findUnique({ where: { username: decoded.username } });
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            try {
                const uid = user.firebaseUID
                    ?? (await admin.auth().getUserByEmail(user.email)).uid;
                await admin.auth().updateUser(uid, { email: newEmail });
            } catch (firebaseError) {
                console.error("Error updating email in Firebase:", firebaseError);
                return res.status(500).json({ message: "Failed to update email in Firebase" });
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
            const decoded = verifyToken(token) as { username: string, password: string };
            if (typeof decoded === 'string' || !decoded.username) {
                return res.status(401).json({ message: "Invalid token" });
            }

            // Verify that the username in the token matches the username provided
            if (decoded.username !== username) {
                return res.status(403).json({ message: "Unauthorized to delete this account" });
            }

            // Delete related records first
            await prisma.$transaction(async (prisma: { notifications: { deleteMany: (arg0: { where: { userId: any; }; }) => any; }; friendRequests: { deleteMany: (arg0: { where: { username: any; } | { friend: any; }; }) => any; }; locations: { delete: (arg0: { where: { username: any; }; }) => Promise<any>; }; inventoryItem: { deleteMany: (arg0: { where: { GameplayUser: { username: any; }; }; }) => any; }; statistics: { deleteMany: (arg0: { where: { GameplayUser: { username: any; }; }; }) => any; }; gameplayUser: { delete: (arg0: { where: { username: any; }; }) => Promise<any>; }; users: { delete: (arg0: { where: { username: any; }; }) => any; }; }) => {
                // Delete Notifications
                await prisma.notifications.deleteMany({ where: { userId: username } });

                // Delete Locations
                await prisma.locations.delete({ where: { username: username } }).catch(() => { });

                // Delete InventoryItems
                await prisma.inventoryItem.deleteMany({ where: { GameplayUser: { username: username } } });

                // Delete Statistics
                await prisma.statistics.deleteMany({ where: { GameplayUser: { username: username } } });

                // Delete GameplayUser
                await prisma.gameplayUser.delete({ where: { username: username } }).catch(() => { });

                // Finally, delete the User
                await prisma.users.delete({ where: { username: username } });
            });

            console.log(`Successfully deleted ${username}`);

            // Delete user data from Firebase
            const db = admin.database();
            const storageRef = admin.storage().bucket();

            // Delete user data from Firebase Realtime Database
            await db.ref(`users/${username}`).remove();

            // Delete profile picture from Firebase Storage
            const filePath = `profileImages/${username}`;
            try {
                await storageRef.file(filePath).delete();
            } catch (error) {
                console.log(`No profile picture found for user ${username}`);
            }

            // Remove user from conversations in Firebase Realtime Database
            const conversationsRef = db.ref('conversations');
            const conversationsSnapshot = await conversationsRef.once('value');
            const conversations = conversationsSnapshot.val();

            if (conversations) {
                for (const [convId, conv] of Object.entries(conversations)) {
                    const conversation = conv as any;
                    if (conversation.participants && conversation.participants[username]) {
                        delete conversation.participants[username];
                        if (conversation.participantsArray) {
                            conversation.participantsArray = conversation.participantsArray.filter((p: string) => p !== username);
                        }
                        await conversationsRef.child(convId).set(conversation);
                    }
                }
            }

            return res.status(200).json({ message: "User account deleted successfully" });
        } catch (error) {
            console.error(`Failed to delete user ${username}:`, error);
            return res.status(500).json({ message: "Failed to delete user account" });
        }
    });
}
