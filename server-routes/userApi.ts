import * as jwt from "jsonwebtoken";
import { prisma } from "../server";
import { Request, Response } from "express";
import { getMutualFriends } from "./friendsApi";
import { JwtPayload } from "jsonwebtoken";
import * as argon2 from "argon2";
import * as admin from 'firebase-admin';

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

  app.patch("/api/randomLocation", async (req: Request, res: Response) => {
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

      if (typeof req.body.randomLocation !== 'boolean') {
        return res.status(400).json({ message: "randomLocation status must be provided and be a boolean." });
      }

      const updatedUser = await prisma.gameplayUser.update({
        where: {
          username: decoded.username
        },
        data: {
          randomLocation: req.body.randomLocation
        },
        select: {
          username: true,
          randomLocation: true
        }
      });

      console.log("Updated user:", updatedUser);

      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      res.status(200).json({
        message: "randomLocation status updated successfully",
        user: updatedUser
      });
    } catch (error) {
      console.error("Error updating randomLocation status:", error);
      if (error instanceof jwt.JsonWebTokenError) {
        return res.status(401).json({ message: "Invalid token" });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/getrandomLocation", async (req: Request, res: Response) => {
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
          randomLocation: true
        }
      });

      console.log("Retrieve user:", user);

      if (user) {
        console.log("Sending randomLocation value:", user.randomLocation);
        res.status(200).json({ randomLocation: user.randomLocation });
      } else {
        res.status(404).json({ message: "User not found" });
      }
    } catch (error) {
      console.error("Error in getrandomLocation:", error);
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

    if (typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ message: "Token is required and must be a non-empty string." });
    }

    if (!updates) {
      return res.status(400).json({ message: "Updates are required." });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as { username: string, password: string };
      if (typeof decoded === 'string' || !decoded.username) {
        return res.status(401).json({ message: "Invalid token" });
      }

      if (username !== decoded.username) {
        return res.status(403).json({ message: "Not allowed to edit this user" });
      }

      const user = await prisma.users.findUnique({ where: { username: decoded.username } });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (updates.deleteAccount === true) {
        // Perform user deletion
        try {
          // Delete related records first
          await prisma.$transaction(async (prisma) => {
            // Delete Notifications
            await prisma.notifications.deleteMany({ where: { userId: username } });

            // Delete FriendRequests
            await prisma.friendRequests.deleteMany({ where: { username: username } });
            await prisma.friendRequests.deleteMany({ where: { friend: username } });

            // Delete Locations
            await prisma.locations.delete({ where: { username: username } }).catch(() => { });

            // Delete InventoryItems
            await prisma.inventoryItem.deleteMany({ where: { GameplayUser: { username: username } } });

            // Delete Statistics
            await prisma.statistics.deleteMany({ where: { GameplayUser: { username: username } } });

            // Delete GameplayUser
            await prisma.gameplayUser.delete({ where: { username: username } }).catch(() => { });

            // Finally, delete the User
            await prisma.users.delete({ where: { username: username } });
          });

          console.log(`Successfully deleted ${username}`);

          // Delete user data from Firebase
          const db = admin.database();
          const storageRef = admin.storage().bucket();

          // Delete user data from Firebase Realtime Database
          await db.ref(`users/${user.username}`).remove();

          // Delete profile picture from Firebase Storage
          const filePath = `profileImages/${user.username}`;
          try {
            await storageRef.file(filePath).delete();
          } catch (error) {
            console.log(`No profile picture found for user ${user.username}`);
          }

          // Remove user from conversations in Firebase Realtime Database
          const conversationsRef = db.ref('conversations');
          const conversationsSnapshot = await conversationsRef.once('value');
          const conversations = conversationsSnapshot.val();

          if (conversations) {
            for (const [convId, conv] of Object.entries(conversations)) {
              const conversation = conv as any;
              if (conversation.participants && conversation.participants[user.username]) {
                delete conversation.participants[user.username];
                if (conversation.participantsArray) {
                  conversation.participantsArray = conversation.participantsArray.filter((p: string) => p !== user.username);
                }
                await conversationsRef.child(convId).set(conversation);
              }
            }
          }

          return res.status(200).json({ message: "User account deleted successfully" });
        } catch (error) {
          console.error(`Failed to delete user ${username}:`, error);
          return res.status(500).json({ message: "Failed to delete user account" });
        }
      }

      // If not deleting, proceed with the existing update logic
      const userUpdates: any = {};
      const gameplayUserUpdates: any = {};

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

        try {
          const firebaseUser = await admin.auth().getUserByEmail(user.email);
          await admin.auth().deleteUser(firebaseUser.uid);
        } catch (firebaseError) {
          console.error("Error updating password in Firebase:", firebaseError);
        }
      }

      // Handle email update
      if (updates.email) {
        if (!updates.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
          return res.status(400).json({ message: "Invalid email address" });
        }
      }

      // Handle username update
      const newUsername = updates.username;
      if (updates.username) {
        if (newUsername.length < 3 || !newUsername.match(/^[a-zA-Z0-9]+$/)) {
          return res.status(400).json({
            message: "New username must be at least 3 characters long and contain only letters and numbers",
          });
        }

        // Check if the new username already exists (case-insensitive)
        const existingUser = await prisma.users.findFirst({
          where: {
            username: {
              equals: newUsername,
              mode: 'insensitive',
            },
          },
        });

        if (existingUser) {
          return res.status(409).json({ message: "Username already exists" });
        }
      }

      // Perform the updates in a transaction
      await prisma.$transaction(async (prisma) => {
        // Update the Users table
        const updatedUser = await prisma.users.update({
          where: { username: username },
          data: userUpdates,
        });

        // Update the GameplayUser table
        if (Object.keys(gameplayUserUpdates).length > 0) {
          await prisma.gameplayUser.update({
            where: { username: updatedUser.username },
            data: gameplayUserUpdates,
          });
        }

        // Update Firebase if username is changed
        if (updates.username) {
          const db = admin.database();
          const storageRef = admin.storage().bucket();

          try {
            // Update user data in Firebase Realtime Database
            const userRef = db.ref(`users/${username}`);
            const userSnapshot = await userRef.once('value');
            const userData = userSnapshot.val();
            if (userData) {
              await db.ref(`users/${newUsername}`).set(userData);
              await userRef.remove();
            }

            // Update conversations in Firebase Realtime Database
            const conversationsRef = db.ref('conversations');
            const conversationsSnapshot = await conversationsRef.once('value');
            const conversations = conversationsSnapshot.val();

            if (conversations) {
              for (const [convId, conv] of Object.entries(conversations)) {
                let updated = false;
                const conversation = conv as any;

                // Update participants
                if (conversation.participants && conversation.participants[username]) {
                  conversation.participants[updates.username] = conversation.participants[username];
                  delete conversation.participants[username];
                  updated = true;
                }

                // Update participantsArray
                if (conversation.participantsArray) {
                  const index = conversation.participantsArray.indexOf(username);
                  if (index !== -1) {
                    conversation.participantsArray[index] = updates.username;
                    updated = true;
                  }
                }

                // Update lastMessage if necessary
                if (conversation.lastMessage && conversation.lastMessage.senderId === username) {
                  conversation.lastMessage.senderId = updates.username;
                  updated = true;
                }

                if (updated) {
                  await conversationsRef.child(convId).set(conversation);
                }
              }
            } else {
              console.log('No conversations found in the database');
            }

            // Update profile picture in Firebase Storage
            const oldFilePath = `profileImages/${username}`;
            const newFilePath = `profileImages/${newUsername}`;
            try {
              const [fileExists] = await storageRef.file(oldFilePath).exists();
              if (fileExists) {
                await storageRef.file(oldFilePath).copy(newFilePath);
                await storageRef.file(oldFilePath).delete();
              } else {
                console.log(`No profile picture found for user ${username}`);
              }
            } catch (error) {
              console.error("Error updating profile picture in Firebase:", error);
              // Decide whether to throw this error or handle it gracefully
              // throw error; // Uncomment this line if you want to trigger a transaction rollback
            }

          } catch (error) {
            console.error("Error updating Firebase:", error);
            throw error; // Rethrow the error to trigger a transaction rollback
          }
        }
      });

      // Generate a new token with the updated username and password (if changed)
      const newToken = jwt.sign(
        {
          username: updates.username || username,
          password: updates.password ? userUpdates.password : user.password
        },
        process.env.JWT_SECRET || ""
      );

      res.status(200).json({
        message: "User updated successfully",
        token: newToken
      });
    } catch (error) {
      console.error("User operation failed:", error);
      res.status(500).json({ message: "Failed to perform user operation" });
    }
  });
}