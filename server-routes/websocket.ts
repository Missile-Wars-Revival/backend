import { Request } from "express";
import { ParamsDictionary } from "express-serve-static-core";
import { Prisma } from "@prisma/client";
import type { WebSocket as WsSocket } from "ws";
import { verifyToken } from "../util/auth";
import { ensureLocalUserForToken } from "../util/provisionUser";
import * as middleearth from "middle-earth";
import { prisma } from "../server";
import { getMutualFriends } from "./friendsApi";
import { resolveProfileImageUrl, resolveProfileImageUrls } from "./profileImages";
import { sendPushNotification } from "../runners/NotificationService";
import { getFriendUsernames } from "../util/socialStore";
// import { aiBots } from "../bots";
import { Missile, Loot, Other, Landmine } from "middle-earth"; 
import axios from 'axios';
import { playerConnected, playerDisconnected } from "../runners/coordinatorClient";

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

function isSessionIdUniqueConstraint(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    Array.isArray(error.meta?.target) &&
    error.meta.target.includes("id")
  );
}

async function repairSessionsIdSequence() {
  await prisma.$queryRaw`
    SELECT setval(
      pg_get_serial_sequence('"Sessions"', 'id'),
      COALESCE((SELECT MAX(id) FROM "Sessions"), 0) + 1,
      false
    )
  `;
}

async function updateOrCreateSession(userId: number, ip: string | undefined) {
  const existingSession = await prisma.sessions.findFirst({
    where: { userId: userId }
  });
  
  if (existingSession) {
    // If a session exists, update it
    await prisma.sessions.update({
      where: { id: existingSession.id },
      data: {
        lastLoginTime: new Date(),
        lastIp: ip || 'unknown'
      }
    });
  } else {
    // If no session exists, create a new one
    try {
      await prisma.sessions.create({
        data: {
          userId: userId,
          lastLoginTime: new Date(),
          lastIp: ip || 'unknown'
        }
      });
    } catch (error) {
      if (!isSessionIdUniqueConstraint(error)) {
        throw error;
      }

      // Imported data can leave the Postgres sequence behind existing rows.
      // Repair it and retry once so first-time connects do not fail auth.
      await repairSessionsIdSequence();
      await prisma.sessions.create({
        data: {
          userId: userId,
          lastLoginTime: new Date(),
          lastIp: ip || 'unknown'
        }
      });
    }
  }
}

function authenticate(
  req: Request<ParamsDictionary, any, any, any, Record<string, any>>
): Promise<AuthResult> {
  // Prefer the Authorization header (or Sec-WebSocket-Protocol) so the JWT
  // stays out of URLs, which get recorded in server/proxy access logs. The
  // ?token= query param is kept as a fallback for older clients.
  let authToken: string | null | undefined;
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    authToken = authHeader.slice('Bearer '.length);
  } else if (typeof req.headers['sec-websocket-protocol'] === 'string') {
    authToken = req.headers['sec-websocket-protocol'] as string;
  } else {
    authToken = req.url ? new URL(req.url, 'http://localhost').searchParams.get('token') : undefined;
  }

  if (!authToken) {
    console.log("Authentication failed. Token is missing.");
    return Promise.resolve({ success: false });
  }

  return new Promise(async (resolve) => {
    try {
      const decoded = verifyToken(authToken);

      if (!decoded.username) {
        console.log("Invalid token: Username is missing.");
        resolve({ success: false });
        return;
      }

      let user = await ensureLocalUserForToken(decoded);

      if (!user) {
        console.log(`User not found: ${decoded.username}`);
        resolve({ success: false });
        return;
      }

      // Get the actual client IP address
      const ip = getClientIp(req);

      // Update or create the session
      await updateOrCreateSession(user.id, ip);

      console.log(`Authentication successful for user: ${decoded.username}`);
      resolve({ success: true, username: decoded.username });
    } catch (error) {
      console.log("Authentication failed. Invalid token.", error);
      resolve({ success: false });
    }
  });
}

// Helper function to get the client's IP address
function getClientIp(req: Request): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    // If it's an array, take the first item
    return Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(',')[0];
  }
  // Fallback to other headers or remote address
  return req.headers['x-real-ip'] as string || 
         req.connection.remoteAddress || 
         req.socket.remoteAddress || 
         'unknown';
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

    cache.missiles = allMissiles.map((missile: any) => middleearth.Missile.from_db(missile));
    cache.loot = allLoot.map((loot: any) => middleearth.Loot.from_db(loot));
    cache.other = allOther.map((other: any) => middleearth.Other.from_db(other));
    cache.landmines = allLandmines.map((landmine: any) => middleearth.Landmine.from_db(landmine));

    cache.lastUpdate = now;
  }

  app.ws("/", (ws: WsSocket, req: Request) => {
    authenticate(req).then((authResult) => {
      if (!authResult.success || !authResult.username) {
        console.log("Connection attempted but authentication failed");
        ws.close(1008, "Authentication failed");
        return;
      }

      const username = authResult.username;
      console.log(`WebSocket connection established for user: ${username}`);
      playerConnected();

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

          usernamesToFetchEntitiesFrom = nonFriendsOnlyUsers.map((u: { username: any; }) => u.username);
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
          const friendUsernames = await getFriendUsernames(currentUser);
          if (friendUsernames.join("\0") !== currentUser.friends.join("\0")) {
            await prisma.users.update({
              where: { username: currentUser.username },
              data: { friends: { set: friendUsernames } },
            });
            currentUser.friends = friendUsernames;
          }

          // Resolve profile image URLs server-side so the client doesn't have to.
          const friendsImageUrls = await resolveProfileImageUrls(friendUsernames);
          const friendsData = friendUsernames.map((friendUsername) => ({
            username: friendUsername,
            profileImageUrl: friendsImageUrls[friendUsername] ?? null,
          }));

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
            include: { Locations: true, league: true }
          });

          interface Location {
            latitude: string;
            longitude: string;
            updatedAt: Date;
            lastUpdated: Date;
            previousLat?: string;
            previousLong?: string;
          }

          const calculateTransportStatus = async (currentLocation: Location, previousLocation: Location | null, username: string) => {
            if (!previousLocation) return 'walking';

            const timeDiff = (currentLocation.updatedAt.getTime() - previousLocation.updatedAt.getTime()) / 1000; // in seconds
            if (timeDiff <= 0) return 'walking'; // Avoid division by zero or negative time

            const distance = calculateDistance(
              { latitude: parseFloat(previousLocation.latitude), longitude: parseFloat(previousLocation.longitude) },
              { latitude: parseFloat(currentLocation.latitude), longitude: parseFloat(currentLocation.longitude) }
            );

            const speed = distance / timeDiff; // in meters per second

            // Debugging output
            // console.log(`Distance: ${distance} meters, Time Diff: ${timeDiff} seconds, Speed: ${speed} m/s`);

            let transportStatus = 'walking'; // Default status
            // Adjusted speed thresholds (in meters per second)
            if (speed > 70) transportStatus = 'plane';     // Approx. 252 km/h
            else if (speed > 23) transportStatus = 'highspeed';  // Approx. 83 km/h
            else if (speed > 8) transportStatus = 'car';        // Approx. 28.8 km/h
            else if (speed > 1.5) transportStatus = 'bicycle';  // Approx. 5.4 km/h

            // Check if in sea
            // const isCurrentlyInSea = await isInSea({ 
            //   latitude: parseFloat(currentLocation.latitude), 
            //   longitude: parseFloat(currentLocation.longitude) 
            // });

            // if (isCurrentlyInSea) {
            //   transportStatus = speed > 6 ? 'ship' : 'boat'; // Fast or slow boat
            // }

            // Update transport status in the database
            await prisma.locations.update({
              where: { username: username },
              data: { transportStatus: transportStatus }
            });

            return transportStatus;
          };

          const locationImageUrls = await resolveProfileImageUrls(
            allGameplayUsers.map((gpu: { username: string }) => gpu.username)
          );

          const locations = await Promise.all(allGameplayUsers.map(async (gpu: { Locations: any; username: string; health: any; randomLocation: any; league: { tier: string } | null }) => {
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

            const transportStatus = await calculateTransportStatus(currentLocation, previousLocation, gpu.username);

            // Phase 11A: diffuse server-side. A player who opted into location
            // diffusion (`randomLocation`) has their precise coordinates
            // replaced with a stable, deterministic offset point before it ever
            // leaves the server. The offset radius is the player's league
            // AIRSPACE (bronze 60m … legend 200m), so the diffusion zone scales
            // with rank, and the client draws a circle of that radius with the
            // marker placed inside it. Applies to friends and non-friends;
            // friendship controls visibility, not precision.
            const airspaceRadius = leagueAirspace(gpu.league?.tier);
            const shouldDiffuse = gpu.randomLocation;
            let outLat = currentLocation.latitude;
            let outLong = currentLocation.longitude;
            if (shouldDiffuse) {
              const diffused = diffuseCoordinate(
                parseFloat(currentLocation.latitude),
                parseFloat(currentLocation.longitude),
                gpu.username,
                airspaceRadius
              );
              outLat = diffused.latitude.toString();
              outLong = diffused.longitude.toString();
            }

            return {
              username: gpu.username,
              latitude: outLat,
              longitude: outLong,
              updatedAt: currentLocation.updatedAt,
              health: gpu.health,
              randomlocation: gpu.randomLocation,
              // New clients render this point as-is; the legacy `randomlocation`
              // flag stays for old clients (which re-diffuse harmlessly).
              locationPrecision: shouldDiffuse ? "diffused" : "precise",
              // The player's league airspace radius — sizes the diffusion circle
              // and the marker's randomised offset on the client.
              airspaceRadius,
              transportStatus,
              profileImageUrl: locationImageUrls[gpu.username] ?? null
            };
          }));

          // Remove any null entries
          const filteredLocations = locations.filter(Boolean);

          // // Add AI bots to the locations
          // const aiLocations = aiBots
          //   .filter(bot => bot.isOnline)
          //   .map(bot => ({
          //     username: bot.username,
          //     latitude: bot.latitude.toFixed(6),
          //     longitude: bot.longitude.toFixed(6),
          //     updatedAt: bot.lastUpdate,
          //     transportStatus: 'walking' // Assuming AI bots always have 'walking' status
          //   }));

          // Combine real player locations with AI bot locations
          // const allLocations = [...filteredLocations, ...aiLocations];
          const allLocations = [...filteredLocations];

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
      const intervalId = setInterval(sendPeriodicData, 1000); 
      sendLessPeriodicData();
      const lessintervalId = setInterval(sendLessPeriodicData, 5000);

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
              case "friendsDeclare":
                await handleFriendsDeclare(msg, username);
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

      ws.on("close", (code: number, reason: Buffer) => {
        console.log(`WebSocket closed for ${username}. Code: ${code}, Reason: ${reason.toString()}`);
        playerDisconnected();
        clearInterval(intervalId);
        clearInterval(lessintervalId);
      });
    });
  });
}

// Phase 11A: deterministic server-side location diffusion. Seeded only by the
// username, so the offset is CONSTANT for a given player — the diffused point
// tracks their movement with a fixed ~100m offset and never jitters, which
// fixes the old client-side Math.random diffusion that re-randomised the marker
// every tick and made diffused players hard to tap. Precise coordinates are
// never sent for a diffused player, so this offset is all an observer ever
// sees. (Honest residual: a constant offset is in principle reverse-engineerable
// over time; rotating the seed periodically would trade tap-stability for that.)
// Per-league airspace radius (mirrors the frontend getLeagueAirspace). Sizes
// the diffusion zone so the drawn circle honestly bounds the player's real
// position. A user with no league defaults to bronze (matches map-comp.tsx).
function leagueAirspace(tier: string | undefined | null): number {
  switch ((tier ?? "bronze").toLowerCase()) {
    case "bronze": return 60;
    case "silver": return 80;
    case "gold": return 120;
    case "diamond": return 140;
    case "legend": return 200;
    default: return 20;
  }
}

function diffuseCoordinate(latitude: number, longitude: number, seed: string, radiusMeters: number): { latitude: number; longitude: number } {
  // FNV-1a hash → a stable angle and distance within the diffusion radius.
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const u = hash >>> 0;
  const angle = ((u % 36000) / 36000) * 2 * Math.PI;
  const distance = (((u >>> 8) % 1000) / 1000) * radiusMeters;
  const earthRadius = 6371000;
  const dLat = (distance / earthRadius) * (180 / Math.PI) * Math.cos(angle);
  const dLong = (distance / earthRadius) * (180 / Math.PI) * Math.sin(angle) / Math.cos(latitude * Math.PI / 180);
  return { latitude: latitude + dLat, longitude: longitude + dLong };
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

async function isInSea(location: { latitude: number; longitude: number }): Promise<boolean> {
  const query = `
    [out:json];
    way["natural"="water"](around:1000, ${location.latitude}, ${location.longitude});
    out body;
  `;

  const maxRetries = 5; // Maximum number of retries
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const response = await axios.get(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
      const data = response.data;

      // Check if any way returned is classified as an ocean
      return data.elements.length > 0;
    } catch (error: any) {
      if (error.response && error.response.status === 429) {
        // If rate limited, wait and retry
        attempt++;
        const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff
        console.error(`Rate limit exceeded. Retrying in ${waitTime / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        console.error("Error querying Overpass API:", error);
        return false; // Default to false on other errors
      }
    }
  }

  console.error("Max retries reached. Returning false.");
  return false; // Return false if max retries reached
}

// Phase 6 social cutover: friendships live in Firebase central (uid edges,
// written by the client). The client DECLARES its friend list here and the
// shard caches it in Users.friends purely for gameplay — friendsOnly
// visibility, friendly-fire exemption, proximity alerts. The cache must
// outlive the session (an offline friend's missile still must not hurt you),
// which is why this stays a column and not in-memory state. Cheat-resistance
// is unchanged: every check that matters uses MUTUAL friendship, so a player
// declaring strangers as friends gains nothing unless the stranger declares
// them back — exactly like the old one-sided "add" semantics.
async function handleFriendsDeclare(msg: any, username: string) {
  const declaredEntries = normalizeDeclaredFriends(msg?.data?.friends);
  if (!declaredEntries || declaredEntries.length > 1000) {
    console.error(`Invalid friendsDeclare from ${username}`);
    return;
  }
  let friends = [...new Set(
    declaredEntries
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (!entry || typeof entry !== "object") return "";
        const record = entry as Record<string, unknown>;
        const candidate = record.username ?? record.friendUsername ?? record.name;
        return typeof candidate === "string" ? candidate : "";
      })
      .map((friend) => friend.trim())
      .filter((friend) => friend.length > 0 && friend.length <= 64 && friend !== username)
  )];
  try {
    const current = await prisma.users.findUnique({
      where: { username },
      select: { friends: true, firebaseUID: true },
    });
    if (!current) return;

    const previous = new Set(current.friends);
    const added = friends.filter((f) => !previous.has(f));

    await prisma.users.update({
      where: { username },
      data: { friends: { set: friends } },
    });

    if (process.env.VERBOSE_MODE === "ON") {
      console.log(`[friendsDeclare] ${username}: received=${declaredEntries.length}, stored=${friends.length}`, {
        sample: friends.slice(0, 5),
      });
    }

    // Friend-request pushes used to be sent by /api/addFriend; now they fire
    // off the declaration diff. Only small diffs notify — an interactive add
    // is 1 name, while a first sync on a fresh shard can be a whole list and
    // must not blast every friend with a push.
    if (added.length > 0 && added.length <= 3) {
      const senderAvatarUrl = await resolveProfileImageUrl(username);
      // The stored titles must stay exactly "Friend Accepted" /
      // "Friend Request" — they double as the pending-request inbox.
      const communicationData = {
        fromUserId: username,
        communication: true,
        senderName: username,
        ...(senderAvatarUrl ? { senderAvatarUrl } : {}),
        communicationThreadId: `friend-${username}`,
      };
      for (const friendName of added) {
        const friendUser = await prisma.users.findUnique({
          where: { username: friendName },
          select: { friends: true },
        });
        if (!friendUser) continue;
        const isMutual = friendUser.friends.includes(username);
        await sendPushNotification({
          userId: friendName,
          title: isMutual ? "Friend Accepted" : "Friend Request",
          body: isMutual ? `${username} has added you back!` : `${username} has added you as a friend!`,
          type: "friend_request",
          data: { type: isMutual ? "friend_accepted" : "friend_request", ...communicationData },
        });
      }
    }
  } catch (error) {
    console.error(`Failed to store declared friends for ${username}:`, error);
  }
}

function normalizeDeclaredFriends(declared: unknown): unknown[] | null {
  if (Array.isArray(declared)) {
    return declared;
  }
  if (!declared || typeof declared !== "object") {
    return null;
  }

  const values = Object.entries(declared as Record<string, unknown>).map(([key, value]) => {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && typeof (value as { username?: unknown }).username === "string") {
      return (value as { username: string }).username;
    }
    return key;
  });

  if (process.env.VERBOSE_MODE === "ON") {
    console.log("[friendsDeclare] normalized object sample:", values.slice(0, 5));
  }

  return values;
}

async function handlePlayerLocation(ws: WsSocket, msg: any, username: string) {
  const locationData = msg.data;
  
  if (!locationData || typeof locationData.latitude !== 'number' || typeof locationData.longitude !== 'number') {
    console.error('Invalid location data');
    return;
  }

  const now = new Date();

  try {
    const lastLocation = await prisma.locations.findFirst({
      where: { username: username },
      orderBy: { updatedAt: 'desc' },
    });

    const user = await prisma.gameplayUser.findUnique({
      where: { username: username },
      include: { Users: true },
    });

    if (!user) {
      console.error(`User ${username} not found`);
      return;
    }

    let penaltyApplied = false;

    // Check for rapid location changes
    // if (lastLocation) {
    //   const timeDiff = (now.getTime() - lastLocation.updatedAt.getTime()) / 1000; // in seconds
    //   const distance = calculateDistance(
    //     { latitude: parseFloat(lastLocation.latitude), longitude: parseFloat(lastLocation.longitude) },
    //     { latitude: locationData.latitude, longitude: locationData.longitude }
    //   );
    //   const speed = distance / timeDiff; // in meters per second

    //   // Define speed thresholds for different transportation modes (in m/s)
    //   const WALKING_SPEED = 2; // ~7.2 km/h
    //   const DRIVING_SPEED = 50; // ~180 km/h
    //   const HIGH_SPEED_TRAIN = 100; // ~360 km/h
    //   const AIRPLANE_SPEED = 250; // ~900 km/h
    //   const MAX_ALLOWED_SPEED = 300; // ~1080 km/h

    //   let transportMode = 'walking';
    //   if (speed > AIRPLANE_SPEED) transportMode = 'airplane';
    //   else if (speed > HIGH_SPEED_TRAIN) transportMode = 'high-speed train';
    //   else if (speed > DRIVING_SPEED) transportMode = 'driving';

    //   if (speed > MAX_ALLOWED_SPEED) {
    //     console.warn(`Extremely rapid movement detected for user ${username}. Speed: ${speed.toFixed(2)} m/s`);
    //     penaltyApplied = true;
    //   } else {
    //     console.log(`User ${username} appears to be ${transportMode}. Speed: ${speed.toFixed(2)} m/s`);
    //   }
    // }

    // // Check for location within reasonable bounds
    // if (Math.abs(locationData.latitude) > 90 || Math.abs(locationData.longitude) > 180) {
    //   console.warn(`Invalid location coordinates for user ${username}`);
    //   penaltyApplied = true;
    // }

    // if (penaltyApplied) {
    //   // Apply penalty: reduce coins by 1000
    //   const penaltyAmount = 1000;
    //   await prisma.gameplayUser.update({
    //     where: { username: username },
    //     data: {
    //       money: {
    //         decrement: penaltyAmount
    //       }
    //     }
    //   });

    //   sendNotification(username, "Suspicious Activity Detected", `Unusual movement detected. You have been penalized ${penaltyAmount} coins.`, "Server");

    //   ws.send(JSON.stringify({ error: "Suspicious activity detected. You have been penalized." }));
    //   return;
    // }

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
          updatedAt: now
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
