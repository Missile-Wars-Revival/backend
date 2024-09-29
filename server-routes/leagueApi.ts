import * as jwt from "jsonwebtoken";
import { prisma } from "../server";
import { Request, Response } from "express";
import { sendNotification } from "../runners/notificationhelper";

const MAX_PLAYERS_PER_LEAGUE = 50;
const SOFT_LIMIT_BUFFER = 5;
const MIN_PLAYERS_PER_LEAGUE = 6;

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

      const uniqueLeagues = new Map();

      leagues.forEach(league => {
        const key = `${league.tier} ${league.division}`;
        if (!uniqueLeagues.has(key) || league._count.players > uniqueLeagues.get(key).playerCount) {
          uniqueLeagues.set(key, {
            name: key,
            tier: league.tier,
            division: league.division,
            playerCount: league._count.players
          });
        }
      });

      const topLeagues = Array.from(uniqueLeagues.values());

      // Define the order of tiers and divisions
      const tierOrder = ['Legend', 'Diamond', 'Gold', 'Silver', 'Bronze'];
      const divisionOrder = ['I', 'II', 'III'];

      // Sort the leagues
      topLeagues.sort((a, b) => {
        const tierDiff = tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier);
        if (tierDiff !== 0) return tierDiff;
        return divisionOrder.indexOf(a.division) - divisionOrder.indexOf(b.division);
      });

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
    include: { Users: { select: { friends: true } }, league: true }
  });
  if (!user) return;

  // Unassign user from league if rank points are below 10
  if (user.rankPoints < 10) {
    if (user.league) {
      await prisma.gameplayUser.update({
        where: { id: userId },
        data: { leagueId: null }
      });
      console.log(`User ${user.username} has been unassigned from their league due to low rank points.`);
    }
    return null;
  }

  if (user.rankPoints <= 0) {
    console.log(`User ${user.username} has 0 or fewer rank points. Not assigning to a league.`);
    return null;
  }

  const tier = getTierFromRankPoints(user.rankPoints);
  const division = getDivisionFromRankPoints(user.rankPoints);

  // Find leagues in the new tier and division
  const availableLeagues = await prisma.league.findMany({
    where: { 
      tier, 
      division,
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

  // Separate leagues with friends and without friends
  const leaguesWithFriends = availableLeagues.filter(l => l.players.length > 0);
  const leaguesWithoutFriends = availableLeagues.filter(l => l.players.length === 0);

  // Sort leagues with friends by number of mutual friends (ascending), then by available space (descending)
  leaguesWithFriends.sort((a, b) => {
    const friendDiff = a.players.length - b.players.length;
    if (friendDiff !== 0) return friendDiff;
    return b._count.players - a._count.players;
  });

  // Sort leagues without friends by available space (descending)
  leaguesWithoutFriends.sort((a, b) => b._count.players - a._count.players);

  // Combine sorted leagues, prioritizing leagues with fewer friends
  const sortedLeagues = [...leaguesWithFriends, ...leaguesWithoutFriends];

  let league = sortedLeagues.find(l => l._count.players < MAX_PLAYERS_PER_LEAGUE);

  if (!league) {
    // If all leagues are full, create a new one
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
        players: {
          select: { username: true },
          where: { username: { in: user.Users.friends } }
        },
        _count: {
          select: { players: true }
        }
      }
    });
  }

  return await prisma.$transaction(async (tx) => {
    // Assign user to the league
    await tx.gameplayUser.update({
      where: { id: userId },
      data: { leagueId: league.id }
    });

    // Check and balance leagues after assignment
    await balanceLeaguesIfNeeded(tx, league.tier, league.division);

    return league;
  });
}

async function balanceLeaguesIfNeeded(tx: any, tier: string, division: string) {
  const leagues = await tx.league.findMany({
    where: { tier, division },
    include: {
      players: true,
      _count: { select: { players: true } }
    },
    orderBy: { number: 'asc' }
  });

  const overfilledLeagues = leagues.filter((l: { _count: { players: number; }; }) => l._count.players > MAX_PLAYERS_PER_LEAGUE + SOFT_LIMIT_BUFFER);
  const underfilledLeagues = leagues.filter((l: { _count: { players: number; }; }) => l._count.players < MIN_PLAYERS_PER_LEAGUE);

  if (overfilledLeagues.length === 0 && underfilledLeagues.length === 0) {
    return; // No rebalancing needed
  }

  for (const league of overfilledLeagues) {
    const playersToMove = league.players.slice(MAX_PLAYERS_PER_LEAGUE);
    for (const player of playersToMove) {
      const targetLeague = leagues.find((l: { _count: { players: number; }; }) => l._count.players < MAX_PLAYERS_PER_LEAGUE);
      if (targetLeague) {
        await tx.gameplayUser.update({
          where: { id: player.id },
          data: { leagueId: targetLeague.id }
        });
        targetLeague._count.players++;
        league._count.players--;
      } else {
        // Create a new league if all existing leagues are at or above the soft limit
        const newLeague = await tx.league.create({
          data: {
            tier,
            division,
            number: leagues[leagues.length - 1].number + 1
          }
        });
        await tx.gameplayUser.update({
          where: { id: player.id },
          data: { leagueId: newLeague.id }
        });
        leagues.push(newLeague);
      }
    }
  }

  // Handle underfilled leagues
  for (const league of underfilledLeagues) {
    if (league._count.players < MIN_PLAYERS_PER_LEAGUE) {
      const playersToMove = league.players;
      for (const player of playersToMove) {
        const targetLeague = leagues.find((l: { id: any; _count: { players: number; }; }) => l.id !== league.id && l._count.players < MAX_PLAYERS_PER_LEAGUE);
        if (targetLeague) {
          await tx.gameplayUser.update({
            where: { id: player.id },
            data: { leagueId: targetLeague.id }
          });
          targetLeague._count.players++;
          league._count.players--;
        }
      }
      // Delete the league if it's empty after moving players
      if (league._count.players === 0) {
        await tx.league.delete({ where: { id: league.id } });
        leagues.splice(leagues.indexOf(league), 1);
      }
    }
  }
}

export async function checkAndUpdateUserLeagues() {
  console.log("Starting hourly league update check...");

  const users = await prisma.gameplayUser.findMany({
    include: { league: true, Statistics: true }
  });

  let updatedCount = 0;

  for (const user of users) {
    // Check if user should be unassigned due to low rank points
    if (user.rankPoints < 10 && user.league) {
      await prisma.gameplayUser.update({
        where: { id: user.id },
        data: { leagueId: null }
      });
      console.log(`User ${user.username} unassigned from league due to low rank points.`);
      updatedCount++;
      continue; // Skip to next user
    }

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

  console.log(`Hourly league update completed. ${updatedCount} users were moved or unassigned.`);
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