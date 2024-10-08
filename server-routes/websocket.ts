import { Request } from "express";
import { ParamsDictionary } from "express-serve-static-core";
import * as jwt from "jsonwebtoken";
import * as middleearth from "middle-earth";
import { prisma } from "../server";
import { getMutualFriends } from "./friendsApi";
import { aiBots } from "../bots";
import { Missile, Loot, Other, Landmine } from "middle-earth"; // Adjust the import path as needed

function logVerbose(...items: any[]) {
  // Logs an item only if the VERBOSE_MODE env variable is set
  if (process.env.VERBOSE_MODE === "ON") {
    console.log(...items);
  }
}

interface AuthResult {
  success: boolean;
  username?: string;
}

function authenticate(
  ws: import("ws"),
  req: Request<ParamsDictionary, any, any, any, Record<string, any>>
): AuthResult {
  // Use query parameters for token instead of sec-websocket-protocol
  const authToken = req.url ? new URL(req.url, 'http://localhost').searchParams.get('token') : undefined;

  if (!authToken) {
    console.log("Authentication failed. Token is missing.");
    return { success: false };
  }

  try {
    const decoded = jwt.verify(authToken, process.env.JWT_SECRET || "") as { username: string; };

    if (!decoded.username) {
      console.log("Invalid token: Username is missing.");
      return { success: false };
    }

    console.log(`Authentication successful for user: ${decoded.username}`);
    return { success: true, username: decoded.username };
  } catch (error) {
    console.log("Authentication failed. Invalid token.", error);
    return { success: false };
  }
}

interface CacheData {
  missiles: Missile[];
  loot: Loot[];
  other: Other[];
  landmines: Landmine[];
  users: Map<string, any>; // Consider using a more specific type for user data
  lastUpdate: number;
}

export function setupWebSocket(app: any) {
  // Create a cache object with explicit typing
  const cache: CacheData = {
    missiles: [],
    loot: [],
    other: [],
    landmines: [],
    users: new Map(),
    lastUpdate: 0,
  };

  // Set up a cache refresh interval (e.g., every 5 seconds)
  const CACHE_REFRESH_INTERVAL = 10000;

  async function refreshCache() {
    const now = Date.now();
    if (now - cache.lastUpdate < CACHE_REFRESH_INTERVAL) {
      return;
    }

    // Fetch and process all the data
    const [allMissiles, allLoot, allOther, allLandmines] = await Promise.all([
      prisma.missile.findMany(),
      prisma.loot.findMany(),
      prisma.other.findMany(),
      prisma.landmine.findMany(),
    ]);

    cache.missiles = allMissiles.map(missile => middleearth.Missile.from_db(missile));
    cache.loot = allLoot.map(loot => middleearth.Loot.from_db(loot));
    cache.other = allOther.map(other => middleearth.Other.from_db(other));
    cache.landmines = allLandmines.map(landmine => middleearth.Landmine.from_db(landmine));

    cache.lastUpdate = now;
  }

  app.ws("/", (ws: any, req: Request) => {
    const authResult = authenticate(ws, req);

    if (!authResult.success || !authResult.username) {
      console.log("Connection attempted but authentication failed");
      ws.close(1008, "Authentication failed");
      return;
    }

    const username = authResult.username;
    console.log(`WebSocket connection established for user: ${username}`);

    logVerbose("New connection established");

    const sendPeriodicData = async () => {
      await refreshCache();

      const currentUser = await prisma.users.findUnique({
        where: { username: username },
        include: { GameplayUser: true }
      });

      if (!currentUser || !currentUser.GameplayUser) {
        return;
      }

      // Check if the user is alive and has an active location
      const isUserActiveAndAlive = currentUser.GameplayUser.isAlive && currentUser.GameplayUser.locActive;

      // Fetch mutual friends usernames and include the current user's username
      const mutualFriendsUsernames = await getMutualFriends(currentUser);
      mutualFriendsUsernames.push(currentUser.username);

      let usernamesToFetchEntitiesFrom = [];

      if (currentUser.GameplayUser.friendsOnly) {
        // If friendsOnly is enabled, only fetch entities from mutual friends
        usernamesToFetchEntitiesFrom = mutualFriendsUsernames;
      } else {
        // Fetch all usernames who are not in friendsOnly mode or are mutual friends
        const nonFriendsOnlyUsers = await prisma.gameplayUser.findMany({
          where: {
            OR: [
              { username: { notIn: mutualFriendsUsernames }, friendsOnly: false },
              { username: { in: mutualFriendsUsernames } }
            ]
          },
          select: { username: true }
        });

        usernamesToFetchEntitiesFrom = nonFriendsOnlyUsers.map(u => u.username);
      }

      // Filter cached data based on usernamesToFetchEntitiesFrom
      const filteredMissiles = cache.missiles.filter(missile => usernamesToFetchEntitiesFrom.includes(missile.sentbyusername));
      const filteredLandmines = cache.landmines.filter(landmine => usernamesToFetchEntitiesFrom.includes(landmine.placedby));

      // Use filtered data, but only if the user is active and alive
      let dataBundle = new middleearth.WebSocketMessage([
        // Only include these if the user is active and alive
        ...(isUserActiveAndAlive ? [
          new middleearth.WSMsg('loot', cache.loot), // Loot is not filtered
          new middleearth.WSMsg('landmines', filteredLandmines),
          new middleearth.WSMsg('missiles', filteredMissiles),
        ] : []),
        // Always include 'other' data (which includes shields and loot), unfiltered
        new middleearth.WSMsg('other', cache.other),
      ]);

      // Compress the data bundle
      let compressedData = middleearth.zip(dataBundle);

      // Send compressed data through WebSocket
      ws.send(compressedData);
    };

    const sendLessPeriodicData = async () => {
      try {
        //fetch gameplayer user
        const user = await prisma.gameplayUser.findFirst({
          where: {
            username: username as string,
          },
          include: {
            league: true
          }
        });

        if (!user) {
          console.log(`User not found: ${username}`);
          return;
        }

        // get health from gameplay user
        let userhealth = { health: user.health }

        //get inventory for that user
        const inventory = await prisma.inventoryItem.findMany({
          where: {
            userId: user.id,
          },
          select: {
            name: true,
            quantity: true,
            category: true,
          },
        });

        //player locations
        const currentUser = await prisma.users.findUnique({
          where: { username: username },
          include: { GameplayUser: true }
        });

        if (!currentUser) {
          console.log(`Current user not found for: ${username}`);
          return;
        }

        //friends data
        const friendsData = await prisma.users.findMany({
          where: {
            username: {
              in: currentUser.friends,
            },
            friends: {
              has: currentUser.username
            }
          },
          select: {
            username: true,
          },
        });

        const mutualFriendsUsernames = await getMutualFriends(currentUser);

        // Ensure the current user's location is not included
        mutualFriendsUsernames.push(currentUser.username); // Add current user's username to filter it out

        let whereClause = {};
        if (currentUser.GameplayUser && currentUser.GameplayUser.friendsOnly) {
          // If friendsOnly is enabled, filter by mutual friends (excluding current user) and ensure they are alive
          whereClause = {
            AND: [
              { username: { not: { equals: currentUser.username } } }, // Exclude current user
              { username: { in: mutualFriendsUsernames } }, // Filter by mutual friends
              { locActive: true },
              { isAlive: true }
            ]
          };
        } else {
          // If friendsOnly is not enabled, get users who are alive and either are not friendsOnly or are in mutual friends (excluding current user)
          whereClause = {
            AND: [
              { username: { not: { equals: currentUser.username } } }, // Exclude current user
              { isAlive: true },
              { locActive: true },
              {
                OR: [
                  { friendsOnly: false },
                  { username: { in: mutualFriendsUsernames } }
                ]
              }
            ]
          };
        }

        const allGameplayUsers = await prisma.gameplayUser.findMany({
          where: whereClause,
          include: { Locations: true }
        });

        interface Location {
          latitude: string;
          longitude: string;
          updatedAt: Date;
          lastUpdated: Date;
          previousLat?: string;
          previousLong?: string;
        }

        const calculateTransportStatus = (currentLocation: Location, previousLocation: Location | null) => {
          if (!previousLocation) return 'walking';

          const timeDiff = (currentLocation.updatedAt.getTime() - previousLocation.updatedAt.getTime()) / 1000; // in seconds
          if (timeDiff <= 0) return 'walking'; // Avoid division by zero or negative time

          const distance = calculateDistance(
            { latitude: parseFloat(previousLocation.latitude), longitude: parseFloat(previousLocation.longitude) },
            { latitude: parseFloat(currentLocation.latitude), longitude: parseFloat(currentLocation.longitude) }
          );

          const speed = distance / timeDiff; // in meters per second

          // Debugging output
          // console.log(`Current Location: ${JSON.stringify(currentLocation)}`);
          // console.log(`Previous Location: ${JSON.stringify(previousLocation)}`);
          console.log(`Distance: ${distance} meters, Time Diff: ${timeDiff} seconds, Speed: ${speed} m/s`);

          // Adjusted speed thresholds (in meters per second)
          if (speed > 70) return 'plane';     // Approx. 252 km/h
          if (speed > 23) return 'highspeed';  // Approx. 83 km/h
          if (speed > 8) return 'car';        // Approx. 28.8 km/h
          if (speed > 1.5) return 'bicycle';  // Approx. 5.4 km/h

          // Check if in sea
          // if (isInSea({ latitude: parseFloat(currentLocation.latitude), longitude: parseFloat(currentLocation.longitude) })) {
          //   if (speed > 6) return 'ship';     // Fast boat or ship
          //   return 'boat';                     // Slow boat
          // }

          return 'walking';
        };

        // Mapping to format output with transport status
        const locations = allGameplayUsers.map((gpu) => {
          const currentLocation = gpu.Locations;
          if (!currentLocation) return null; // Skip this user if no location data

          const previousLocation: Location | null = currentLocation.previousLat && currentLocation.previousLong
            ? {
              latitude: currentLocation.previousLat,
              longitude: currentLocation.previousLong,
              updatedAt: currentLocation.lastUpdated,
              lastUpdated: currentLocation.lastUpdated
            }
            : null;

          const transportStatus = calculateTransportStatus(currentLocation, previousLocation);

          return {
            username: gpu.username,
            latitude: currentLocation.latitude,
            longitude: currentLocation.longitude,
            updatedAt: currentLocation.updatedAt,
            health: gpu.health,
            transportStatus
          };
        }).filter(Boolean); // Remove any null entries

        // Add AI bots to the locations
        const aiLocations = aiBots
          .filter(bot => bot.isOnline)
          .map(bot => ({
            username: bot.username,
            latitude: bot.latitude.toFixed(6),
            longitude: bot.longitude.toFixed(6),
            updatedAt: bot.lastUpdate,
            transportStatus: 'walking' // Assuming AI bots always have 'walking' status
          }));

        // Combine real player locations with AI bot locations
        const allLocations = [...locations, ...aiLocations];

        //bundle for sending
        let playerslocations = allLocations
        let userinventory = inventory
        let friends = friendsData
        let dataBundle = new middleearth.WebSocketMessage([
          new middleearth.WSMsg('health', userhealth),
          new middleearth.WSMsg('inventory', userinventory),
          new middleearth.WSMsg('playerlocations', playerslocations),
          new middleearth.WSMsg('friends', friends)
        ])

        // Compress the data bundle
        let compressedData = middleearth.zip(dataBundle);

        // Send compressed data through WebSocket
        ws.send(compressedData);

        //console.log(`Data sent for user ${username}: health=${userhealth.health}, inventory items=${inventory.length}, player locations=${playerslocations.length}, friends=${friends.length}`);

      } catch (error) {
        console.error(`Error in sendLessPeriodicData for user ${username}:`, error);
      }
    };

    // Reduce the frequency of updates
    const intervalId = setInterval(sendPeriodicData, 5000); // Change to 5 seconds
    sendLessPeriodicData();
    const lessintervalId = setInterval(sendLessPeriodicData, 10000);

    ws.on("message", (message: Buffer) => {
      let wsm: middleearth.WebSocketMessage;

      try {
        wsm = middleearth.unzip(message);
      } catch {
        try {
          wsm = JSON.parse(message.toString());
        } catch {
          console.error("Invalid message format");
          return;
        }
      }

      try {
        wsm.messages.forEach(async function (msg) {
          switch (msg.itemType) {
            case "Echo":
              ws.send(middleearth.zip_single(msg));
              break;
            case "playerLocation":
              await handlePlayerLocation(ws, msg, username);
              break;
            default:
              console.log(`Unhandled message type: ${msg.itemType}`);
          }
        });
      } catch (error) {
        console.error("Error handling message:", error);
      }
    });

    ws.send(JSON.stringify({ message: "Connection established" }));

    ws.on("error", (error: Error) => {
      console.error("WebSocket error:", error);
    });

    ws.on("close", (code: number, reason: string) => {
      console.log(`WebSocket closed for ${username}. Code: ${code}, Reason: ${reason}`);
      clearInterval(intervalId);
      clearInterval(lessintervalId);
    });
  });
}

function calculateDistance(loc1: { latitude: number; longitude: number }, loc2: { latitude: number; longitude: number }) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = loc1.latitude * Math.PI / 180;
  const φ2 = loc2.latitude * Math.PI / 180;
  const Δφ = (loc2.latitude - loc1.latitude) * Math.PI / 180;
  const Δλ = (loc2.longitude - loc1.longitude) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

function isInSea(location: { latitude: number; longitude: number }): boolean {
  const oceans = {
    Pacific: [
      { lat: -60, lng: -180 },
      { lat: 60, lng: -180 },
      { lat: 60, lng: -80 },
      { lat: -60, lng: -80 },
    ],
    Atlantic: [
      { lat: -60, lng: -80 },
      { lat: 60, lng: -80 },
      { lat: 60, lng: 20 },
      { lat: -60, lng: 20 },
    ],
    Indian: [
      { lat: -60, lng: 20 },
      { lat: 30, lng: 20 },
      { lat: 30, lng: 120 },
      { lat: -60, lng: 120 },
    ],
    Southern: [
      { lat: -90, lng: -180 },
      { lat: -60, lng: -180 },
      { lat: -60, lng: 180 },
      { lat: -90, lng: 180 },
    ],
    Arctic: [
      { lat: 60, lng: -180 },
      { lat: 90, lng: -180 },
      { lat: 90, lng: 180 },
      { lat: 60, lng: 180 },
    ],
  };

  const point = { lat: location.latitude, lng: location.longitude };

  return Object.values(oceans).some(polygon => isPointInPolygon(point, polygon));
}

function isPointInPolygon(point: { lat: number; lng: number }, polygon: { lat: number; lng: number }[]): boolean {
  let inside = false;
  const { lat, lng } = point;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const { lat: lat1, lng: lng1 } = polygon[i];
    const { lat: lat2, lng: lng2 } = polygon[j];

    const intersect = ((lat1 > lat) !== (lat2 > lat)) &&
      (lng < (lng2 - lng1) * (lat - lat1) / (lat2 - lat1) + lng1);
    if (intersect) inside = !inside;
  }

  return inside;
}

async function handlePlayerLocation(ws: WebSocket, msg: any, username: string) {
  const locationData = msg.data;
  
  if (!locationData || typeof locationData.latitude !== 'number' || typeof locationData.longitude !== 'number') {
    console.error('Invalid location data');
    return;
  }

  const now = new Date().toISOString();

  try {
    const lastLocation = await prisma.locations.findFirst({
      where: { username: username },
      orderBy: { updatedAt: 'desc' },
    });

    if (lastLocation) {
      // Update existing location
      await prisma.locations.update({
        where: { username: username },
        data: {
          previousLat: lastLocation.latitude,
          previousLong: lastLocation.longitude,
          latitude: locationData.latitude.toString(),
          longitude: locationData.longitude.toString(),
          lastUpdated: lastLocation.updatedAt,
          updatedAt: now,
        },
      });
    } else {
      // Create new location
      await prisma.locations.create({
        data: {
          username: username,
          latitude: locationData.latitude.toString(),
          longitude: locationData.longitude.toString(),
          updatedAt: now,
          lastUpdated: now,
        },
      });
    }

    console.log(`Updated location for user ${username}`);
    ws.send(JSON.stringify({ message: "Location updated successfully" }));
  } catch (error) {
    console.error('Error updating location:', error);
    ws.send(JSON.stringify({ error: "Failed to update location" }));
  }
}