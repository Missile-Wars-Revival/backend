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
exports.setupHealthApi = void 0;
const jwt = __importStar(require("jsonwebtoken"));
const server_1 = require("../server");
function setupHealthApi(app) {
    //isAlive
    app.patch("/api/isAlive", async (req, res) => {
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
            const updatedUser = await server_1.prisma.gameplayUser.update({
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
        }
        catch (error) {
            console.error("Error updating isAlive status:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    });
    app.post("/api/getisAlive", async (req, res) => {
        const { token } = req.body;
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
        if (!decoded) {
            return res.status(401).json({ message: "Invalid token" });
        }
        const user = await server_1.prisma.gameplayUser.findFirst({
            where: {
                username: decoded.username,
            },
        });
        if (user) {
            res.status(200).json({ isAlive: user.isAlive });
        }
        else {
            res.status(404).json({ message: "User not found" });
        }
    });
    //health
    app.post("/api/getHealth", async (req, res) => {
        const { token } = req.body;
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
        if (!decoded) {
            return res.status(401).json({ message: "Invalid token" });
        }
        const user = await server_1.prisma.gameplayUser.findFirst({
            where: {
                username: decoded.username,
            },
        });
        if (user) {
            res.status(200).json({ health: user.health });
        }
        else {
            res.status(404).json({ message: "User not found" });
        }
    });
    app.post("/api/addHealth", async (req, res) => {
        const { token, amount } = req.body;
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
            // Check if decoded is of type JwtPayload and has a username property
            if (typeof decoded === 'object' && 'username' in decoded) {
                const username = decoded.username;
                const user = await server_1.prisma.gameplayUser.findUnique({
                    where: {
                        username: username,
                    },
                });
                if (user) {
                    // Calculate new health without exceeding 100
                    const newHealth = Math.min(user.health + amount, 100);
                    await server_1.prisma.gameplayUser.update({
                        where: {
                            username: username,
                        },
                        data: {
                            health: newHealth,
                        },
                    });
                    res.status(200).json({ message: "Health added", health: newHealth });
                }
                else {
                    res.status(404).json({ message: "User not found" });
                }
            }
            else {
                // If decoded does not have a username property
                res.status(401).json({ message: "Invalid token" });
            }
        }
        catch (error) {
            res.status(500).json({ message: "Error verifying token" });
        }
    });
    app.post("/api/removeHealth", async (req, res) => {
        const { token, amount } = req.body;
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
            if (typeof decoded === 'object' && 'username' in decoded) {
                const username = decoded.username;
                const user = await server_1.prisma.gameplayUser.findUnique({
                    where: { username: username },
                });
                if (user) {
                    const newHealth = Math.max(user.health - amount, 0);
                    const newIsAlive = newHealth > 0;
                    await server_1.prisma.gameplayUser.update({
                        where: { username: username },
                        data: {
                            health: newHealth,
                            isAlive: newIsAlive,
                        },
                    });
                    res.status(200).json({ message: "Health updated", health: newHealth, isAlive: newIsAlive });
                }
                else {
                    res.status(404).json({ message: "User not found" });
                }
            }
            else {
                res.status(401).json({ message: "Invalid token" });
            }
        }
        catch (error) {
            res.status(500).json({ message: "Error updating health" });
        }
    });
    app.post("/api/setHealth", async (req, res) => {
        const { token, newHealth } = req.body;
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
            if (typeof decoded === 'object' && 'username' in decoded) {
                const username = decoded.username;
                const user = await server_1.prisma.gameplayUser.findUnique({
                    where: { username: username },
                });
                if (user) {
                    const clampedHealth = Math.max(0, Math.min(newHealth, 100));
                    const newIsAlive = clampedHealth > 0;
                    await server_1.prisma.gameplayUser.update({
                        where: { username: username },
                        data: {
                            health: clampedHealth,
                            isAlive: newIsAlive,
                        },
                    });
                    res.status(200).json({ message: "Health set", health: clampedHealth, isAlive: newIsAlive });
                }
                else {
                    res.status(404).json({ message: "User not found" });
                }
            }
            else {
                res.status(401).json({ message: "Invalid token" });
            }
        }
        catch (error) {
            res.status(500).json({ message: "Error setting health" });
        }
    });
}
exports.setupHealthApi = setupHealthApi;
