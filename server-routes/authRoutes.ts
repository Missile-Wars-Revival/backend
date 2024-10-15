import * as jwt from "jsonwebtoken";
import { prisma } from "../server";
import * as argon2 from "argon2";
import nodemailer from 'nodemailer';
import { Request, Response } from "express";
import * as admin from 'firebase-admin';
import { handleAsync } from "../utils/router";
import { z } from "zod";
import { signToken, verifyToken } from "../utils/jwt";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { emailSchema } from "../utils/schema";

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

export function generateRandomCode(length: number): string {
    return Math.random().toString().slice(2, 2 + length);
}

export function setupAuthRoutes(app: any) {
    const LoginSchema = z.object({
      username: z.string(),
      password: z.string(),
      notificationToken: z.string().optional(),
    });
    app.post(
        "/api/login",
        handleAsync(async (req: Request, res: Response) => {
            const login = await LoginSchema.parseAsync(req.body);

            const user = await prisma.users.findFirst({
                where: {
                    username: login.username,
                },
            });

            // user not found / invalid password
            if (!user || !await argon2.verify(user.password, login.password)) {
                res.status(401).json({ message: "Invalid username or password" });
                return;
            }

            const token = signToken({ username: user.username });

            // only update notification token if it is present in the request
            if (login.notificationToken) {
                await prisma.users.update({
                    where: {
                        username: login.username,
                    },
                    data: {
                        notificationToken: login.notificationToken,
                    },
                });
            }

            res.status(200).json({ message: "Login successful", token });
        })
    );

    const RegisterSchema = z.object({
        username: z.string(),
        email: z.string(),
        password: z.string(),
        notificationToken: z.string(),
    });
    app.post(
        "/api/register",
        handleAsync(async (req: Request, res: Response) => {
            const register = await RegisterSchema.parseAsync(req.body);

            const [
                existingUserByUsername,
                existingUserByEmail,
            ] = await Promise.all([
                prisma.users.findFirst({
                    where: {
                        username: {
                            equals: register.username,
                            mode: "insensitive"
                        },
                    },
                }),
                prisma.users.findFirst({
                    where: {
                        email: {
                            equals: register.email,
                            mode: "insensitive"
                        },
                    },
                }),
            ])

            if (existingUserByUsername) {
                return res.status(409).json({ message: "User with this username already exists" });
            }

            if (existingUserByEmail) {
                return res.status(409).json({ message: "User with this email already exists" });
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

            // zod already has a very good email regex, no need to impl our own, especially since email regex is a mess
            try {
                await emailSchema.parseAsync(register.email)
            } catch(err) {
                return res.status(400).json({
                    message: "Invalid email address",
                });
            }

            const hashedPassword = await argon2.hash(register.password);

            try {
                await prisma.users.create({
                    data: {
                        username: register.username,
                        password: hashedPassword,
                        email: register.email,
                        notificationToken: register.notificationToken,
                    },
                });
            } catch(error) {
                if (error instanceof PrismaClientKnownRequestError) {
                    if (error.code === "P2002" && error.meta?.target) {
                        res.status(409).json({ message: "Username already exists" });
                        return;
                    }
                }

                throw error
            }

            await prisma.gameplayUser.create({
                data: {
                    username: register.username,
                    createdAt: new Date().toISOString(),
                },
            });

            const token = signToken({ username: register.username });

            res.status(200).json({ message: "User created", token });
        })
    );

    const RequestPasswordResetSchema = z.object({
        email: z.string().email()
    })
    app.post(
        "/api/requestPasswordReset",
        handleAsync(async (req: Request, res: Response) => {
            const { email } = await RequestPasswordResetSchema.parseAsync(req.body);
    
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

                    // store the reset code in the database
                    await prisma.passwordResetCodes.create({
                        data: {
                            userId: user.id,
                            code: resetCode,
                            expiry: resetCodeExpiry,
                        },
                    });
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
        })
    );

    const ResetPasswordSchema = z.object({
        email: z.string().email(),
        code: z.string().length(6).regex(/^\d+$/),
        newPassword: z.string()
    });
    app.post(
        "/api/resetPassword",
        handleAsync(async (req: Request, res: Response) => {
            const { email, code, newPassword } = await ResetPasswordSchema.parseAsync(req.body);

            const user = await prisma.users.findFirst({ where: { email } });
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            const resetInfo = await prisma.passwordResetCodes.findFirst({
                where: {
                    userId: user.id,
                    code,
                },
            });
            if (!resetInfo || resetInfo.expiry < new Date()) {
                return res.status(400).json({ message: "Invalid or expired reset code" });
            }

            if (newPassword.length < 8 || !newPassword.match(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/)) {
                return res.status(400).json({
                    message: "New password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character",
                });
            }

            const hashedPassword = await argon2.hash(newPassword);

            try {
                const firebaseUser = await admin.auth().getUserByEmail(user.email);
                await admin.auth().updateUser(firebaseUser.uid, {
                    password: newPassword
                });
            } catch (firebaseError) {
                console.error("Error updating password in Firebase:", firebaseError);
            }

            await prisma.users.update({
                where: { id: user.id },
                data: { password: hashedPassword },
            });

            await prisma.passwordResetCodes.deleteMany({
                where: {
                    userId: user.id,
                },
            });

            res.status(200).json({ message: "Password reset successful" });
        })
    );

    const RequestUsernameReminderSchema = z.object({
        email: z.string().email()
    })
    app.post(
        "/api/requestUsernameReminder",
        handleAsync(async (req: Request, res: Response) => {
            const { email } = await RequestUsernameReminderSchema.parseAsync(req.body);

            const user = await prisma.users.findFirst({ where: { email } });
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            res.status(200).json({ message: user.username });
        })
    );

    const ChangePasswordSchema = z.object({
        token: z.string(),
        newPassword: z.string()
    })
    app.post(
        "/api/changePassword",
        handleAsync(async (req: Request, res: Response) => {
            const { token, newPassword } = await ChangePasswordSchema.parseAsync(req.body);
            const claims = await verifyToken(token);

            const user = await prisma.users.findUnique({
                where: { username: claims.username }
            });
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            if (newPassword.length < 8 || !newPassword.match(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/)) {
                return res.status(400).json({
                    message: "New password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character",
                });
            }

            const hashedNewPassword = await argon2.hash(newPassword);

            try {
                const firebaseUser = await admin.auth().getUserByEmail(user.email);
                await admin.auth().updateUser(firebaseUser.uid, {
                    password: newPassword
                });
            } catch (firebaseError) {
                console.error("Error updating password in Firebase:", firebaseError);
            }

            await prisma.users.update({
                where: { username: claims.username },
                data: { password: hashedNewPassword },
            });

            // Generate a new token with the updated password
            // NOTE: the token does not change since it only
            // contains the username
            const newToken = signToken({
                username: claims.username
            });

            res.status(200).json({
                message: "Password changed successfully",
                token: newToken
            });
        })
    );

    const ChangeUsernameSchema = z.object({
        token: z.string(),
        newUsername: z.string()
    })
    app.post(
        "/api/changeUsername",
        handleAsync(async (req: Request, res: Response) => {
            const { token, newUsername } = await ChangeUsernameSchema.parseAsync(req.body);
            const claims = await verifyToken(token);

            const user = await prisma.users.findUnique({
                where: { username: claims.username }
            });
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
                        mode: "insensitive",
                    },
                },
            });

            if (existingUser) {
                return res.status(409).json({ message: "Username already exists" });
            }

            // Perform the username update in a transaction
            await prisma.$transaction(async (prisma) => {
                await prisma.users.update({
                    where: { username: claims.username },
                    data: { username: newUsername }
                });

                // Find all users who have the old username in their friends list
                const usersToUpdate = await prisma.users.findMany({
                    where: {
                        friends: {
                            has: claims.username
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
                                friend === claims.username ? newUsername : friend
                            )
                        }
                    });
                }
                // Update Firebase
                const db = admin.database();
                const storageRef = admin.storage().bucket();

                try {
                    // Update user data in Firebase Realtime Database
                    const userRef = db.ref(`users/${claims.username}`);
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
                        if (conversation.participants && conversation.participants[claims.username]) {
                            conversation.participants[newUsername] = conversation.participants[claims.username];
                            delete conversation.participants[claims.username];
                            updated = true;
                        }

                        // Update participantsArray
                        if (conversation.participantsArray) {
                            const index = conversation.participantsArray.indexOf(claims.username);
                            if (index !== -1) {
                                conversation.participantsArray[index] = newUsername;
                                updated = true;
                            }
                        }

                        // Update lastMessage if necessary
                        if (conversation.lastMessage && conversation.lastMessage.senderId === claims.username) {
                            conversation.lastMessage.senderId = newUsername;
                            updated = true;
                        }

                        if (updated) {
                            await conversationsRef.child(convId).set(conversation);
                        }
                    }

                    // Update profile picture in Firebase Storage
                    const oldFilePath = `profileImages/${claims.username}`;
                    const newFilePath = `profileImages/${newUsername}`;
                    try {
                        const [fileExists] = await storageRef.file(oldFilePath).exists();
                        if (fileExists) {
                            await storageRef.file(oldFilePath).copy(newFilePath);
                            await storageRef.file(oldFilePath).delete();
                        } else {
                            console.log(`No profile picture found for user ${claims.username}`);
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

            // Generate a new token with the updated username and the current hashed password
            const newToken = signToken({ username: newUsername });

            res.status(200).json({
                message: "Username changed successfully",
                token: newToken
            });
        })
    );

    const ChangeEmailSchema = z.object({
        token: z.string(),
        newEmail: z.string()
    })
    app.post(
        "/api/changeEmail",
        handleAsync(async (req: Request, res: Response) => {
            const { token, newEmail } = await ChangeEmailSchema.parseAsync(req.body);
            const claims = await verifyToken(token);

            try {
                await emailSchema.parseAsync(newEmail);
            } catch(err) {
                return res.status(400).json({ message: "Invalid email address" });
            }

            const existingUser = await prisma.users.findFirst({
                where: {
                    email: {
                        equals: newEmail,
                        mode: "insensitive"
                    }
                }
            });
            if (existingUser) {
                return res.status(409).json({ message: "Email already in use" });
            }

            const user = await prisma.users.findUnique({
                where: { username: claims.username }
            });
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            try {
                const firebaseUser = await admin.auth().getUserByEmail(user.email);
                await admin.auth().deleteUser(firebaseUser.uid);
            } catch (firebaseError) {
                console.error("Error updating email in Firebase:", firebaseError);
                return res.status(500).json({ message: "Failed to update email in Firebase" });
            }

            await prisma.users.update({
                where: { username: claims.username },
                data: { email: newEmail },
            });

            res.status(200).json({ message: "Email changed successfully" });
        })
    );

    const DeleteAccountSchema = z.object({
        token: z.string(),
        // TODO/NOTE: Remove this propriety from body once client does not send it anymore
        username: z.string().optional()
    })
    app.post(
        "/api/deleteAccount",
        handleAsync(async (req: Request, res: Response) => {
            const { token, username: _username } = await DeleteAccountSchema.parseAsync(req.body);
            const claims = await verifyToken(token);

            // Verify that the username in the token matches the username provided
            if (_username && claims.username !== _username) {
                return res.status(403).json({ message: "Unauthorized to delete this account" });
            }

            // Delete related records first
            await prisma.$transaction(async (prisma) => {
                // Delete Notifications
                // NOTE: Does this actually delete the notification ? userId !== username I think
                await prisma.notifications.deleteMany({ where: { userId: claims.username } });

                // Delete FriendRequests
                await prisma.friendRequests.deleteMany({ where: { username: claims.username } });
                await prisma.friendRequests.deleteMany({ where: { friend: claims.username } });

                // Delete Locations
                await prisma.locations.delete({ where: { username: claims.username } }).catch(() => { });

                // Delete InventoryItems
                await prisma.inventoryItem.deleteMany({ where: { GameplayUser: { username: claims.username } } });

                // Delete Statistics
                await prisma.statistics.deleteMany({ where: { GameplayUser: { username: claims.username } } });

                // Delete GameplayUser
                await prisma.gameplayUser.delete({ where: { username: claims.username } }).catch(() => { });

                // Finally, delete the User
                await prisma.users.delete({ where: { username: claims.username } });
            });

            console.log(`Successfully deleted ${claims.username}`);

            // Delete user data from Firebase
            const db = admin.database();
            const storageRef = admin.storage().bucket();

            // Delete user data from Firebase Realtime Database
            await db.ref(`users/${claims.username}`).remove();

            // Delete profile picture from Firebase Storage
            const filePath = `profileImages/${claims.username}`;
            try {
                await storageRef.file(filePath).delete();
            } catch (error) {
                console.log(`No profile picture found for user ${claims.username}`);
            }

            // Remove user from conversations in Firebase Realtime Database
            const conversationsRef = db.ref('conversations');
            const conversationsSnapshot = await conversationsRef.once('value');
            const conversations = conversationsSnapshot.val();

            if (conversations) {
                for (const [convId, conv] of Object.entries(conversations)) {
                    const conversation = conv as any;
                    if (conversation.participants && conversation.participants[claims.username]) {
                        delete conversation.participants[claims.username];
                        if (conversation.participantsArray) {
                            conversation.participantsArray = conversation.participantsArray.filter((p: string) => p !== claims.username);
                        }
                        await conversationsRef.child(convId).set(conversation);
                    }
                }
            }

            return res.status(200).json({ message: "User account deleted successfully" });
        })
    );
}