"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateSchema = void 0;
exports.storeResetCode = storeResetCode;
exports.getResetCodeInfo = getResetCodeInfo;
exports.deleteResetCode = deleteResetCode;
exports.generateRandomCode = generateRandomCode;
exports.setupAuthRoutes = setupAuthRoutes;
const jwt = __importStar(require("jsonwebtoken"));
const server_1 = require("../server");
const argon2 = __importStar(require("argon2"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const api_1 = require("../interfaces/api");
const zod_1 = require("zod");
const admin = __importStar(require("firebase-admin"));
const transporter = nodemailer_1.default.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});
const validateSchema = (schema) => (req, res, next) => {
    try {
        schema.parse(req.body);
        next();
    }
    catch (error) {
        if (error instanceof zod_1.ZodError) {
            return res.status(400).json(error.errors);
        }
        next(error); // Pass the error to the next error handler
    }
};
exports.validateSchema = validateSchema;
async function storeResetCode(userId, code, expiry) {
    await server_1.prisma.passwordResetCodes.create({
        data: {
            userId,
            code,
            expiry,
        },
    });
}
async function getResetCodeInfo(userId, code) {
    return await server_1.prisma.passwordResetCodes.findFirst({
        where: {
            userId,
            code,
        },
    });
}
async function deleteResetCode(userId) {
    await server_1.prisma.passwordResetCodes.deleteMany({
        where: {
            userId,
        },
    });
}
function generateRandomCode(length) {
    return Math.random().toString().slice(2, 2 + length);
}
function setupAuthRoutes(app) {
    app.post("/api/login", (0, exports.validateSchema)(api_1.LoginSchema), async (req, res) => {
        const login = req.body;
        const user = await server_1.prisma.users.findFirst({
            where: {
                username: login.username,
            },
        });
        if (user && (await argon2.verify(user.password, login.password))) {
            const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET || "");
            await server_1.prisma.users.update({
                where: {
                    username: login.username,
                },
                data: {
                    notificationToken: login.notificationToken,
                },
            });
            res.status(200).json({ message: "Login successful", token });
        }
        else {
            res.status(401).json({ message: "Invalid username or password" });
        }
    });
    app.post("/api/register", (0, exports.validateSchema)(api_1.RegisterSchema), async (req, res) => {
        const register = req.body;
        try {
            const existingUser = await server_1.prisma.users.findFirst({
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
            if (!register.password.match(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/)) {
                return res.status(400).json({
                    message: "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&#)",
                });
            }
            if (!register.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
                return res.status(400).json({ message: "Invalid email address" });
            }
            if ((existingUser === null || existingUser === void 0 ? void 0 : existingUser.email) === register.email) {
                return res.status(400).json({ message: "Email already exists" });
            }
            const hashedPassword = await argon2.hash(register.password);
            await server_1.prisma.users.create({
                data: {
                    username: register.username,
                    password: hashedPassword,
                    email: register.email,
                    notificationToken: register.notificationToken,
                },
            });
            await server_1.prisma.gameplayUser.create({
                data: {
                    username: register.username,
                    createdAt: new Date().toISOString(),
                },
            });
            const token = jwt.sign({ username: register.username }, process.env.JWT_SECRET || "");
            res.status(200).json({ message: "User created", token });
        }
        catch (error) {
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002' &&
                'meta' in error && typeof error.meta === 'object' && error.meta !== null && 'target' in error.meta) {
                return res.status(409).json({ message: "Username already exists" });
            }
            console.error("Registration error:", error);
            res.status(500).json({ message: "An error occurred during registration" });
        }
    });
    app.post("/api/requestPasswordReset", async (req, res) => {
        const { email } = req.body;
        try {
            const user = await server_1.prisma.users.findFirst({ where: { email } });
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }
            // Delete expired reset codes for this user
            await server_1.prisma.passwordResetCodes.deleteMany({
                where: {
                    userId: user.id,
                    expiry: { lte: new Date() }, // Delete codes where expiry is less than or equal to current time
                },
            });
            // Check if a valid reset code already exists
            const existingResetCode = await server_1.prisma.passwordResetCodes.findFirst({
                where: {
                    userId: user.id,
                    expiry: { gt: new Date() }, // Check if the expiry is in the future
                },
            });
            let resetCode;
            let resetCodeExpiry;
            if (existingResetCode) {
                // Use the existing reset code
                resetCode = existingResetCode.code;
                resetCodeExpiry = existingResetCode.expiry;
            }
            else {
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
        }
        catch (error) {
            console.error("Password reset request failed:", error);
            res.status(500).json({ message: "Failed to process password reset request" });
        }
    });
    app.post("/api/resetPassword", async (req, res) => {
        const { email, code, newPassword } = req.body;
        try {
            const user = await server_1.prisma.users.findFirst({ where: { email } });
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
            try {
                const firebaseUser = await admin.auth().getUserByEmail(user.email);
                await admin.auth().updateUser(firebaseUser.uid, {
                    password: newPassword
                });
            }
            catch (firebaseError) {
                console.error("Error updating password in Firebase:", firebaseError);
            }
            await server_1.prisma.users.update({
                where: { id: user.id },
                data: { password: hashedPassword },
            });
            await deleteResetCode(user.id);
            res.status(200).json({ message: "Password reset successful" });
        }
        catch (error) {
            console.error("Password reset failed:", error);
            res.status(500).json({ message: "Failed to reset password" });
        }
    });
    app.post("/api/requestUsernameReminder", async (req, res) => {
        const { email } = req.body;
        try {
            const user = await server_1.prisma.users.findFirst({ where: { email } });
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }
            res.status(200).json({ message: `${user.username}` });
        }
        catch (error) {
            console.error("Username reminder request failed:", error);
            res.status(500).json({ message: "Failed to process username reminder request" });
        }
    });
    app.post("/api/changePassword", async (req, res) => {
        const { token, newPassword } = req.body;
        if (typeof token !== 'string' || !token.trim()) {
            return res.status(400).json({ message: "Token is required and must be a non-empty string." });
        }
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
            if (typeof decoded === 'string' || !decoded.username) {
                return res.status(401).json({ message: "Invalid token" });
            }
            const user = await server_1.prisma.users.findUnique({ where: { username: decoded.username } });
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
            }
            catch (firebaseError) {
                console.error("Error updating password in Firebase:", firebaseError);
            }
            await server_1.prisma.users.update({
                where: { username: decoded.username },
                data: { password: hashedNewPassword },
            });
            // Generate a new token with the updated password
            const newToken = jwt.sign({ username: decoded.username }, process.env.JWT_SECRET || "");
            res.status(200).json({
                message: "Password changed successfully",
                token: newToken
            });
        }
        catch (error) {
            console.error("Password change failed:", error);
            res.status(500).json({ message: "Failed to change password" });
        }
    });
    app.post("/api/changeUsername", async (req, res) => {
        const { token, newUsername } = req.body;
        if (typeof token !== 'string' || !token.trim()) {
            return res.status(400).json({ message: "Token is required and must be a non-empty string." });
        }
        if (typeof newUsername !== 'string' || !newUsername.trim()) {
            return res.status(400).json({ message: "New username is required and must be a non-empty string." });
        }
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
            if (typeof decoded === 'string' || !decoded.username) {
                return res.status(401).json({ message: "Invalid token" });
            }
            const user = await server_1.prisma.users.findUnique({ where: { username: decoded.username } });
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }
            if (newUsername.length < 3 || !newUsername.match(/^[a-zA-Z0-9]+$/)) {
                return res.status(400).json({
                    message: "New username must be at least 3 characters long and contain only letters and numbers",
                });
            }
            // Check if the new username already exists (case-insensitive)
            const existingUser = await server_1.prisma.users.findFirst({
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
            await server_1.prisma.$transaction(async (prisma) => {
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
                            friends: user.friends.map((friend) => friend === decoded.username ? newUsername : friend)
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
                        const conversation = conv;
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
                        }
                        else {
                            console.log(`No profile picture found for user ${decoded.username}`);
                        }
                    }
                    catch (error) {
                        console.error("Error updating profile picture in Firebase:", error);
                        // Decide whether to throw this error or handle it gracefully
                        // throw error; // Uncomment this line if you want to trigger a transaction rollback
                    }
                }
                catch (error) {
                    console.error("Error updating Firebase:", error);
                    // Don't throw the error, as we still want to complete the username change
                }
            });
            // Generate a new token with the updated username and the current hashed password
            const newToken = jwt.sign({ username: newUsername }, process.env.JWT_SECRET || "");
            res.status(200).json({
                message: "Username changed successfully",
                token: newToken
            });
        }
        catch (error) {
            console.error("Username change failed:", error);
            res.status(500).json({ message: "Failed to change username" });
        }
    });
    app.post("/api/changeEmail", async (req, res) => {
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
            const existingUser = await server_1.prisma.users.findFirst({ where: { email: newEmail } });
            if (existingUser) {
                return res.status(409).json({ message: "Email already in use" });
            }
            const user = await server_1.prisma.users.findUnique({ where: { username: decoded.username } });
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }
            try {
                const firebaseUser = await admin.auth().getUserByEmail(user.email);
                await admin.auth().deleteUser(firebaseUser.uid);
            }
            catch (firebaseError) {
                console.error("Error updating email in Firebase:", firebaseError);
                return res.status(500).json({ message: "Failed to update email in Firebase" });
            }
            await server_1.prisma.users.update({
                where: { username: decoded.username },
                data: { email: newEmail },
            });
            res.status(200).json({ message: "Email changed successfully" });
        }
        catch (error) {
            console.error("Email change failed:", error);
            res.status(500).json({ message: "Failed to change email" });
        }
    });
    app.post("/api/deleteAccount", async (req, res) => {
        const { token, username } = req.body;
        if (typeof token !== 'string' || !token.trim()) {
            return res.status(400).json({ message: "Token is required and must be a non-empty string." });
        }
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
            if (typeof decoded === 'string' || !decoded.username) {
                return res.status(401).json({ message: "Invalid token" });
            }
            // Verify that the username in the token matches the username provided
            if (decoded.username !== username) {
                return res.status(403).json({ message: "Unauthorized to delete this account" });
            }
            // Delete related records first
            await server_1.prisma.$transaction(async (prisma) => {
                // Delete Notifications
                await prisma.notifications.deleteMany({ where: { userId: username } });
                // Delete FriendRequests
                await prisma.friendRequests.deleteMany({ where: { username: username } });
                await prisma.friendRequests.deleteMany({ where: { friend: username } });
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
            }
            catch (error) {
                console.log(`No profile picture found for user ${username}`);
            }
            // Remove user from conversations in Firebase Realtime Database
            const conversationsRef = db.ref('conversations');
            const conversationsSnapshot = await conversationsRef.once('value');
            const conversations = conversationsSnapshot.val();
            if (conversations) {
                for (const [convId, conv] of Object.entries(conversations)) {
                    const conversation = conv;
                    if (conversation.participants && conversation.participants[username]) {
                        delete conversation.participants[username];
                        if (conversation.participantsArray) {
                            conversation.participantsArray = conversation.participantsArray.filter((p) => p !== username);
                        }
                        await conversationsRef.child(convId).set(conversation);
                    }
                }
            }
            return res.status(200).json({ message: "User account deleted successfully" });
        }
        catch (error) {
            console.error(`Failed to delete user ${username}:`, error);
            return res.status(500).json({ message: "Failed to delete user account" });
        }
    });
}
