import * as jwt from "jsonwebtoken";
import { prisma } from "../server";
import { Request, Response } from "express";
import { getMutualFriends } from "./friendsApi";
import { JwtPayload } from "jsonwebtoken";
import * as argon2 from "argon2";

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

  app.post("/api/editUser", async (req: Request, res: Response) => {
    const { token, username, updates } = req.body;
  
    if (!token || !username || !updates) {
      return res.status(400).json({ success: false, message: "Missing token, username or updates" });
    }
  
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as JwtPayload;
  
      if (!decoded.username) {
        return res.status(401).json({ message: "Invalid token: username not found" });
      }
  
      // Separate updates for Users and GameplayUser
      let userUpdates: any = {};
      let gameplayUserUpdates: any = {};

      // Categorize updates
      if (updates.email) userUpdates.email = updates.email;
      if (updates.password) userUpdates.password = updates.password;
      if (updates.username) userUpdates.username = updates.username;
      if (updates.avatar) userUpdates.avatar = updates.avatar;

      if (updates.money !== undefined) gameplayUserUpdates.money = updates.money;
      if (updates.rankPoints !== undefined) gameplayUserUpdates.rankPoints = updates.rankPoints;
      if (updates.health !== undefined) gameplayUserUpdates.health = updates.health;
      if (updates.isAlive !== undefined) gameplayUserUpdates.isAlive = updates.isAlive;
      if (updates.isLocationActive !== undefined) gameplayUserUpdates.locActive = updates.isLocationActive;

      // Handle password update
      if (updates.password) {
        if (updates.password.length < 8 || !updates.password.match(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&#]{8,}$/)) {
          return res.status(400).json({
            message: "New password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character",
          });
        }
        userUpdates.password = await argon2.hash(updates.password);
      }
  
      // Handle username update
      if (updates.username) {
        if (updates.username.length < 3 || !updates.username.match(/^[a-zA-Z0-9]+$/)) {
          return res.status(400).json({
            message: "New username must be at least 3 characters long and contain only letters and numbers",
          });
        }
        const existingUser = await prisma.users.findUnique({ where: { username: updates.username } });
        if (existingUser) {
          return res.status(409).json({ message: "Username already exists", field: "username" });
        }
      }
  
      // Handle email update
      if (updates.email) {
        if (!updates.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
          return res.status(400).json({ message: "Invalid email address" });
        }
        const existingUser = await prisma.users.findFirst({ where: { email: updates.email } });
        if (existingUser) {
          return res.status(409).json({ message: "Email already in use", field: "email" });
        }
      }
  
      // Update the Users and related tables
      let updatedUser;
      let newToken;
      if (updates.username) {
        // If username is being updated, use a transaction
        updatedUser = await prisma.$transaction(async (prisma) => {
          // First, update the Users table
          const updatedUserRecord = await prisma.users.update({
            where: { username },
            data: userUpdates,
            include: { GameplayUser: true }
          });

          // Update GameplayUser if necessary
          if (Object.keys(gameplayUserUpdates).length > 0) {
            await prisma.gameplayUser.update({
              where: { username },
              data: gameplayUserUpdates,
            });
          }

          // Update BattleSessions
          await prisma.battleSessions.updateMany({
            where: { attackerUsername: username },
            data: { attackerUsername: updatedUserRecord.username },
          });
          
          await prisma.battleSessions.updateMany({
            where: { defenderUsername: username },
            data: { defenderUsername: updatedUserRecord.username },
          });

          // Update friends arrays
          await prisma.users.updateMany({
            where: {
              friends: {
                has: username
              }
            },
            data: {
              friends: {
                set: await prisma.users.findMany({
                  where: { friends: { has: username } },
                  select: { friends: true }
                }).then(users => 
                  users.flatMap(user => 
                    user.friends.map(friend => 
                      friend === username ? updatedUserRecord.username : friend
                    )
                  )
                )
              }
            }
          });

          // Generate a new token with the updated username
          newToken = jwt.sign(
            { username: updatedUserRecord.username, password: decoded.password },
            process.env.JWT_SECRET || ""
          );

          return updatedUserRecord;
        });
      } else {
        // If username is not being updated, proceed as before
        updatedUser = await prisma.users.update({
          where: { username },
          data: userUpdates,
        });
        
        // Update GameplayUser if necessary
        if (Object.keys(gameplayUserUpdates).length > 0) {
          await prisma.gameplayUser.update({
            where: { username },
            data: gameplayUserUpdates,
          });
        }
      }
  
      const response: any = { success: true, message: "User updated successfully", user: updatedUser };
      
      // Include the new token in the response if the username was changed
      if (newToken) {
        response.token = newToken;
      }

      res.status(200).json(response);
    } catch (error) {
      console.error("Failed to edit or delete user:", error);
      res.status(500).json({ success: false, message: "Failed to edit or delete user" });
    }
  });

  app.post("/api/deleteUser", async (req: Request, res: Response) => {
    const { token, username } = req.body;

    if (!token || !username) {
      return res.status(400).json({ success: false, message: "Missing token or username" });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as JwtPayload;

      if (!decoded.username) {
        return res.status(401).json({ message: "Invalid token: username not found" });
      }

      // Check if the user exists
      const user = await prisma.users.findUnique({
        where: { username },
        include: { GameplayUser: true }
      });

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Delete related records in the correct order
      await prisma.$transaction(async (prisma) => {
        // Delete related records in other tables
        await prisma.friendRequests.deleteMany({ where: { username } });
        await prisma.friendRequests.deleteMany({ where: { friend: username } });
        await prisma.battleSessions.deleteMany({ where: { attackerUsername: username } });
        await prisma.battleSessions.deleteMany({ where: { defenderUsername: username } });
        await prisma.inventoryItem.deleteMany({ where: { userId: user.GameplayUser?.id } });
        await prisma.statistics.deleteMany({ where: { userId: user.GameplayUser?.id } });
        await prisma.locations.deleteMany({ where: { username } });
        await prisma.notifications.deleteMany({ where: { userId: username } });

        // Delete the GameplayUser record
        if (user.GameplayUser) {
          await prisma.gameplayUser.delete({ where: { id: user.GameplayUser.id } });
        }

        // Finally, delete the user record
        await prisma.users.delete({ where: { username } });
      });

      res.status(200).json({ success: true, message: "User deleted successfully" });
    } catch (error) {
      console.error("Failed to delete user:", error);
      res.status(500).json({ success: false, message: "Failed to delete user" });
    }
  });
}