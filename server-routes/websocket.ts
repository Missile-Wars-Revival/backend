import { Request } from "express";
import { ParamsDictionary } from "express-serve-static-core";
import * as jwt from "jsonwebtoken";
import * as middleearth from "middle-earth";
import { prisma } from "../server";
import { getMutualFriends } from "./friendsApi";
import { aiBots } from "../bots";

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
  const authToken = req.headers["sec-websocket-protocol"] as string | undefined;

  if (!authToken) {
    ws.send(JSON.stringify({ error: "Authentication failed. Token is required." }));
    ws.close();
    return { success: false };
  }

  try {
    const decoded = jwt.verify(authToken, process.env.JWT_SECRET || "") as { username: string; };

    if (!decoded.username) {
      ws.send(JSON.stringify({ error: "Invalid token: Username is missing." }));
      ws.close();
      return { success: false };
    }

    return { success: true, username: decoded.username };
  } catch (error) {
    ws.send(JSON.stringify({ error: "Authentication failed. Invalid token." }));
    ws.close();
    return { success: false };
  }
}

export function setupWebSocket(app: any) {
  app.ws("/", (ws: any, req: Request) => {
    const authResult = authenticate(ws, req);

    if (!authResult.success) {
      console.log("Connection attempted but authentication failed");
      return;
    }

    const username = authResult.username;

    logVerbose("New connection established");

    const sendPeriodicData = async () => {

      const currentUser = await prisma.users.findUnique({
        where: { username: username },
        include: { GameplayUser: true }
      });

      if (!currentUser) {
        return;
      }
      //filtering:
      // Fetch mutual friends usernames and include the current user's username
      const mutualFriendsUsernames = await getMutualFriends(currentUser);
      mutualFriendsUsernames.push(currentUser.username); // Ensure not to include the current user

      let usernamesToFetchEntitesFrom = [];

      if (currentUser.GameplayUser && currentUser.GameplayUser.friendsOnly) {
        // If friendsOnly is enabled, only fetch missiles from mutual friends
        usernamesToFetchEntitesFrom = mutualFriendsUsernames;
      } else {
        // Fetch all usernames who are not in friendsOnly mode or are mutual friends
        const nonFriendsOnlyUsers = await prisma.gameplayUser.findMany({
          where: {
            OR: [
              { username: { notIn: mutualFriendsUsernames }, friendsOnly: false },
              { username: { in: mutualFriendsUsernames } }
            ]
          },
          select: {
            username: true // We only need the username for the missile query
          }
        });

        usernamesToFetchEntitesFrom = nonFriendsOnlyUsers.map(u => u.username);
      }


      const allMissiles = await prisma.missile.findMany({
        where: {
          sentBy: {
            in: usernamesToFetchEntitesFrom
          }
        }
      });

      const processedMissiles = allMissiles.map(missile => middleearth.Missile.from_db(missile));

      let allLoot = await prisma.loot.findMany();
      let allOther = await prisma.other.findMany();
      let processedLoot = allLoot.map((loot: any) => middleearth.Loot.from_db(loot));
      let processedOther = allOther.map((other: any) => middleearth.Other.from_db(other));

      let allLandmines = await prisma.landmine.findMany({
        where: {
          placedBy: {
            in: usernamesToFetchEntitesFrom
          }
        }
      });
      let processedLandmines = allLandmines.map((landmine: any) => middleearth.Landmine.from_db(landmine));

      // Prepare the data bundle
      let dataBundle = new middleearth.WebSocketMessage([
        new middleearth.WSMsg('loot', processedLoot),
        new middleearth.WSMsg('other', processedOther),
        new middleearth.WSMsg('landmines', processedLandmines),
        new middleearth.WSMsg('missiles', processedMissiles),
      ]);

      // Compress the data bundle
      let compressedData = middleearth.zip(dataBundle);

      // Send compressed data through WebSocket
      ws.send(compressedData);
    };

    const sendLessPeriodicData = async () => {

      //fetch gameplayer user
      const user = await prisma.gameplayUser.findFirst({
        where: {
          username: username as string,
        },
        include: {
          league: true
        }
      });

      if (user) {
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

        if (!currentUser || !user.league) {
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
              //{ league: { tier: user.league.tier, division: user.league.division } }, // Filter by user's league and division
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

          if (speed > 250) return 'plane';     // Approx. 900 km/h
          if (speed > 83) return 'highspeed';  // Approx. 300 km/h (high-speed train)
          if (speed > 28) return 'car';        // Approx. 100 km/h
          if (speed > 4) return 'bicycle';     // Approx. 15 km/h
          if (isInSea({ latitude: parseFloat(currentLocation.latitude), longitude: parseFloat(currentLocation.longitude) })) {
            if (speed > 15) return 'ship';     // Fast boat or ship
            return 'boat';                     // Slow boat
          }
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

      } else {
        console.log("User items not found :(")
        return
      }
    };

    const intervalId = setInterval(sendPeriodicData, 1000);
    sendLessPeriodicData();
    const lessintervalId = setInterval(sendLessPeriodicData, 10000);

    ws.on("message", (message: Buffer /*: WebSocketMessage*/) => {
      //logVerbose("Received message:", message);
      // Determine if a message is encoded in MessagePack by trying
      // to unpack it

      let wsm: middleearth.WebSocketMessage;

      if (message.toString().slice(0, 6) === "devcon") {
        let devmsg = message.toString();
        ws.send("Accessing dev console...");
        let words = devmsg.split(' ');
        if (words[1] === "add") {
          ws.send("Adding missile...");
        } else if (words[1] === "stop") {
          clearInterval(intervalId);
          clearInterval(lessintervalId);
        }

      }

      try {
        wsm = middleearth.unzip(message);
        logVerbose("Decoded MessagePack:", wsm);
      } catch {
        logVerbose("Not valid MessagePack");
        // Fall back to JSON if not MessagePack
        try {
          wsm = JSON.parse(message.toString());
          logVerbose("Is JSON:", wsm);
        } catch {
          logVerbose("Not JSON, cannot decode");
          return;
        }
      }
      try {
        // Handle main communications here
        wsm.messages.forEach(async function (msg) {
          //for more specifc requests:
          switch (msg.itemType) {
            case "Echo":
              ws.send(middleearth.zip_single(msg));
              break;

            default:
              logVerbose("Msg received, but is not yet implemented and was skipped");
          }
        });
      } catch {
        logVerbose("Unable to handle messages. Please make sure they are being formatted correctly inside a WebSocketMessage.");
      }
    });

    ws.send(JSON.stringify({ message: "Connection established" }));

    ws.on("close", () => {
      logVerbose("Connection closed");
      clearInterval(intervalId);
    });
  });
}

function calculateDistance(loc1: { latitude: number; longitude: number }, loc2: { latitude: number; longitude: number }) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = loc1.latitude * Math.PI / 180;
  const φ2 = loc2.latitude * Math.PI / 180;
  const Δφ = (loc2.latitude - loc1.latitude) * Math.PI / 180;
  const Δλ = (loc2.longitude - loc1.longitude) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Distance in meters
}

function isInSea(location: { latitude: number; longitude: number }): boolean {
  // This is a simplified check using major ocean bounding boxes
  const oceans = [
    { name: 'Pacific', minLat: -60, maxLat: 60, minLong: -180, maxLong: -80 },
    { name: 'Atlantic', minLat: -60, maxLat: 60, minLong: -80, maxLong: 20 },
    { name: 'Indian', minLat: -60, maxLat: 30, minLong: 20, maxLong: 120 },
    { name: 'Southern', minLat: -90, maxLat: -60, minLong: -180, maxLong: 180 },
    { name: 'Arctic', minLat: 60, maxLat: 90, minLong: -180, maxLong: 180 }
  ];

  return oceans.some(ocean => 
    location.latitude >= ocean.minLat && location.latitude <= ocean.maxLat &&
    location.longitude >= ocean.minLong && location.longitude <= ocean.maxLong
  );
}