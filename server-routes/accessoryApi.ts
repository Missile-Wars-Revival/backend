import { prisma } from "../server";
import { Request, Response } from "express";



export function setupAccessoryApi(app: any) {
    //website & discord bot
    app.get("/api/map-data", async (req: Request, res: Response) => {
        try {
            const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

            const [activePlayers, activeMissiles, lootDrops, landmines, totalPlayersCount] = await Promise.all([
                prisma.gameplayUser.findMany({
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
                prisma.missile.findMany({
                    where: { status: "Incoming" }
                }),
                prisma.loot.findMany({
                    where: {
                        Expires: {
                            gt: new Date()
                        }
                    }
                }),
                prisma.landmine.findMany({
                    where: {
                        Expires: {
                            gt: new Date()
                        }
                    }
                }),
                prisma.gameplayUser.count({
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
                active_players: activePlayers.map((p: { Locations: { latitude: any; longitude: any; }; }) => ({
                    latitude: p.Locations?.latitude,
                    longitude: p.Locations?.longitude
                })).filter((p: { latitude: any; longitude: any; }) => p.latitude && p.longitude),
                active_missiles: activeMissiles.map((m: { currentLat: any; currentLong: any; }) => ({
                    latitude: m.currentLat,
                    longitude: m.currentLong
                })),
                loot_drops: lootDrops.map((l: { locLat: any; locLong: any; }) => ({
                    latitude: l.locLat,
                    longitude: l.locLong
                })),
                landmines: landmines.map((l: { locLat: any; locLong: any; }) => ({
                    latitude: l.locLat,
                    longitude: l.locLong
                })),
                active_players_count: activePlayersCount,
                total_players: totalPlayersCount,
                total_missiles: activeMissiles.length
            };

            //console.log('Map data:', mapData);
            res.json(mapData);
        } catch (error) {
            console.error("Error fetching map data:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    });
    //discord notificaitons
    app.get("/api/recent-updates", async (req: Request, res: Response) => {
        const sinceTime = req.query.since ? new Date(req.query.since as string) : new Date(0);

        try {
            const [recentMissiles, recentLandmines, recentOther] = await Promise.all([
                prisma.missile.findMany({
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
                prisma.landmine.findMany({
                    where: {
                        placedTime: {
                            gt: sinceTime
                        }
                    },
                    orderBy: {
                        placedTime: 'asc'
                    }
                }),
                prisma.other.findMany({
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
        } catch (error) {
            console.error("Error fetching recent updates:", error);
            res.status(500).json({ message: "Error fetching recent updates" });
        }
    });
}