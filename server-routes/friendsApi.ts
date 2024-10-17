import { Request, Response } from "express";
import { prisma } from "../server";
import { sendNotification } from "../runners/notificationhelper";
import * as geolib from 'geolib';
import { verifyToken } from "../utils/jwt";
import { z } from "zod";
import { handleAsync } from "../utils/router";

export async function getMutualFriends(currentUser: { friends: any; username: string; }) {
  const mutualFriends = [];

  // Fetch each friend and check if they also have currentUser in their friends list
  for (const friendUsername of currentUser.friends) {
    const friend = await prisma.users.findUnique({
      where: { username: friendUsername }
    });

    if (friend && friend.friends.includes(currentUser.username)) {
      mutualFriends.push(friendUsername);
    }
  }

  return mutualFriends;
}
  
export function setupFriendsApi(app: any) {
  const FriendsOnlyStatusQuerySchema = z.object({
    token: z.string()
  })
  const FriendsOnlyStatusBodySchema = z.object({
    friendsOnly: z.boolean()
  })
  app.patch("/api/friendsOnlyStatus", handleAsync(async (req: Request, res: Response) => {
    const { token } = await FriendsOnlyStatusQuerySchema.parseAsync(req.query)
    const { friendsOnly } = await FriendsOnlyStatusBodySchema.parseAsync(req.body)
  
    const claims = await verifyToken(token)

    // Update the friendsOnly status in the GameplayUser table
    const updatedUser = await prisma.gameplayUser.update({
      where: {
        username: claims.username
      },
      data: {
        friendsOnly: friendsOnly
      }
    });

    // If no user is found or updated, send a 404 error
    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Return the updated user info
    res.status(200).json({
      message: "friendsOnly status updated successfully",
      user: {
        username: updatedUser.username,
        friendsOnly: updatedUser.friendsOnly
      }
    });
  }));
  
  const SearchPlayersSchema = z.object({
    token: z.string(),
    searchTerm: z.string().min(1)
  })
  app.get("/api/searchplayers", handleAsync(async (req: Request, res: Response) => {
    const { token, searchTerm } = await SearchPlayersSchema.parseAsync(req.query);
  
    // Verify the token
    const claims = await verifyToken(token)

    // Fetch the current user to get their friends list
    const currentUser = await prisma.users.findUnique({
      where: { username: claims.username },
      select: { friends: true }
    });

    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Fetch users whose usernames contain the search term
    const users = await prisma.users.findMany({
      where: {
        AND: [
          {
            username: {
              contains: searchTerm,
              mode: "insensitive" // This makes the search case-insensitive
            }
          },
          {
            username: {
              not: claims.username, // Exclude the current user
              notIn: currentUser.friends // Exclude friends
            }
          }
        ]
      },
      select: {
        username: true,
        updatedAt: true,
      },
    });

    res.status(200).json(users);
  }));
  
  const SearchFriendsAddedSchema = z.object({
    token: z.string(),
    searchTerm: z.string()
  })
  app.get("/api/searchfriendsadded", handleAsync(async (req: Request, res: Response) => {
    const { token, searchTerm } = await SearchFriendsAddedSchema.parseAsync(req.query);
  
    const claims = await verifyToken(token)

    // Fetch the current user to get their friends list
    const currentUser = await prisma.users.findUnique({
      where: { username: claims.username },
      select: { friends: true }
    });

    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Fetch all users that the current user has added as friends
    const addedFriends = await prisma.users.findMany({
      where: {
        username: {
          in: currentUser.friends,
          ...(searchTerm && typeof searchTerm === 'string'
            ? { contains: searchTerm, mode: 'insensitive' }
            : {})
        }
      },
      select: {
        username: true,
        friends: true,
        updatedAt: true,
      },
    });

    // Filter out mutual friends
    const nonMutualFriends = addedFriends.filter(friend => !friend.friends.includes(claims.username));

    // Format the response to only include username and updatedAt
    const formattedFriends = nonMutualFriends.map(({ username, updatedAt }) => ({ username, updatedAt }));

    res.status(200).json(formattedFriends);
  }));
  
  const NearbySchema = z.object({
    token: z.string(),
    latitude: z.coerce.number(),
    longitude: z.coerce.number(),
  })
  app.get("/api/nearby", handleAsync(async (req: Request, res: Response) => {
    const { token, latitude, longitude } = await NearbySchema.parseAsync(req.query)
  
    const claims = await verifyToken(token)

    // Fetch the main user object to get access to the friends list
    const mainUser = await prisma.users.findUnique({
      where: {
        username: claims.username,
      },
      select: { friends: true }
    });

    if (!mainUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const radiusInMeters = 15000; // 15 km

    // Fetch nearby users
    const nearbyUsers = await prisma.gameplayUser.findMany({
      where: {
        AND: [
          { username: { not: { equals: claims.username } } }, // Exclude self
          { username: { not: { in: mainUser.friends } } }, // Exclude friends
          { friendsOnly: false }, // Only include users with friendsOnly set to false
          {
            Locations: {
              latitude: { not: { equals: '' } },
              longitude: { not: { equals: '' } }
            }
          }
        ]
      },
      include: {
        Locations: true // Include the location data
      }
    });

    // Filter results using precise distance calculation
    const filteredNearbyUsers = nearbyUsers.filter(user => {
      const userLoc = user.Locations;
      if (!userLoc) return false;

      const userLatitude = parseFloat(userLoc.latitude);
      const userLongitude = parseFloat(userLoc.longitude);

      if (isNaN(userLatitude) || isNaN(userLongitude)) return false;

      const distance = geolib.getDistance(
        { latitude, longitude },
        { latitude: userLatitude, longitude: userLongitude }
      );

      return distance <= radiusInMeters;
    });

    if (filteredNearbyUsers.length > 0) {
      res.status(200).json({ message: "Nearby users found", nearbyUsers: filteredNearbyUsers });
    } else {
      res.status(404).json({ message: "No nearby users found" });
    }
  }));

  //pending removal
  const FriendsSchema = z.object({
    token: z.string()
  })
  app.get("/api/friends", handleAsync(async (req: Request, res: Response) => {
    const { token } = await FriendsSchema.parseAsync(req.query);
  
    const claims = await verifyToken(token);

    const user = await prisma.users.findUnique({
      where: {
        username: claims.username,
      },
      select: {
        friends: true // Just retrieve the friends array
      }
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const friendsProfiles = user.friends.length > 0 ?
      await prisma.users.findMany({
        where: {
          username: {
            in: user.friends,
          },
          friends: {
            has: claims.username // Check if these users also have the current user in their friends list (mutal friends)
          }
        },
      }) :
      [];
    
    res.status(200).json({ friends: friendsProfiles });
  }));
  
  const AddFriendSchema = z.object({
    token: z.string(),
    friend: z.string()
  })
  app.post("/api/addFriend", handleAsync(async (req: Request, res: Response) => {
    const { token, friend } = await AddFriendSchema.parseAsync(req.body);
  
    const claims = await verifyToken(token)

    const user = await prisma.users.findFirst({
      where: { username: claims.username },
    });

    if (!user) {
      console.log("User not found");
      return res.status(404).json({ message: "User not found" });
    }

    const friendUser = await prisma.users.findFirst({
      where: { username: friend },
    });

    if (!friendUser) {
      return res.status(404).json({ message: "Friend not found" });
    }

    if (user.friends.includes(friend)) {
      console.log("Friend already added");
      return res.status(409).json({ message: "Friend already added" });
    }

    // Check if the friend has already added the user
    const isMutualFriend = friendUser.friends.includes(user.username);

    // Add friend
    await prisma.users.update({
      where: { username: user.username },
      data: { friends: { push: friend } },
    });

    // Send appropriate notification
    if (isMutualFriend) {
      await sendNotification(friend, "Friend Accepted", `${user.username} has added you back!`, user.username);
    } else {
      await sendNotification(friend, "Friend Request", `${user.username} has added you as a friend!`, user.username);
    }

    console.log("Friend added");
    res.status(200).json({ message: "Friend added successfully" });
  }));
  
  const RemoveFriendSchema = z.object({
    token: z.string(),
    friend: z.string()
  })
  app.delete("/api/removeFriend", handleAsync(async (req: Request, res: Response) => {
    const { token, friend } = await RemoveFriendSchema.parseAsync(req.body);

    const claims = await verifyToken(token);

    const user = await prisma.users.findFirst({
      where: {
        username: claims.username,
      },
    });

    if (!user) {
      console.log("user not found")
      return res.status(404).json({ message: "User not found" });
    }

    const friendUser = await prisma.users.findFirst({
      where: {
        username: friend,
      },
    });

    if (!friendUser) {
      return res.status(404).json({ message: "Friend not found" });
    }

    await prisma.users.update({
      where: {
        username: user.username,
      },
      data: {
        friends: {
          set: user.friends.filter((f: any) => f !== friend),
        },
      },
    });
    res.status(200).json({ message: "Friend removed successfully" });
  }));
}