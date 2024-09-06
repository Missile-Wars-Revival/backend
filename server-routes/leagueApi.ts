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

			const globalTopPlayer = await getGlobalTopPlayer();

			const league = {
				id: user.league.id,
				tier: user.league.tier,
				division: user.league.division,
				number: user.league.number,
				globalTopPlayer: globalTopPlayer
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

	// Find an available league or create a new one if all are full
	let league = await prisma.league.findFirst({
		where: { 
			tier, 
			division,
			players: { some: {} } // Ensure the league has at least one player
		},
		orderBy: { number: 'desc' },
		include: { 
			_count: { select: { players: true } },
			players: true
		}
	});

	if (!league || league.players.length >= 100) {
		// If no suitable league found or the league is full, create a new one
		const lastLeague = await prisma.league.findFirst({
			where: { tier, division },
				orderBy: { number: 'desc' }
		});

		const newLeagueNumber = lastLeague ? lastLeague.number + 1 : 1;
		league = await prisma.league.create({
			data: {
				tier,
				division,
				number: newLeagueNumber
			},
			include: { 
				_count: { select: { players: true } },
				players: true
			}
		});
	}

	// Assign user to the league
	await prisma.gameplayUser.update({
		where: { id: userId },
		data: { leagueId: league.id }
	});
}

export async function checkAndUpdateUserLeagues() {
	const users = await prisma.gameplayUser.findMany({
		include: { league: true }
	});

	for (const user of users) {
		const newTier = getTierFromRankPoints(user.rankPoints);
		const newDivision = getDivisionFromRankPoints(user.rankPoints);

		if (user.league && (user.league.tier !== newTier || user.league.division !== newDivision)) {
			// Remove user from current league
			await prisma.gameplayUser.update({
				where: { id: user.id },
				data: { leagueId: null }
			});

			// Assign user to new league
			await assignUserToLeague(user.id);

			console.log(`User ${user.username} moved from ${user.league.tier} ${user.league.division} to ${newTier} ${newDivision}`);
		}
	}
}

export async function getGlobalTopPlayer() {
	const topPlayer = await prisma.gameplayUser.findFirst({
		orderBy: { rankPoints: 'desc' },
		include: { league: true }
	});

	if (!topPlayer) return null;

	return {
		username: topPlayer.username,
		points: topPlayer.rankPoints,
		league: topPlayer.league ? {
			tier: topPlayer.league.tier,
			division: topPlayer.league.division,
			number: topPlayer.league.number
		} : null
	};
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

