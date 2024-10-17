import { prisma } from "../server";
import { Request, Response } from "express";
import { getMutualFriends } from "./friendsApi";
import * as argon2 from "argon2";
import * as admin from 'firebase-admin';
import { signToken, verifyToken } from "../utils/jwt";
import { z } from "zod";
import { handleAsync } from "../utils/router";
import { emailSchema } from "../utils/schema";

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
  const UserProfileSchema = z.object({
    token: z.string(),
    username: z.string()
  })
  app.get("/api/user-profile", handleAsync(async (req: Request, res: Response) => {
    const { token, username } = await UserProfileSchema.parseAsync(req.body);

    const claims = await verifyToken(token);

    const [requestingUser, targetUser] = await Promise.all([
      prisma.users.findUnique({
        where: { username: claims.username },
        include: { GameplayUser: true }
      }),
      prisma.users.findUnique({
        where: { username: username },
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
  }));

  const SelfProfileSchema = z.object({
    token: z.string()
  })
  app.get("/api/self-profile", handleAsync(async (req: Request, res: Response) => {
    const { token } = await SelfProfileSchema.parseAsync(req.body);

    const claims = await verifyToken(token);

    const user = await prisma.users.findUnique({
      where: { username: claims.username },
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
  }));

  // TODO: Add token to this api ?
  const GetUserSchema = z.object({
    username: z.string()
  })
  app.get("/api/getuser", handleAsync(async (req: Request, res: Response) => {
    const { username } = await GetUserSchema.parseAsync(req.query);
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

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({ ...fmtUser });
  }));

  const LocActiveBodySchema = z.object({
    locActive: z.boolean()
  })
  const LocActiveQuerySchema = z.object({
    token: z.string()
  })
  app.patch("/api/locActive", handleAsync(async (req: Request, res: Response) => {
    const { token } = await LocActiveQuerySchema.parseAsync(req.body);
    const { locActive } = await LocActiveBodySchema.parseAsync(req.body);

    const claims = await verifyToken(token);

    const updatedUser = await prisma.gameplayUser.update({
      where: {
        username: claims.username
      },
      data: {
        locActive: locActive
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
  }));

  const RandomLocationQuerySchema = z.object({
    token: z.string()
  })
  const RandomLocationBodySchema = z.object({
    randomLocation: z.boolean()
  })
  app.patch("/api/randomLocation", handleAsync(async (req: Request, res: Response) => {
    const { token } = await RandomLocationQuerySchema.parseAsync(req.query);
    const { randomLocation } = await RandomLocationBodySchema.parseAsync(req.body)

    const claims = await verifyToken(token);

    const updatedUser = await prisma.gameplayUser.update({
      where: {
        username: claims.username
      },
      data: {
        randomLocation: randomLocation
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
  }));

  const GetRandomLocationSchema = z.object({
    token: z.string()
  })
  app.get("/api/getrandomLocation", handleAsync(async (req: Request, res: Response) => {
    const { token } = await GetRandomLocationSchema.parseAsync(req.query);

    const claims = await verifyToken(token);

    const user = await prisma.gameplayUser.findUnique({
      where: {
        username: claims.username
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
  }));

  const GetLocActiveSchema = z.object({
    token: z.string()
  })
  app.get("/api/getlocActive", handleAsync(async (req: Request, res: Response) => {
    const { token } = await GetLocActiveSchema.parseAsync(req.query);

    const claims = await verifyToken(token);

    const user = await prisma.gameplayUser.findUnique({
      where: {
        username: claims.username
      },
      select: {
        username: true,
        locActive: true
      }
    });

    console.log("Retrieve user:", user);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    console.log("Sending locActive value:", user.locActive);
    res.status(200).json({ locActive: user.locActive });
  }));

  const EditUserSchema = z.object({
    token: z.string(),
    username: z.string(),
    updates: z.object({
      deleteAccount: z.boolean().default(false),

      email: z.string().optional(),
      password: z.string().optional(),
      username: z.string().optional(),
      avatar: z.string().optional(),

      money: z.number().int().positive().optional(),
      rankPoints: z.number().int().positive().optional(),
      health: z.number().int().min(0).max(100).optional(),
      isAlive: z.boolean().optional(),
      isLocationActive: z.boolean().optional()
    })
  })
  app.post("/api/editUser", handleAsync(async (req: Request, res: Response) => {
    const { token, username: _username, updates } = await EditUserSchema.parseAsync(req.body);

    const claims = await verifyToken(token);

    if (_username !== claims.username) {
      return res.status(403).json({ message: "Not allowed to edit this user" });
    }

    const user = await prisma.users.findUnique({ where: { username: claims.username } });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (updates.deleteAccount === true) {
      // Perform user deletion
      try {
        // Delete related records first
        await prisma.$transaction(async (prisma) => {
          // Delete Notifications
          await prisma.notifications.deleteMany({ where: { userId: claims.username } });

          // Delete FriendRequests
          await prisma.friendRequests.deleteMany({ where: { username: claims.username } });
          await prisma.friendRequests.deleteMany({ where: { friend: claims.username } });

          // Delete Locations
          await prisma.locations.delete({ where: { username: claims.username } }).catch(() => { });

          // Delete InventoryItems
          await prisma.inventoryItem.deleteMany({ where: { GameplayUser: { username: claims.username } } });

          // Delete Statistics
          await prisma.statistics.deleteMany({ where: { GameplayUser: { username: claims.username } } });

          // Delete GameplayUser
          await prisma.gameplayUser.delete({ where: { username: claims.username } }).catch(() => { });

          // Finally, delete the User
          await prisma.users.delete({ where: { username: claims.username } });
        });

        console.log(`Successfully deleted ${claims.username}`);

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
        console.error(`Failed to delete user ${claims.username}:`, error);
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
        // TODO: wth ? why delete user when changing password ?
        await admin.auth().deleteUser(firebaseUser.uid);
      } catch (firebaseError) {
        console.error("Error updating password in Firebase:", firebaseError);
      }
    }

    // Handle email update
    if (updates.email) {
      try {
        await emailSchema.parseAsync(updates.email)
      } catch {
        return res.status(400).json({ message: "Invalid email address" });
      }
    }

    // Handle username update
    if (updates.username) {
      if (updates.username.length < 3 || !updates.username.match(/^[a-zA-Z0-9]+$/)) {
        return res.status(400).json({
          message: "New username must be at least 3 characters long and contain only letters and numbers",
        });
      }

      // Check if the new username already exists (case-insensitive)
      const existingUser = await prisma.users.findFirst({
        where: {
          username: {
            equals: updates.username,
            mode: "insensitive",
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
        where: { username: claims.username },
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
          const userRef = db.ref(`users/${claims.username}`);
          const userSnapshot = await userRef.once('value');
          const userData = userSnapshot.val();
          if (userData) {
            await db.ref(`users/${updates.username}`).set(userData);
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
              if (conversation.participants && conversation.participants[claims.username]) {
                conversation.participants[updates.username] = conversation.participants[claims.username];
                delete conversation.participants[claims.username];
                updated = true;
              }

              // Update participantsArray
              if (conversation.participantsArray) {
                const index = conversation.participantsArray.indexOf(claims.username);
                if (index !== -1) {
                  conversation.participantsArray[index] = updates.username;
                  updated = true;
                }
              }

              // Update lastMessage if necessary
              if (conversation.lastMessage && conversation.lastMessage.senderId === claims.username) {
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
          const oldFilePath = `profileImages/${claims.username}`;
          const newFilePath = `profileImages/${updates.username}`;
          try {
            const [fileExists] = await storageRef.file(oldFilePath).exists();
            if (fileExists) {
              await storageRef.file(oldFilePath).copy(newFilePath);
              await storageRef.file(oldFilePath).delete();
            } else {
              console.log(`No profile picture found for user ${claims.username}`);
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
    const newToken = await signToken({ username: updates.username ?? claims.username })

    res.status(200).json({
      message: "User updated successfully",
      token: newToken
    });
  }));
}