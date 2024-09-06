import * as jwt from "jsonwebtoken";
import { prisma } from "../server";
import { Request, Response } from "express";

export function setupLeagueApi(app: any) {
	app.get("/api/topleagues", async (req: Request, res: Response) => {
		const { token } = req.query;

		if (!token) {
			return res.status(400).json({ success: false, message: "Missing token" });
		}

		try {
			const decoded = jwt.verify(token as string, process.env.JWT_SECRET || "");
			if (typeof decoded === 'string' || !decoded.username) {
				return res.status(401).json({ success: false, message: "Invalid token" });
			}

			const leagues = await prisma.league.findMany({
				include: {
					_count: {
						select: { players: true }
					}
				}
			});

			return res.json({ success: true, leagues });
		} catch (error) {
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
	});

	app.get("/api/leagues/user", async (req: Request, res: Response) => {
		const { token } = req.query;

		if (!token) {
			return res.status(400).json({ success: false, message: "Missing token" });
		}

		try {
			const decoded = jwt.verify(token as string, process.env.JWT_SECRET || "");
			if (typeof decoded === 'string' || !decoded.username) {
				return res.status(401).json({ success: false, message: "Invalid token" });
			}

			const user = await prisma.gameplayUser.findUnique({
				where: { username: decoded.username },
				include: { league: true }
			});

			if (!user) {
				return res.status(404).json({ success: false, message: "User not found" });
			}

			return res.json({ success: true, league: user.league });
		} catch (error) {
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
	});

	app.get("/api/leagues/current", async (req: Request, res: Response) => {
		const { token } = req.query;

		if (!token) {
			return res.status(400).json({ success: false, message: "Missing token" });
		}

		try {
			const decoded = jwt.verify(token as string, process.env.JWT_SECRET || "");
			if (typeof decoded === 'string' || !decoded.username) {
				return res.status(401).json({ success: false, message: "Invalid token" });
			}

			let user = await prisma.gameplayUser.findUnique({
				where: { username: decoded.username },
				include: { league: true }
			});

			if (!user) {
				return res.status(404).json({ success: false, message: "User not found" });
			}

			if (!user.league) {
				// If user doesn't have a league, assign them to one
				await assignUserToLeague(user.id);
				// Fetch the user again with the newly assigned league
				user = await prisma.gameplayUser.findUnique({
					where: { id: user.id },
					include: { league: true }
				});

				if (!user || !user.league) {
					console.error(`Failed to assign user to league: ${user?.id}`);
					return res.status(404).json({ success: false, message: "Failed to assign user to a league" });
				}
			}

			const topPlayer = await prisma.gameplayUser.findFirst({
				where: { leagueId: user.league.id },
					orderBy: { rankPoints: 'desc' },
					select: { username: true, rankPoints: true }
			});

			const league = {
				id: user.league.id,
				tier: user.league.tier,
				division: user.league.division,
				number: user.league.number,
				topPlayer: topPlayer ? {
					username: topPlayer.username,
					points: topPlayer.rankPoints
				} : null
				};

			return res.json({ success: true, league });
		} catch (error) {
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
	});

	app.get("/api/leagues/players", async (req: Request, res: Response) => {
		const { token } = req.query;

		if (!token) {
			return res.status(400).json({ success: false, message: "Missing token" });
		}

		try {
			const decoded = jwt.verify(token as string, process.env.JWT_SECRET || "");
			if (typeof decoded === 'string' || !decoded.username) {
				return res.status(401).json({ success: false, message: "Invalid token" });
			}

			let user = await prisma.gameplayUser.findUnique({
				where: { username: decoded.username },
				include: { league: true }
			});

			if (!user) {
				return res.status(404).json({ success: false, message: "User not found" });
			}

			if (!user.league) {
				// If user doesn't have a league, assign them to one
				await assignUserToLeague(user.id);
				// Fetch the user again with the newly assigned league
				user = await prisma.gameplayUser.findUnique({
					where: { id: user.id },
					include: { league: true }
				});

				if (!user || !user.league) {
					return res.status(404).json({ success: false, message: "Failed to assign user to a league" });
				}
			}

			const players = await prisma.gameplayUser.findMany({
				where: { leagueId: user.league.id },
				select: {
					id: true,
					username: true,
					rankPoints: true,
				},
				orderBy: { rankPoints: 'desc' }
			});

			const formattedPlayers = players.map(player => ({
				id: player.id.toString(),
				username: player.username,
				points: player.rankPoints,
				isCurrentUser: player.username === decoded.username
			}));

			return res.json({ success: true, players: formattedPlayers });
		} catch (error) {
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
	});
}

// League management functions
export async function assignUserToLeague(userId: number) {
	const user = await prisma.gameplayUser.findUnique({ where: { id: userId } });
	if (!user) return;

	const tier = getTierFromRankPoints(user.rankPoints);
	const division = getDivisionFromRankPoints(user.rankPoints);

	let league = await prisma.league.findFirst({
		where: { tier, division },
		include: { _count: { select: { players: true } } }
	});

	if (!league || league._count.players >= 100) {
		const newLeagueNumber = league ? league.number + 1 : 1;
		league = await prisma.league.create({
			data: {
				tier,
				division,
				number: newLeagueNumber
			},
			include: { _count: { select: { players: true } } }
		});
	}

	if (!league) {
		console.error("Failed to create or find a league");
		return;
	}

	await prisma.gameplayUser.update({
		where: { id: userId },
		data: { leagueId: league.id }
	});
}

export async function checkAndPromoteUsers() {
	const users = await prisma.gameplayUser.findMany({
		include: { league: true }
	});

	for (const user of users) {
		const newTier = getTierFromRankPoints(user.rankPoints);
		const newDivision = getDivisionFromRankPoints(user.rankPoints);

		if (user.league && (user.league.tier !== newTier || user.league.division !== newDivision)) {
			await assignUserToLeague(user.id);
		}
	}
}

function getTierFromRankPoints(rankPoints: number): string {
	if (rankPoints < 1000) return 'Bronze';
	if (rankPoints < 2000) return 'Silver';
	if (rankPoints < 3000) return 'Gold';
	return 'Diamond';
}

function getDivisionFromRankPoints(rankPoints: number): string {
	const tierPoints = rankPoints % 1000;
	if (tierPoints < 333) return 'III';
	if (tierPoints < 666) return 'II';
	return 'I';
}
