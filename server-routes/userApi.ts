import * as jwt from "jsonwebtoken";
import { prisma } from "../server";
import { Request, Response } from "express";
import { getMutualFriends } from "./friendsApi";
import { JwtPayload } from "jsonwebtoken";

interface Statistics {
  badges: string[];
  numDeaths: number;
  numLootPlaced: number;
  numLandminesPlaced: number;
  numMissilesPlaced: number;
  numLootPickups: number;
  league: string;
}

interface UserProfile {
  username: string;
  rankpoints: number;
  mutualFriends: string[];
  statistics: Statistics;
}

interface SelfProfile {
  username: string;
  email: string;
  rankpoints: number;
  mutualFriends: string[];
  statistics: Statistics;
}

export async function getMutualUsersFriends(username1: string, username2: string): Promise<string[]> {
  const [user1, user2] = await Promise.all([
    prisma.users.findUnique({
      where: { username: username1 },
      select: { friends: true }
    }),
    prisma.users.findUnique({
      where: { username: username2 },
      select: { friends: true }
    })
  ]);

  if (!user1 || !user2) {
    throw new Error("One or both users not found");
  }

  const user1FriendSet = new Set(user1.friends);
  const mutualFriends = user2.friends.filter(friend => user1FriendSet.has(friend));

  return mutualFriends;
}

export function setupUserApi(app: any) {

  app.get("/api/user-profile", async (req: Request, res: Response) => {
    const { token, username } = req.query;

    if (!token || !username) {
      return res.status(400).json({ success: false, message: "Missing token or username" });
    }

    try {
      const decoded = jwt.verify(token as string, process.env.JWT_SECRET || "");
      if (typeof decoded === 'string' || !decoded.username) {
        return res.status(401).json({ success: false, message: "Invalid token" });
      }

      const [requestingUser, targetUser] = await Promise.all([
        prisma.users.findUnique({
          where: { username: decoded.username },
          include: { GameplayUser: true }
        }),
        prisma.users.findUnique({
          where: { username: username as string },
          include: {
            GameplayUser: {
              include: {
                Statistics: true,
                league: true
              }
            }
          }
        })
      ]);

      if (!requestingUser || !targetUser) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      const mutualFriends = await getMutualUsersFriends(requestingUser.username, targetUser.username);

      const statistics: Statistics = {
        badges: targetUser.GameplayUser?.Statistics[0]?.badges || [],
        numDeaths: targetUser.GameplayUser?.Statistics[0]?.numDeaths || 0,
        numLootPlaced: targetUser.GameplayUser?.Statistics[0]?.numLootPlaced || 0,
        numLandminesPlaced: targetUser.GameplayUser?.Statistics[0]?.numLandminesPlaced || 0,
        numMissilesPlaced: targetUser.GameplayUser?.Statistics[0]?.numMissilesPlaced || 0,
        numLootPickups: targetUser.GameplayUser?.Statistics[0]?.numLootPickups || 0,
        league: targetUser.GameplayUser?.league
          ? `${targetUser.GameplayUser.league.tier} ${targetUser.GameplayUser.league.division}`
          : "Unranked"
      };

      const userProfile: UserProfile = {
        username: targetUser.username,
        rankpoints: targetUser.GameplayUser?.rankPoints || 0,
        mutualFriends: mutualFriends,
        statistics: statistics,
      };

      res.status(200).json({ success: true, userProfile });
    } catch (error) {
      console.error("Failed to get user profile:", error);
      res.status(500).json({ success: false, message: "Failed to get user profile" });
    }
  });

  app.get("/api/self-profile", async (req: Request, res: Response) => {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ success: false, message: "Missing token" });
    }

    try {
      const decoded = jwt.verify(token as string, process.env.JWT_SECRET || "");
      if (typeof decoded === 'string' || !decoded.username) {
        return res.status(401).json({ success: false, message: "Invalid token" });
      }

      const user = await prisma.users.findUnique({
        where: { username: decoded.username },
        include: {
          GameplayUser: {
            include: {
              Statistics: true,
              league: true
            }
          }
        }
      });

      if (!user || !user.GameplayUser) {
        return res.status(404).json({ success: false, message: "User or GameplayUser not found" });
      }

      const mutualFriends = await getMutualFriends(user);

      // Get the most recent statistics or use default values
      const latestStats = user.GameplayUser.Statistics[0] || {};

      const statistics: Statistics = {
        badges: latestStats.badges || [],
        numDeaths: latestStats.numDeaths || 0,
        numLootPlaced: latestStats.numLootPlaced || 0,
        numLandminesPlaced: latestStats.numLandminesPlaced || 0,
        numMissilesPlaced: latestStats.numMissilesPlaced || 0,
        numLootPickups: latestStats.numLootPickups || 0,
        league: user.GameplayUser.league
          ? `${user.GameplayUser.league.tier} ${user.GameplayUser.league.division}`
          : "Unranked"
      };

      const userProfile: SelfProfile = {
        username: user.username,
        email: user.email,
        rankpoints: user.GameplayUser?.rankPoints || 0,
        mutualFriends: mutualFriends,
        statistics: statistics,
      };

      res.status(200).json({ success: true, userProfile });
    } catch (error) {
      console.error("Failed to get self profile:", error);
      res.status(500).json({ success: false, message: "Failed to get self profile" });
    }
  });
  app.get("/api/getuser", async (req: Request, res: Response) => {
    const { username } = req.query;
    const user = await prisma.users.findFirst({
      where: {
        username: username?.toString(),
      },
    });

    const fmtUser = {
      username: user?.username,
      id: user?.id,
      role: user?.role,
      avatar: user?.avatar,
    };

    if (user) {
      res.status(200).json({ ...fmtUser });
    } else {
      res.status(404).json({ message: "User not found" });
    }
  });

  app.patch("/api/locActive", async (req: Request, res: Response) => {
    const token = req.query.token;

    if (typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ message: "Token is required and must be a non-empty string." });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as JwtPayload;

      console.log("Decoded token:", decoded);

      if (!decoded.username) {
        return res.status(401).json({ message: "Invalid token: username not found" });
      }

      if (typeof req.body.locActive !== 'boolean') {
        return res.status(400).json({ message: "locActive status must be provided and be a boolean." });
      }

      const updatedUser = await prisma.gameplayUser.update({
        where: {
          username: decoded.username
        },
        data: {
          locActive: req.body.locActive
        },
        select: {
          username: true,
          locActive: true
        }
      });

      console.log("Updated user:", updatedUser);

      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      res.status(200).json({
        message: "locActive status updated successfully",
        user: updatedUser
      });
    } catch (error) {
      console.error("Error updating locActive status:", error);
      if (error instanceof jwt.JsonWebTokenError) {
        return res.status(401).json({ message: "Invalid token" });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/getlocActive", async (req: Request, res: Response) => {
    try {
        const token = req.query.token as string;

        if (!token) {
            return res.status(400).json({ message: "Token is required" });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as JwtPayload;

        if (!decoded.username) {
            return res.status(401).json({ message: "Invalid token: username not found" });
        }

        const user = await prisma.gameplayUser.findUnique({
            where: {
                username: decoded.username
            },
            select: {
                username: true,
                locActive: true
            }
        });

        console.log("Retrieve user:", user);

        if (user) {
            console.log("Sending locActive value:", user.locActive);
            res.status(200).json({ locActive: user.locActive });
        } else {
            res.status(404).json({ message: "User not found" });
        }
    } catch (error) {
        console.error("Error in getlocActive:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});
}