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
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupMoneyApi = setupMoneyApi;
const jwt = __importStar(require("jsonwebtoken"));
const server_1 = require("../server");
function setupMoneyApi(app) {
    app.post("/api/addMoney", async (req, res) => {
        const { token, amount } = req.body;
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
            // Ensure decoded is an object and has the username property
            if (typeof decoded === 'object' && 'username' in decoded) {
                const username = decoded.username;
                const user = await server_1.prisma.gameplayUser.findFirst({
                    where: {
                        username: username,
                    },
                });
                if (user) {
                    // Perform the update if the user is found
                    await server_1.prisma.gameplayUser.update({
                        where: {
                            username: username,
                        },
                        data: {
                            money: user.money + amount, // Ensure correct arithmetic operation
                        },
                    });
                    res.status(200).json({ message: "Money added" });
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
            res.status(500).json({ message: "Error verifying token" });
        }
    });
    app.post("/api/removeMoney", async (req, res) => {
        const { token, amount } = req.body;
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
            await server_1.prisma.gameplayUser.update({
                where: {
                    username: decoded.username,
                },
                data: {
                    money: user.money - amount,
                },
            });
            res.status(200).json({ message: "Money removed" });
        }
        else {
            res.status(404).json({ message: "User not found" });
        }
    });
    app.get("/api/getMoney", async (req, res) => {
        const { token } = req.query;
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
            res.status(200).json({ money: user.money });
        }
        else {
            res.status(404).json({ message: "User not found" });
        }
    });
    app.post("/api/purchaseItem", async (req, res) => {
        const { token, items, money } = req.body;
        try {
            // Verify the token and ensure it's treated as an object
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
            if (user.money < money) {
                return res.status(400).json({ message: "Insufficient funds" });
            }
            // Ensure items is an array and contains valid objects
            if (!Array.isArray(items) || !items.every(item => typeof item.product.name === 'string' && typeof item.quantity === 'number' && typeof item.product.category === 'string')) {
                return res.status(400).json({ message: "Invalid items provided" });
            }
            // Start a transaction
            await server_1.prisma.$transaction(async (prisma) => {
                // Update user's money
                await prisma.gameplayUser.update({
                    where: { username: decoded.username },
                    data: { money: user.money - money },
                });
                for (const item of items) {
                    const { name, category } = item.product;
                    // Check if the item already exists in the user's inventory
                    const existingItem = await prisma.inventoryItem.findFirst({
                        where: {
                            name: name,
                            userId: user.id,
                        },
                    });
                    if (existingItem) {
                        // If item exists, update the quantity
                        await prisma.inventoryItem.update({
                            where: { id: existingItem.id },
                            data: { quantity: existingItem.quantity + item.quantity },
                        });
                    }
                    else {
                        // If item does not exist, create a new entry
                        await prisma.inventoryItem.create({
                            data: {
                                name: name,
                                quantity: item.quantity,
                                category: category,
                                userId: user.id,
                            },
                        });
                    }
                }
            });
            // Successful purchase response
            res.status(200).json({ message: "Items purchased" });
        }
        catch (error) {
            console.error("Transaction failed: ", error);
            res.status(500).json({ message: "Transaction failed" });
        }
    });
}
