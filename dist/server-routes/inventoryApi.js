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
exports.setupInventoryApi = void 0;
const jwt = __importStar(require("jsonwebtoken"));
const server_1 = require("../server");
function setupInventoryApi(app) {
    app.post("/api/addItem", async (req, res) => {
        const { token, itemName, category } = req.body;
        try {
            // Verify the token and ensure it's decoded as an object
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
            if (typeof decoded === 'string' || !decoded.username) {
                return res.status(401).json({ message: "Invalid token" });
            }
            // Retrieve the user from the database
            const user = await server_1.prisma.gameplayUser.findFirst({
                where: {
                    username: decoded.username,
                },
            });
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }
            // Check if the item is already in the user's inventory
            const existingItem = await server_1.prisma.inventoryItem.findFirst({
                where: {
                    name: itemName,
                    userId: user.id,
                },
            });
            if (existingItem) {
                // If item exists, update the quantity
                await server_1.prisma.inventoryItem.update({
                    where: { id: existingItem.id },
                    data: { quantity: existingItem.quantity + 1 },
                });
            }
            else {
                // If item does not exist, create a new entry
                await server_1.prisma.inventoryItem.create({
                    data: {
                        name: itemName,
                        quantity: 1,
                        category: category, // Category is directly taken from the request body
                        userId: user.id,
                    },
                });
            }
            // Successful add item response
            res.status(200).json({ message: "Item added successfully" });
        }
        catch (error) {
            console.error("Add item failed: ", error);
            res.status(500).json({ message: "Add item failed" });
        }
    });
    app.get("/api/getWeaponTypes", async (req, res) => {
        try {
            // Fetch all missile types
            const missileTypes = await server_1.prisma.missileType.findMany();
            // Fetch all landmine types
            const landmineTypes = await server_1.prisma.landmineType.findMany();
            const otherTypes = await server_1.prisma.otherType.findMany();
            // Return both missile types and landmine types
            res.status(200).json({
                missileTypes,
                landmineTypes,
                otherTypes
            });
        }
        catch (error) {
            console.error("Failed to fetch weapon types: ", error);
            res.status(500).json({ message: "Failed to fetch weapon types" });
        }
    });
    app.post('/api/deduct-inventory', async (req, res) => {
        const { token, itemName, quantity } = req.body;
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
            if (typeof decoded === 'string' || !decoded.username) {
                return res.status(401).json({ message: "Invalid token" });
            }
            if (!itemName || !quantity) {
                return res.status(400).send('Missing required fields');
            }
            const user = await server_1.prisma.gameplayUser.findFirst({
                where: {
                    username: decoded.username,
                },
            });
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }
            // Check if the item is already in the user's inventory
            const existingItem = await server_1.prisma.inventoryItem.findFirst({
                where: {
                    name: itemName,
                    userId: user.id,
                },
            });
            if (existingItem) {
                // If item exists, update the quantity
                await server_1.prisma.inventoryItem.update({
                    where: { id: existingItem.id },
                    data: { quantity: existingItem.quantity - quantity },
                });
                // Successful deduct item response
                return res.status(200).json({ message: "Item deducted successfully" });
            }
            else {
                return res.status(404).json({ message: "Item not found in inventory" });
            }
        }
        catch (error) {
            console.error("Deduct item failed: ", error);
            return res.status(500).json({ message: "Deduct item failed" });
        }
    });
    app.post('/api/add-inventory', async (req, res) => {
        const { token, itemName, quantity } = req.body;
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
            if (typeof decoded === 'string' || !decoded.username) {
                return res.status(401).json({ message: "Invalid token" });
            }
            if (!itemName || !quantity) {
                return res.status(400).send('Missing required fields');
            }
            const user = await server_1.prisma.gameplayUser.findFirst({
                where: {
                    username: decoded.username,
                },
            });
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }
            // Check if the item is already in the user's inventory
            const existingItem = await server_1.prisma.inventoryItem.findFirst({
                where: {
                    name: itemName,
                    userId: user.id,
                },
            });
            if (existingItem) {
                // If item exists, update the quantity
                await server_1.prisma.inventoryItem.update({
                    where: { id: existingItem.id },
                    data: { quantity: existingItem.quantity + quantity },
                });
            }
            if (!existingItem) {
                // If item does not exist, create a new entry
                const itemCategory = await server_1.prisma.inventoryItem.findFirst({
                    where: { name: itemName },
                });
                if (!itemCategory) {
                    return res.status(404).json({ message: "Item category not found" });
                }
                await server_1.prisma.inventoryItem.create({
                    data: {
                        name: itemName,
                        quantity: quantity,
                        category: itemCategory.category,
                        userId: user.id,
                    },
                });
            }
            else {
                return res.status(404).json({ message: "Item not found in inventory" });
            }
        }
        catch (error) {
            console.error("Deduct item failed: ", error);
            return res.status(500).json({ message: "Deduct item failed" });
        }
    });
}
exports.setupInventoryApi = setupInventoryApi;
