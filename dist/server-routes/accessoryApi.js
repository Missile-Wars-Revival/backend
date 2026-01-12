"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupAccessoryApi = void 0;
const server_1 = require("../server");
function setupAccessoryApi(app) {
    //website & discord bot
    app.get("/api/map-data", async (req, res) => {
        try {
            const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
            const [activePlayers, activeMissiles, lootDrops, landmines, totalPlayersCount] = await Promise.all([
                server_1.prisma.gameplayUser.findMany({
                    where: {
                        isAlive: true,
                        Locations: {
                            updatedAt: {
                                gte: thirtyMinutesAgo
                            }
                        },
                        Users: {
                            role: {
                                not: 'bot'
                            }
                        }
                    },
                    include: {
                        Locations: true,
                        Users: true
                    }
                }),
                server_1.prisma.missile.findMany({
                    where: { status: "Incoming" }
                }),
                server_1.prisma.loot.findMany({
                    where: {
                        Expires: {
                            gt: new Date()
                        }
                    }
                }),
                server_1.prisma.landmine.findMany({
                    where: {
                        Expires: {
                            gt: new Date()
                        }
                    }
                }),
                server_1.prisma.gameplayUser.count({
                    where: {
                        Users: {
                            role: {
                                not: 'bot'
                            }
                        }
                    }
                })
            ]);
            const activePlayersCount = activePlayers.length;
            const mapData = {
                active_players: activePlayers.map((p) => {
                    var _a, _b;
                    return ({
                        latitude: (_a = p.Locations) === null || _a === void 0 ? void 0 : _a.latitude,
                        longitude: (_b = p.Locations) === null || _b === void 0 ? void 0 : _b.longitude
                    });
                }).filter((p) => p.latitude && p.longitude),
                active_missiles: activeMissiles.map((m) => ({
                    latitude: m.currentLat,
                    longitude: m.currentLong
                })),
                loot_drops: lootDrops.map((l) => ({
                    latitude: l.locLat,
                    longitude: l.locLong
                })),
                landmines: landmines.map((l) => ({
                    latitude: l.locLat,
                    longitude: l.locLong
                })),
                active_players_count: activePlayersCount,
                total_players: totalPlayersCount,
                total_missiles: activeMissiles.length
            };
            //console.log('Map data:', mapData);
            res.json(mapData);
        }
        catch (error) {
            console.error("Error fetching map data:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    });
    //discord notificaitons
    app.get("/api/recent-updates", async (req, res) => {
        const sinceTime = req.query.since ? new Date(req.query.since) : new Date(0);
        try {
            const [recentMissiles, recentLandmines, recentOther] = await Promise.all([
                server_1.prisma.missile.findMany({
                    where: {
                        sentAt: {
                            gt: sinceTime
                        },
                        status: "Incoming"
                    },
                    orderBy: {
                        sentAt: 'asc'
                    }
                }),
                server_1.prisma.landmine.findMany({
                    where: {
                        placedTime: {
                            gt: sinceTime
                        }
                    },
                    orderBy: {
                        placedTime: 'asc'
                    }
                }),
                server_1.prisma.other.findMany({
                    where: {
                        placedTime: {
                            gt: sinceTime
                        }
                    },
                    orderBy: {
                        placedTime: 'asc'
                    }
                })
            ]);
            res.status(200).json({
                missiles: recentMissiles,
                landmines: recentLandmines,
                other: recentOther
            });
        }
        catch (error) {
            console.error("Error fetching recent updates:", error);
            res.status(500).json({ message: "Error fetching recent updates" });
        }
    });
}
exports.setupAccessoryApi = setupAccessoryApi;
