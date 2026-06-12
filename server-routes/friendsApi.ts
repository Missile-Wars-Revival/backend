import { Request, Response } from "express";
import { verifyToken } from "../util/auth";
import { ensureLocalUserForToken } from "../util/provisionUser";
import { getCentralFriendUsernames } from "../util/socialStore";
import { prisma } from "../server";
import * as geolib from 'geolib';
import { resolveProfileImageUrls } from "./profileImages";

// Phase 6 social cutover: the friend graph lives in Firebase central
// (/friends/<uid>/<friendUid> uid edges, written by the client under the
// security rules). The shard's Users.friends column is a client-DECLARED
// gameplay cache, written only by the websocket `friendsDeclare` handler.
// The old /api/friends, /api/addFriend, /api/removeFriend and
// /api/searchfriendsadded routes are gone. What remains here is gameplay:
// friendsOnly visibility preference, player search, and proximity.

const visibleUsername = (username: unknown) =>
  typeof username === "string" ? username.replace(/[\s\u200B-\u200D\uFEFF]/g, "") : "";

export async function getFriendUsernames(currentUser: { friends: any; firebaseUID?: string | null; username: string; }): Promise<string[]> {
  const centralFriends = await getCentralFriendUsernames(currentUser.firebaseUID);
  const source = centralFriends ?? currentUser.friends;
  if (!Array.isArray(source)) return [];

  return [...new Set(
    source
      .filter((username): username is string => typeof username === "string")
      .map(visibleUsername)
      .filter((username) => username.length > 0 && username !== currentUser.username)
  )];
}

export async function getMutualFriends(currentUser: { friends: any; firebaseUID?: string | null; username: string; }) {
  const friendUsernames = await getFriendUsernames(currentUser);
  const mutualFriends = [];

  for (const friendUsername of friendUsernames) {
    const friend = await prisma.users.findUnique({
      where: { username: friendUsername },
      select: { friends: true, firebaseUID: true },
    });

    if (!friend) continue;

    const friendCentralFriends = await getCentralFriendUsernames(friend.firebaseUID);
    const friendFriends = friendCentralFriends ?? friend.friends;
    if (Array.isArray(friendFriends) && friendFriends.includes(currentUser.username)) {
      mutualFriends.push(friendUsername);
    }
  }

  return mutualFriends;
}
  
  export function setupFriendsApi(app: any) {
  app.patch("/api/friendsOnlyStatus", async (req: Request, res: Response) => {
    const token = req.query.token;
  
    // Check if token is provided and is a valid string
    if (typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ message: "Token is required and must be a non-empty string." });
    }
  
    try {
      // Verify the token
      const decoded = verifyToken(token);
  
      // Ensure the token contains a username
      if (typeof decoded === 'string' || !decoded.username) {
        return res.status(401).json({ message: "Invalid token" });
      }
  
      // Check if friendsOnly status is provided in the request body
      if (typeof req.body.friendsOnly !== 'boolean') {
        return res.status(400).json({ message: "friendsOnly status must be provided and be a boolean." });
      }
  
      const localUser = await ensureLocalUserForToken(decoded);
      if (!localUser || !localUser.GameplayUser) {
        return res.status(404).json({ message: "User not found" });
      }

      // Update the friendsOnly status in the GameplayUser table
      const updatedUser = await prisma.gameplayUser.update({
        where: {
          username: decoded.username
        },
        data: {
          friendsOnly: req.body.friendsOnly
        }
      });
  
      // Return the updated user info
      res.status(200).json({
        message: "friendsOnly status updated successfully",
        user: {
          username: updatedUser.username,
          friendsOnly: updatedUser.friendsOnly
        }
      });
    } catch (error) {
      console.error("Error updating friendsOnly status:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  
  app.get("/api/searchplayers", async (req: Request, res: Response) => {
    const { token, searchTerm, debugSearch } = req.query;
  
    if (typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ message: "Token is required and must be a non-empty string." });
    }
  
    if (typeof searchTerm !== 'string') {
      return res.status(400).json({ message: "Search term is required and must be a string." });
    }
  
    try {
      // Verify the token
      const decoded = verifyToken(token);
      if (typeof decoded === 'string' || !decoded.username) {
        return res.status(401).json({ message: "Invalid token" });
      }
  
      const normalizedSearchTerm = searchTerm.trim();
      if (!normalizedSearchTerm) {
        return res.status(200).json([]);
      }

      const currentUser = await ensureLocalUserForToken(decoded);
  
      if (!currentUser) {
        return res.status(404).json({ message: "User not found" });
      }
  
      const friendUsernames = await getFriendUsernames(currentUser);
      const excludedUsernames = new Set(
        [decoded.username, ...friendUsernames]
          .filter((username): username is string => typeof username === "string")
          .map((username) => visibleUsername(username).toLowerCase())
          .filter(Boolean)
      );
      const friendsToExclude = friendUsernames.filter(
        (username: string) => visibleUsername(username).length > 0
      );

      // Fetch users whose usernames contain the search term
      const users = await prisma.users.findMany({
        where: {
          AND: [
            {
              username: {
                contains: normalizedSearchTerm,
                mode: 'insensitive' // This makes the search case-insensitive
              }
            },
            {
              username: {
                not: decoded.username, // Exclude the current user
                notIn: friendsToExclude // Exclude friends
              }
            },
            // Exclude blank/ghost accounts: rows with an empty username or
            // without a GameplayUser (never finished registration / partially
            // deleted) aren't real players and rendered as empty results.
            { username: { not: "" } },
            { GameplayUser: { isNot: null } }
          ]
        },
        select: {
          username: true,
          updatedAt: true,
        },
      });

      const searchableUsers = users.filter((user: { username: string }) => {
        const username = visibleUsername(user.username);
        return username.length > 0 && !excludedUsernames.has(username.toLowerCase());
      });

      if (debugSearch === "true") {
        console.info("[searchplayers]", {
          currentUser: decoded.username,
          searchTerm: normalizedSearchTerm,
          friendsExcluded: friendsToExclude.length,
          dbRows: users.map((u: { username: string }) => u.username),
          returnedRows: searchableUsers.map((u: { username: string }) => u.username),
        });
      }

      const imageUrls = await resolveProfileImageUrls(
        searchableUsers.map((u: { username: string }) => u.username)
      );
      const usersWithImages = searchableUsers.map((u: { username: string; updatedAt: Date }) => ({
        username: u.username,
        updatedAt: u.updatedAt,
        profileImageUrl: imageUrls[u.username] ?? null,
      }));

      res.status(200).json(usersWithImages);
    } catch (error) {
      console.error("Error fetching user data:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  
  app.get("/api/nearby", async (req: Request, res: Response) => {
    const token = req.query.token as string;
    const latitude = parseFloat(req.query.latitude as string);
    const longitude = parseFloat(req.query.longitude as string);
  
    if (!token || !token.trim()) {
      return res.status(400).json({ message: "Token is required and must be a non-empty string." });
    }
  
    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({ message: "Valid latitude and longitude are required." });
    }
  
    try {
      const decoded = verifyToken(token);
      if (typeof decoded === 'string' || !decoded.username) {
        return res.status(401).json({ message: "Invalid token. Token must contain a username." });
      }
  
      const mainUser = await ensureLocalUserForToken(decoded);
  
      if (!mainUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const friendUsernames = await getFriendUsernames(mainUser);
  
      const radiusInMeters = 15000; // 15 km
  
      // Fetch nearby users
      const nearbyUsers = await prisma.gameplayUser.findMany({
        where: {
          AND: [
            { username: { not: { equals: decoded.username } } }, // Exclude self
            { username: { not: { in: friendUsernames } } }, // Exclude friends
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
      const filteredNearbyUsers = nearbyUsers.filter((user: { Locations: any; }) => {
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
    } catch (error) {
      console.error("Error processing request:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });
}
