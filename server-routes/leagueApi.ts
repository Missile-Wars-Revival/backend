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

      const leagueAggregates = await prisma.league.groupBy({
        by: ['tier', 'division'],
        _count: {
          _all: true
        },
        orderBy: [
          { tier: 'asc' },
          { division: 'asc' }
        ]
      });

      const topLeagues = leagueAggregates.map(league => ({
        name: `${league.tier} ${league.division}`,
        playerCount: league._count._all
      }));

      return res.json({ 
        success: true, 
        leagues: topLeagues.slice(0, 10) // Limit to top 10 leagues
      });
    } catch (error) {
      console.error('Error in /api/topleagues:', error);
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
          return res.status(404).json({ success: false, message: "Failed to assign user to a league" });
        }
      }

      return res.json({ 
        success: true, 
        league: `${user.league.tier} ${user.league.division}`,
        division: user.league.division
      });
    } catch (error) {
      console.error('Error in /api/leagues/current:', error);
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
      players: { some: {} }, // Ensure the league has at least one player
    },
    include: {
      _count: {
        select: { players: true }
      }
    },
    orderBy: { number: 'desc' }
  });

  if (league && league._count.players >= 100) {
    league = null; // Set to null if the league is full
  }

  if (!league) {
    // If no suitable league found, create a new one
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
      include: { _count: { select: { players: true } } }
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

