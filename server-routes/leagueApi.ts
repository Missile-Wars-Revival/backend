import * as jwt from "jsonwebtoken";
import { prisma } from "../server";
import { Request, Response } from "express";

export function setupLeagueApi(app: any) {
	app.get("/api/leagues", async (req: Request, res: Response) => {
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
