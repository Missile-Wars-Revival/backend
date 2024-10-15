import { z } from "zod";
import { prisma } from "../server";
import { Request, Response } from "express";
import { handleAsync } from "../utils/router";



export function setupAccessoryApi(app: any) {
    //website & discord bot
    app.get("/api/map-data", handleAsync(async (req: Request, res: Response) => {
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
            active_players: activePlayers.map(p => ({
                latitude: p.Locations?.latitude,
                longitude: p.Locations?.longitude
            })).filter(p => p.latitude && p.longitude),
            active_missiles: activeMissiles.map(m => ({
                latitude: m.currentLat,
                longitude: m.currentLong
            })),
            loot_drops: lootDrops.map(l => ({
                latitude: l.locLat,
                longitude: l.locLong
            })),
            landmines: landmines.map(l => ({
                latitude: l.locLat,
                longitude: l.locLong
            })),
            active_players_count: activePlayersCount,
            total_players: totalPlayersCount,
            total_missiles: activeMissiles.length
        };

        //console.log('Map data:', mapData);
        res.json(mapData);
    }));

    //discord notificaitons
    const RecentUpdatesSchema = z.object({
        since: z.string().optional()
    })
    app.get("/api/recent-updates", handleAsync(async (req: Request, res: Response) => {
        const query = await RecentUpdatesSchema.parseAsync(req.query)
        const sinceTime = new Date(query.since ?? 0)

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
    }));
}