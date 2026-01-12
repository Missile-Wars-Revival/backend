"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const swagger_jsdoc_1 = __importDefault(require("swagger-jsdoc"));
const express_ws_1 = __importDefault(require("express-ws"));
const jwt = __importStar(require("jsonwebtoken"));
const api_1 = require("./interfaces/api");
const entitymanagment_1 = require("./runners/entitymanagment");
const notificationhelper_1 = require("./runners/notificationhelper");
// import { deleteAllBots, manageAIBots } from "./bots";
const notificaitonApi_1 = require("./server-routes/notificaitonApi");
const friendsApi_1 = require("./server-routes/friendsApi");
const moneyApi_1 = require("./server-routes/moneyApi");
const authRoutes_1 = require("./server-routes/authRoutes");
const entityApi_1 = require("./server-routes/entityApi");
const accessoryApi_1 = require("./server-routes/accessoryApi");
const websocket_1 = require("./server-routes/websocket");
const userApi_1 = require("./server-routes/userApi");
const rankApi_1 = require("./server-routes/rankApi");
const healthApi_1 = require("./server-routes/healthApi");
const inventoryApi_1 = require("./server-routes/inventoryApi");
const leagueApi_1 = require("./server-routes/leagueApi");
const leaguemanagment_1 = require("./runners/leaguemanagment");
const damageProcessor_1 = require("./runners/damageProcessor");
const admin = __importStar(require("firebase-admin"));
const messageListener_1 = require("./runners/messageListener");
const shieldbreaker_1 = require("./runners/shieldbreaker");
const webApi_1 = require("./server-routes/webApi");
const { PrismaClient } = require('@prisma/client');
exports.prisma = new PrismaClient();
const wsServer = (0, express_ws_1.default)((0, express_1.default)());
const app = wsServer.app;
// Serve static files from public directory
const path_1 = __importDefault(require("path"));
app.use(express_1.default.static(path_1.default.join(__dirname, 'public')));
// Route to serve map.html
app.get('/map', (_req, res) => {
    res.sendFile(path_1.default.join(__dirname, 'public', 'map.html'));
});
app.get('/healthz', (_req, res) => {
    res.status(200).send('ok');
});
let serviceAccount;
try {
    serviceAccount = require("./firebasecred.json");
}
catch (error) {
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
}
else {
    console.warn("Firebase initialization skipped due to missing credentials");
}
app.use(body_parser_1.default.json());
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
const swaggerSpec = (0, swagger_jsdoc_1.default)(options);
// check if env is dev and serve swagger
// if (process.env.NODE_ENV === "development") {
//   app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
// }
// this function manages entities on the map
setInterval(entitymanagment_1.addRandomLoot, 30000);
setInterval(entitymanagment_1.updateMissilePositions, 30000);
setInterval(entitymanagment_1.deleteExpiredMissiles, 30000);
setInterval(entitymanagment_1.deleteExpiredLandmines, 30000);
setInterval(entitymanagment_1.deleteExpiredLoot, 30000);
setInterval(entitymanagment_1.deleteExpiredOther, 30000);
//player notificaitons
setInterval(entitymanagment_1.checkPlayerProximity, 15000);
//player loot
setInterval(entitymanagment_1.checkAndCollectLoot, 15000);
//manages notifications
(0, notificationhelper_1.startNotificationManager)();
// //manages leagues
setInterval(leaguemanagment_1.leagueRunner, 60 * 60 * 1000);
(0, leaguemanagment_1.leagueRunner)();
//manage damage:
(0, damageProcessor_1.startDamageProcessing)();
//manage shieldbreakers
(0, shieldbreaker_1.startShieldBreakerProcessing)();
//Bots:
// manageAIBots();
// deleteAllBots();
//Firebase Messages
if (serviceAccount) {
    (0, messageListener_1.setupMessageListener)();
}
else {
    console.warn("Skipping message listener setup due to missing Firebase credentials");
}
// api routes
(0, accessoryApi_1.setupAccessoryApi)(app);
(0, authRoutes_1.setupAuthRoutes)(app);
(0, webApi_1.setupWebApi)(app);
(0, entityApi_1.setupEntityApi)(app);
(0, friendsApi_1.setupFriendsApi)(app);
(0, healthApi_1.setupHealthApi)(app);
(0, inventoryApi_1.setupInventoryApi)(app);
(0, moneyApi_1.setupMoneyApi)(app);
(0, notificaitonApi_1.setupNotificationApi)(app);
(0, rankApi_1.setupRankApi)(app);
(0, userApi_1.setupUserApi)(app);
(0, websocket_1.setupWebSocket)(app);
(0, leagueApi_1.setupLeagueApi)(app);
// Next to convert to WS
app.post("/api/dispatch", (0, authRoutes_1.validateSchema)(api_1.AuthWithLocationSchema), async (req, res) => {
    const location = req.body;
    if (!location.token) {
        return res.status(401).json({ message: "Missing token" });
    }
    const decoded = jwt.verify(location.token, process.env.JWT_SECRET || "");
    if (!decoded) {
        return res.status(401).json({ message: "Invalid token" });
    }
    // Check if the user exists
    const user = await exports.prisma.gameplayUser.findFirst({
        where: {
            username: decoded.username,
        },
    });
    if (user) {
        const lastLocation = await exports.prisma.locations.findFirst({
            where: {
                username: decoded.username,
            },
            orderBy: {
                updatedAt: "desc",
            },
        });
        const now = new Date().toISOString();
        if (lastLocation) {
            // User already has a location, update it
            try {
                await exports.prisma.locations.update({
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
            }
            catch (error) {
                console.error("Failed to update location:", error);
                return res.status(500).json({ message: "Failed to update location" });
            }
        }
        else {
            // User does not have a location, create a new one
            try {
                await exports.prisma.locations.create({
                    data: {
                        username: decoded.username,
                        latitude: location.latitude,
                        longitude: location.longitude,
                        updatedAt: now,
                        lastUpdated: now,
                        // previousLat and previousLong will use their default values
                    },
                });
            }
            catch (error) {
                console.error("Failed to create location:", error);
                return res.status(500).json({ message: "Failed to create location" });
            }
        }
        res.status(200).json({ message: "Location dispatched" });
    }
    else {
        res.status(404).json({ message: "User not found" });
        console.log("user not found");
    }
});
////////////////////////
const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log("listening on port", port);
});
