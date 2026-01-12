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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupNotificationApi = void 0;
const jwt = __importStar(require("jsonwebtoken"));
const server_1 = require("../server");
function setupNotificationApi(app) {
    app.delete("/api/deleteNotificationToken", async (req, res) => {
        const { token } = req.body;
        try {
            // Verify the token
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
            if (!decoded.username) {
                return res.status(401).json({ message: "Invalid token" });
            }
            // Update the user, setting notificationToken to null or an empty string
            await server_1.prisma.users.update({
                where: { username: decoded.username },
                data: { notificationToken: "" } // Using an empty string instead of null
            });
            res.status(200).json({ message: "Notification token deleted successfully" });
        }
        catch (error) {
            console.error("Error deleting notification token:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    });
    app.get("/api/notifications", async (req, res) => {
        const token = req.query.token;
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
            if (!decoded.username) {
                return res.status(401).json({ message: "Invalid token" });
            }
            const notifications = await server_1.prisma.notifications.findMany({
                where: { userId: decoded.username },
                orderBy: { timestamp: 'desc' }
            });
            res.status(200).json({ notifications });
        }
        catch (error) {
            console.error("Error fetching notifications:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    });
    app.delete("/api/deleteNotification", async (req, res) => {
        const { token, notificationId } = req.body;
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
            if (!decoded.username) {
                return res.status(401).json({ message: "Invalid token" });
            }
            const deletedNotification = await server_1.prisma.notifications.deleteMany({
                where: {
                    id: notificationId,
                    userId: decoded.username
                }
            });
            if (deletedNotification.count === 0) {
                return res.status(404).json({ message: "Notification not found" });
            }
            res.status(200).json({ message: "Notification deleted successfully" });
        }
        catch (error) {
            console.error("Error deleting notification:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    });
    app.patch("/api/markNotificationAsRead", async (req, res) => {
        const { token, notificationId } = req.body;
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
            if (!decoded.username) {
                return res.status(401).json({ message: "Invalid token" });
            }
            const updatedNotification = await server_1.prisma.notifications.updateMany({
                where: {
                    id: notificationId,
                    userId: decoded.username
                },
                data: { isRead: true }
            });
            if (updatedNotification.count === 0) {
                return res.status(404).json({ message: "Notification not found" });
            }
            res.status(200).json({ message: "Notification marked as read successfully" });
        }
        catch (error) {
            console.error("Error marking notification as read:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    });
    app.delete("/api/deleteMessageNotifications", async (req, res) => {
        const { token } = req.body;
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
            if (!decoded.username) {
                return res.status(401).json({ message: "Invalid token" });
            }
            const deletedNotifications = await server_1.prisma.notifications.deleteMany({
                where: {
                    userId: decoded.username,
                    title: "New Message"
                }
            });
            res.status(200).json({ message: `${deletedNotifications.count} notifications deleted successfully` });
        }
        catch (error) {
            console.error("Error deleting New Message notifications:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    });
    app.get("/api/notificationPreferences", async (req, res) => {
        const token = req.query.token;
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
            if (!decoded.username) {
                return res.status(401).json({ message: "Invalid token" });
            }
            const user = await server_1.prisma.users.findUnique({
                where: { username: decoded.username },
                include: { notificationPreferences: true }
            });
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }
            if (!user.notificationPreferences) {
                // If preferences don't exist, create default preferences
                const defaultPreferences = await server_1.prisma.notificationPreferences.create({
                    data: {
                        userId: user.id,
                        // All preferences default to true
                    }
                });
                return res.status(200).json({ preferences: defaultPreferences });
            }
            res.status(200).json({ preferences: user.notificationPreferences });
        }
        catch (error) {
            console.error("Error fetching notification preferences:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    });
    app.patch("/api/changeNotificationPreferences", async (req, res) => {
        var _a, _b, _c, _d, _e, _f, _g;
        const { token, preferences } = req.body;
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
            if (!decoded.username) {
                return res.status(401).json({ message: "Invalid token" });
            }
            const user = await server_1.prisma.users.findUnique({
                where: { username: decoded.username },
                include: { notificationPreferences: true }
            });
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }
            // Create a type-safe update object
            const preferencesData = {
                userId: user.id,
                incomingEntities: (_a = preferences.incomingEntities) !== null && _a !== void 0 ? _a : true,
                entityDamage: (_b = preferences.entityDamage) !== null && _b !== void 0 ? _b : true,
                entitiesInAirspace: (_c = preferences.entitiesInAirspace) !== null && _c !== void 0 ? _c : true,
                eliminationReward: (_d = preferences.eliminationReward) !== null && _d !== void 0 ? _d : true,
                lootDrops: (_e = preferences.lootDrops) !== null && _e !== void 0 ? _e : true,
                friendRequests: (_f = preferences.friendRequests) !== null && _f !== void 0 ? _f : true,
                leagues: (_g = preferences.leagues) !== null && _g !== void 0 ? _g : true,
            };
            // Update all preferences in a single operation
            const updatedPreferences = await server_1.prisma.notificationPreferences.upsert({
                where: { userId: user.id },
                update: preferencesData,
                create: preferencesData
            });
            res.status(200).json({ message: "Preferences updated successfully", preferences: updatedPreferences });
        }
        catch (error) {
            console.error("Error updating notification preferences:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    });
}
exports.setupNotificationApi = setupNotificationApi;
