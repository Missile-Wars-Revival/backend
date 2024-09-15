import * as jwt from "jsonwebtoken";
import { prisma } from "../server";
import { Request, Response } from "express";
import { sendNotification } from "../runners/notificationhelper";

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
        },
        orderBy: [
          { tier: 'asc' },
          { division: 'asc' }
        ]
      });

      const uniqueLeagues = new Map();

      leagues.forEach(league => {
        const key = `${league.tier} ${league.division}`;
        if (!uniqueLeagues.has(key) || league._count.players > uniqueLeagues.get(key).playerCount) {
          uniqueLeagues.set(key, {
            name: key,
            playerCount: league._count.players
          });
        }
      });

      const topLeagues = Array.from(uniqueLeagues.values());

      // Sort by player count in descending order
      topLeagues.sort((a, b) => b.playerCount - a.playerCount);

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
        league: `${user.league.tier}`,
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

      if (!user || !user.league) {
        return res.status(404).json({ success: false, message: "User or league not found" });
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

      //console.log('Full league players response:', JSON.stringify(formattedPlayers, null, 2));

      return res.json({ success: true, players: formattedPlayers });
    } catch (error) {
      console.error('Error in /api/leagues/players:', error);
      return res.status(500).json({ success: false, message: "Internal server error" });
    }
  });
  
  app.get("/api/top100players", async (req: Request, res: Response) => {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ success: false, message: "Missing token" });
    }

    try {
      const decoded = jwt.verify(token as string, process.env.JWT_SECRET || "");
      if (typeof decoded === 'string' || !decoded.username) {
        return res.status(401).json({ success: false, message: "Invalid token" });
      }

      const top100Players = await prisma.gameplayUser.findMany({
        select: {
          id: true,
          username: true,
          rankPoints: true,
          league: {
            select: {
              tier: true,
              division: true
            }
          }
        },
        orderBy: { rankPoints: 'desc' },
        take: 100
      });

      const formattedPlayers = top100Players.map((player, index) => ({
        rank: index + 1,
        id: player.id.toString(),
        username: player.username,
        points: player.rankPoints,
        league: player.league ? `${player.league.tier} ${player.league.division}` : null,
        isCurrentUser: player.username === decoded.username
      }));

      return res.json({ success: true, players: formattedPlayers });
    } catch (error) {
      console.error('Error in /api/top100players:', error);
      return res.status(500).json({ success: false, message: "Internal server error" });
    }
  });
}

// League management functions
export async function assignUserToLeague(userId: number) {
  const user = await prisma.gameplayUser.findUnique({
    where: { id: userId },
    include: { Users: { select: { friends: true } } }
  });
  if (!user) return;

  const tier = getTierFromRankPoints(user.rankPoints);
  const division = getDivisionFromRankPoints(user.rankPoints);

  // Find leagues in the new tier and division
  const availableLeagues = await prisma.league.findMany({
    where: { 
      tier, 
      division,
      players: { some: {} },
    },
    include: {
      players: {
        select: { username: true },
        where: { username: { in: user.Users.friends } }
      },
      _count: {
        select: { players: true }
      }
    },
    orderBy: { number: 'asc' }
  });

  // Sort leagues by number of mutual friends, then by available space
  availableLeagues.sort((a, b) => {
    const friendDiff = b.players.length - a.players.length;
    if (friendDiff !== 0) return friendDiff;
    return (100 - b._count.players) - (100 - a._count.players);
  });

  let league = availableLeagues.find(l => l._count.players < 100);

  if (!league) {
    // If no suitable league found, create a new one
    const lastLeague = await prisma.league.findFirst({
      where: { tier, division },
      orderBy: { number: 'desc' }
    });

    const newLeagueNumber = lastLeague ? lastLeague.number + 1 : 1;
    const newLeague = await prisma.league.create({
      data: {
        tier,
        division,
        number: newLeagueNumber
      },
      include: {
        players: {
          select: { username: true },
          where: { username: { in: user.Users.friends } }
        },
        _count: {
          select: { players: true }
        }
      }
    });

    league = {
      ...newLeague,
      players: [],
      _count: { players: 0 }
    };
  }

  // Assign user to the league
  await prisma.gameplayUser.update({
    where: { id: userId },
    data: { leagueId: league.id }
  });

  return league;
}

export async function checkAndUpdateUserLeagues() {
  console.log("Starting hourly league update check...");

  const users = await prisma.gameplayUser.findMany({
    include: { league: true, Statistics: true }
  });

  let updatedCount = 0;

  for (const user of users) {
    const newTier = getTierFromRankPoints(user.rankPoints);
    const newDivision = getDivisionFromRankPoints(user.rankPoints);

    if (user.league && (user.league.tier !== newTier || user.league.division !== newDivision)) {
      const oldLeague = `${user.league.tier} ${user.league.division}`;
      
      // Remove user from current league
      await prisma.gameplayUser.update({
        where: { id: user.id },
        data: { leagueId: null }
      });

      // Assign user to new league
      const newLeague = await assignUserToLeague(user.id);

      if (newLeague) {
        const newLeagueStr = `${newLeague.tier} ${newLeague.division}`;
        console.log(`User ${user.username} moved from ${oldLeague} to ${newLeagueStr}`);
        updatedCount++;

        // Determine if it's a promotion or demotion
        const isPromotion = newLeague.tier > user.league.tier || 
          (newLeague.tier === user.league.tier && newLeague.division < user.league.division);

        // Send notification
        await sendLeagueChangeNotification(user.username, oldLeague, newLeagueStr, isPromotion);

        // Award badge for the new league
        await awardLeagueBadge(user.id, newLeague.tier);
      }
    }
  }

  console.log(`Hourly league update completed. ${updatedCount} users were moved.`);
}

async function awardLeagueBadge(userId: number, tier: string) {
  const badgeMap: { [key: string]: string } = {
    'Bronze': 'BRONZE_LEAGUE',
    'Silver': 'SILVER_LEAGUE',
    'Gold': 'GOLD_LEAGUE',
    'Diamond': 'DIAMOND_LEAGUE',
    'Legend': 'LEGEND_LEAGUE',
  };

  const badge = badgeMap[tier];

  if (!badge) {
    console.error(`Invalid tier: ${tier}`);
    return;
  }

  const user = await prisma.gameplayUser.findUnique({
    where: { id: userId },
    include: { Statistics: true }
  });

  if (!user || !user.Statistics || user.Statistics.length === 0) {
    console.error(`User or statistics not found for userId: ${userId}`);
    return;
  }

  const userStats = user.Statistics[0]; // Assuming there's only one Statistics entry per user

  // Check if the badge already exists
  if (!userStats.badges.includes(badge)) {
    // Add the new badge to the array
    const updatedBadges = [...userStats.badges, badge];

    // Update the user's statistics with the new badge
    await prisma.statistics.update({
      where: { id: userStats.id },
      data: { badges: updatedBadges }
    });

    console.log(`Awarded ${badge} badge to user ${user.username}`);
  }
}

async function sendLeagueChangeNotification(username: string, oldLeague: string, newLeague: string, isPromotion: boolean) {
  const title = isPromotion ? 'League Promotion!' : 'League Change';
  const body = isPromotion
    ? `Congratulations! You've been promoted from ${oldLeague} to ${newLeague}.`
    : `You've been moved from ${oldLeague} to ${newLeague}.`;

  await sendNotification(username, title, body, 'Server');
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
  if (rankPoints < 2000) return 'Bronze';
  if (rankPoints < 4000) return 'Silver';
  if (rankPoints < 6000) return 'Gold';
  if (rankPoints < 8000) return 'Diamond';
  return 'Legend';
}

function getDivisionFromRankPoints(rankPoints: number): string {
  const tierPoints = rankPoints % 2000;
  if (tierPoints < 666) return 'III';
  if (tierPoints < 1333) return 'II';
  return 'I';
}

