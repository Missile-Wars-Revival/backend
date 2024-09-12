import { Request, Response } from "express";
import * as jwt from "jsonwebtoken";
import { prisma } from "../server";
import { sendNotification } from "../runners/notificationhelper";
import * as geolib from 'geolib';

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
  app.patch("/api/friendsOnlyStatus", async (req: Request, res: Response) => {
    const token = req.query.token;
  
    // Check if token is provided and is a valid string
    if (typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ message: "Token is required and must be a non-empty string." });
    }
  
    try {
      // Verify the token
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
  
      // Ensure the token contains a username
      if (typeof decoded === 'string' || !decoded.username) {
        return res.status(401).json({ message: "Invalid token" });
      }
  
      // Check if friendsOnly status is provided in the request body
      if (typeof req.body.friendsOnly !== 'boolean') {
        return res.status(400).json({ message: "friendsOnly status must be provided and be a boolean." });
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
    } catch (error) {
      console.error("Error updating friendsOnly status:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  
  app.get("/api/searchplayers", async (req: Request, res: Response) => {
    const { token, searchTerm } = req.query;
  
    if (typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ message: "Token is required and must be a non-empty string." });
    }
  
    if (typeof searchTerm !== 'string') {
      return res.status(400).json({ message: "Search term is required and must be a string." });
    }
  
    try {
      // Verify the token
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
      if (typeof decoded === 'string' || !decoded.username) {
        return res.status(401).json({ message: "Invalid token" });
      }
  
      // Fetch the current user to get their friends list
      const currentUser = await prisma.users.findUnique({
        where: { username: decoded.username },
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
                mode: 'insensitive' // This makes the search case-insensitive
              }
            },
            {
              username: {
                not: decoded.username, // Exclude the current user
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
    } catch (error) {
      console.error("Error fetching user data:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  
  app.get("/api/searchfriendsadded", async (req: Request, res: Response) => {
    const { token, searchTerm } = req.query;
  
    if (typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ message: "Token is required and must be a non-empty string." });
    }
  
    try {
      // Verify the token
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
      if (typeof decoded === 'string' || !decoded.username) {
        return res.status(401).json({ message: "Invalid token" });
      }
  
      // Fetch the current user to get their friends list
      const currentUser = await prisma.users.findUnique({
        where: { username: decoded.username },
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
      const nonMutualFriends = addedFriends.filter(friend => !friend.friends.includes(decoded.username));
  
      // Format the response to only include username and updatedAt
      const formattedFriends = nonMutualFriends.map(({ username, updatedAt }) => ({ username, updatedAt }));
  
      res.status(200).json(formattedFriends);
    } catch (error) {
      console.error("Error fetching added friends:", error);
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
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
      if (typeof decoded === 'string' || !decoded.username) {
        return res.status(401).json({ message: "Invalid token. Token must contain a username." });
      }
  
      // Fetch the main user object to get access to the friends list
      const mainUser = await prisma.users.findUnique({
        where: {
          username: decoded.username,
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
            { username: { not: { equals: decoded.username } } }, // Exclude self
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
    } catch (error) {
      console.error("Error processing request:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });
  //pending removal
  app.get("/api/friends", async (req: Request, res: Response) => {
    const token = req.query.token;
  
    if (typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ message: "Token is required and must be a non-empty string." });
    }
  
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
  
      if (typeof decoded === 'string' || !decoded.username) {
        return res.status(401).json({ message: "Invalid token" });
      }
  
      const user = await prisma.users.findUnique({
        where: {
          username: decoded.username,
        },
        select: {
          friends: true // Just retrieve the friends array
        }
      });
  
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
  
      if (user.friends.length > 0) {
        // Fetch full profiles of friends who also have this user in their friends list
        const friendsProfiles = await prisma.users.findMany({
          where: {
            username: {
              in: user.friends,
            },
            friends: {
              has: decoded.username // Check if these users also have the current user in their friends list (mutal friends)
            }
          },
        });
  
        res.status(200).json({ friends: friendsProfiles });
      } else {
        res.status(200).json({ friends: [] });
      }
    } catch (error) {
      console.error("Error verifying token or fetching friends:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  
  app.post("/api/addFriend", async (req: Request, res: Response) => {
    const { token, friend } = req.body;
  
    if (typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ message: "Token is required and must be a non-empty string." });
    }
  
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as { username: string; };
      if (!decoded.username) {
        return res.status(401).json({ message: "Invalid token: Username is missing." });
      }
  
      const user = await prisma.users.findFirst({
        where: { username: decoded.username },
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
    } catch (error) {
      console.error("Error processing request:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });
  
  app.delete("/api/removeFriend", async (req: Request, res: Response) => {
    const { token, friend } = req.body;
  
    if (typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ message: "Token is required and must be a non-empty string." });
    }
  
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as { username: string; };
      if (!decoded.username) {
        return res.status(401).json({ message: "Invalid token: Username is missing." });
      }
  
      const user = await prisma.users.findFirst({
        where: {
          username: decoded.username,
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
      res.status(200).json({ message: "Friend removed successfully" }); // Corrected response message
    } catch (error) {
      console.error("Error processing request:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });
}