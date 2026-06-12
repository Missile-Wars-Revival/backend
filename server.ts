// Load .env before anything else — route modules read env vars at import time.
import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import bodyParser from "body-parser";
import expressWs from "express-ws";
import { initAuth, verifyToken } from "./util/auth";
import { AuthWithLocation, AuthWithLocationSchema } from "./interfaces/api";
import { deleteExpiredLandmines, deleteExpiredLoot, deleteExpiredMissiles, updateMissilePositions, addRandomLoot, checkPlayerProximity, deleteExpiredOther, checkAndCollectLoot } from "./runners/entitymanagment";
import { startNotificationManager } from "./runners/notificationhelper";
// import { deleteAllBots, manageAIBots } from "./bots";
import { setupNotificationApi } from "./server-routes/notificaitonApi";
import { setupFriendsApi } from "./server-routes/friendsApi";
import { setupMoneyApi } from "./server-routes/moneyApi";
import { setupAuthRoutes, validateSchema } from "./server-routes/authRoutes";
import { setupEntityApi } from "./server-routes/entityApi";
import { setupAccessoryApi } from "./server-routes/accessoryApi";
import { setupWebSocket } from "./server-routes/websocket";
import { setupUserApi } from "./server-routes/userApi";
import { setupRankApi } from "./server-routes/rankApi";
import { setupHealthApi } from "./server-routes/healthApi";
import { setupInventoryApi } from "./server-routes/inventoryApi";
import { setupLeagueApi } from "./server-routes/leagueApi";
import { leagueRunner } from "./runners/leaguemanagment";
import { startDamageProcessing } from "./runners/damageProcessor";
import * as admin from 'firebase-admin'
import { setupMessageListener } from "./runners/messageListener";
import { startShieldBreakerProcessing } from "./runners/shieldbreaker";
import { startCoordinatorHeartbeat } from "./runners/coordinatorClient";
import { setupWebApi } from "./server-routes/webApi";
const { PrismaClient } = require('@prisma/client');

// Refuse to boot without a way to verify tokens: either the coordinator
// (COORDINATOR_URL + SHARD_API_KEY → RS256 via JWKS) or a local JWT_SECRET
// for solo hosting. Also starts the background JWKS fetch/refresh loop.
try {
  initAuth();
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

export const prisma = new PrismaClient();

const wsServer = expressWs(express());
const app = wsServer.app;

// Behind the Elastic Beanstalk load balancer — trust the first proxy hop so
// req.ip (used by rate limiting) reflects the real client address.
app.set('trust proxy', 1);

// Serve static files from public directory
import path from 'path';
app.use(express.static(path.join(__dirname, 'public')));

// Route to serve map.html
app.get('/map', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'public', 'map.html'));
});

app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).send('ok');
});

let serviceAccount;
try {
  serviceAccount = require("./firebasecred.json");
} catch (error) {
  console.error("Failed to load Firebase credentials:", error);
  serviceAccount = null;
}

// Initialize Firebase only if credentials are available
if (serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://missile-wars-432403-default-rtdb.firebaseio.com/",
    storageBucket: "gs://missile-wars-432403.appspot.com"  
  });
} else {
  console.warn("Firebase initialization skipped due to missing credentials");
}

// 20mb so /api/uploadProfileImage can receive base64 images (default is 100kb).
app.use(bodyParser.json({ limit: "20mb" }));

// this function manages entities on the map
setInterval(addRandomLoot, 30000);
setInterval(updateMissilePositions, 30000);

setInterval(deleteExpiredMissiles, 30000);
setInterval(deleteExpiredLandmines, 30000);
setInterval(deleteExpiredLoot, 30000);
setInterval(deleteExpiredOther, 30000);

//player notificaitons
setInterval(checkPlayerProximity, 15000);
//player loot
setInterval(checkAndCollectLoot, 15000);

//manages notifications
startNotificationManager();

// //manages leagues
setInterval(leagueRunner, 60 * 60 * 1000);
leagueRunner();

//manage damage:
startDamageProcessing();

//manage shieldbreakers
startShieldBreakerProcessing();

//heartbeat to the distributed-hosting coordinator (no-op unless configured)
startCoordinatorHeartbeat();

//Bots:
// manageAIBots();

// deleteAllBots();

//Firebase Messages
if (serviceAccount) {
  setupMessageListener();
} else {
  console.warn("Skipping message listener setup due to missing Firebase credentials");
}

// api routes
setupAccessoryApi(app);
setupAuthRoutes(app);
setupWebApi(app);
setupEntityApi(app);
setupFriendsApi(app);
setupHealthApi(app);
setupInventoryApi(app);
setupMoneyApi(app);
setupNotificationApi(app);
setupRankApi(app);
setupUserApi(app);
setupWebSocket(app);
setupLeagueApi(app);


// Next to convert to WS
app.post(
  "/api/dispatch",
  validateSchema(AuthWithLocationSchema),
  async (req: Request, res: Response) => {
    const location: AuthWithLocation = req.body;

    if (!location.token) {
      return res.status(401).json({ message: "Missing token" });
    }

    let username: string;
    try {
      username = verifyToken(location.token).username;
    } catch {
      return res.status(401).json({ message: "Invalid token" });
    }

    // Check if the user exists
    const user = await prisma.gameplayUser.findFirst({
      where: {
        username,
      },
    });

    if (user) {
      const lastLocation = await prisma.locations.findFirst({
        where: {
          username,
        },
        orderBy: {
          updatedAt: "desc",
        },
      });

      const now = new Date().toISOString();

      if (lastLocation) {
        // User already has a location, update it
        try {
          await prisma.locations.update({
            where: {
              username: lastLocation.username,
            },
            data: {
              previousLat: lastLocation.latitude,
              previousLong: lastLocation.longitude,
              latitude: location.latitude,
              longitude: location.longitude,
              lastUpdated: lastLocation.updatedAt,
              updatedAt: now,
            },
          });
        } catch (error) {
          console.error("Failed to update location:", error);
          return res.status(500).json({ message: "Failed to update location" });
        }
      } else {
        // User does not have a location, create a new one
        try {
          await prisma.locations.create({
            data: {
              username,
              latitude: location.latitude,
              longitude: location.longitude,
              updatedAt: now,
              lastUpdated: now,
              // previousLat and previousLong will use their default values
            },
          });
        } catch (error) {
          console.error("Failed to create location:", error);
          return res.status(500).json({ message: "Failed to create location" });
        }
      }
      res.status(200).json({ message: "Location dispatched" });
    } else {
      res.status(404).json({ message: "User not found" });
      console.log("user not found")
    }
  }
);

////////////////////////

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log("listening on port", port);
});
