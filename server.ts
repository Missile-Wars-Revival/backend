import express from "express";
import bodyParser from "body-parser";
import { PrismaClient } from "@prisma/client";
import swaggerUi from "swagger-ui-express";
import swaggerJSDoc from "swagger-jsdoc";
import expressWs from "express-ws";
import * as jwt from "jsonwebtoken";
import { JwtPayload } from "jsonwebtoken";
import { Expo } from 'expo-server-sdk';
import { AuthWithLocation, AuthWithLocationSchema } from "./interfaces/api";
import { deleteExpiredLandmines, deleteExpiredLoot, deleteExpiredMissiles, haversine, updateMissilePositions, addRandomLoot, getRandomCoordinates, checkPlayerProximity } from "./runners/entitymanagment";
import { startNotificationManager } from "./runners/notificationhelper";
import { deleteAllBots, manageAIBots } from "./bots";
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
import { processDamage, startDamageProcessing } from "./runners/damageProcessor";

export const prisma = new PrismaClient();

const wsServer = expressWs(express());
const app = wsServer.app;;

app.use(bodyParser.json());

// Swagger definition
const swaggerDefinition = {
  info: {
    title: "Missile Wars Backend",
    version: "1.0.0",
    description: "Endpoints to interact with the Missile Wars game backend",
  },
  host: "localhost:3000", // Your host
  basePath: "/", // Base path for your API
};

// Options for the swagger docs
const options = {
  swaggerDefinition,
  apis: ["./routes/*.ts"], // Path to the API routes folder
};

// Initialize swagger-jsdoc
const swaggerSpec = swaggerJSDoc(options);

// check if env is dev and serve swagger
if (process.env.NODE_ENV === "development") {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

//this function manages entities on the map
setInterval(deleteExpiredMissiles, 30000);
setInterval(addRandomLoot, 60000);
setInterval(deleteExpiredLandmines, 30000);
setInterval(deleteExpiredLoot, 30000);
setInterval(updateMissilePositions, 30000);
//player notificaitons
setInterval(checkPlayerProximity, 15000);

//manages notifications
startNotificationManager();

//manages leagues
setInterval(leagueRunner, 60 * 60 * 1000);
leagueRunner();

//manage damage:
startDamageProcessing();

//Bots:
//manageAIBots();

//deleteAllBots();


// api routes
setupAccessoryApi(app);
setupAuthRoutes(app);
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
  async (req, res) => {
    const location: AuthWithLocation = req.body;

    if (!location.token) {
      return res.status(401).json({ message: "Missing token" });
    }

    const decoded = jwt.verify(location.token, process.env.JWT_SECRET || "");

    if (!decoded) {
      return res.status(401).json({ message: "Invalid token" });
    }

    // Check if the user exists
    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: (decoded as JwtPayload).username as string,
      },
    });

    if (user) {
      const lastLocation = await prisma.locations.findFirst({
        where: {
          username: (decoded as JwtPayload).username as string,
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
              username: (decoded as JwtPayload).username as string,
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

let port = process.env.PORT;

app.listen(port, () => {
  console.log("listening on port", port);
});
