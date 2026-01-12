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
exports.setupRankApi = setupRankApi;
const jwt = __importStar(require("jsonwebtoken"));
const server_1 = require("../server");
function setupRankApi(app) {
    app.post("/api/getRankPoints", async (req, res) => {
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
            res.status(200).json({ rankPoints: user.rankPoints });
        }
        else {
            res.status(404).json({ message: "User not found" });
        }
    });
    app.post("/api/addRankPoints", async (req, res) => {
        const { token, points } = req.body;
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
            // Check if decoded is of type JwtPayload and has a username property
            if (typeof decoded === 'object' && 'username' in decoded) {
                const username = decoded.username;
                const user = await server_1.prisma.gameplayUser.findFirst({
                    where: {
                        username: username,
                    },
                });
                if (user) {
                    await server_1.prisma.gameplayUser.update({
                        where: {
                            username: username,
                        },
                        data: {
                            rankPoints: user.rankPoints + points, // Correctly add points to the current rankPoints
                        },
                    });
                    res.status(200).json({ message: "Rank points added" });
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
    app.post("/api/removeRankPoints", async (req, res) => {
        const { token, points } = req.body;
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
                    rankPoints: user.rankPoints - points,
                },
            });
            res.status(200).json({ message: "Rank points removed" });
        }
        else {
            res.status(404).json({ message: "User not found" });
        }
    });
    app.post("/api/getRank", async (req, res) => {
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
            const rank = user.rank;
            res.status(200).json({ rank });
        }
        else {
            res.status(404).json({ message: "User not found" });
        }
    });
    app.post("/api/setRank", async (req, res) => {
        const { token, rank } = req.body;
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
                    rank,
                },
            });
            res.status(200).json({ message: "Rank set" });
        }
        else {
            res.status(404).json({ message: "User not found" });
        }
    });
}
