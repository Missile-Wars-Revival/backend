import express, { Request, Response, NextFunction } from "express";
import bodyParser from "body-parser";
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import swaggerUi from "swagger-ui-express";
import swaggerJSDoc from "swagger-jsdoc";
import expressWs from "express-ws";
import { ParamsDictionary } from "express-serve-static-core";
import { ParsedQs } from "qs";
import * as geolib from 'geolib';
import * as jwt from "jsonwebtoken";
import { JwtPayload } from "jsonwebtoken";
import * as middleearth from "middle-earth";
import { number, z, ZodError } from "zod";
import Stripe from 'stripe';
import { Expo } from 'expo-server-sdk';
import {
  AuthWithLocation,
  AuthWithLocationSchema,
  Login,
  LoginSchema,
  Register,
  RegisterSchema,
} from "./interfaces/api";
import { deleteExpiredLandmines, deleteExpiredLoot, deleteExpiredMissiles, haversine, updateMissilePositions, addRandomLoot, getRandomCoordinates } from "./entitymanagment";
import { sendNotification, startNotificationManager } from "./notificationhelper";

export const prisma = new PrismaClient();

const wsServer = expressWs(express());
const app = wsServer.app;;

const expo = new Expo();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20'
});

app.use(bodyParser.json());

// Swagger definition
const swaggerDefinition = {
  info: {
    title: "Missile Wars Backend",
    version: "0.0.1",
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

function logVerbose(...items: any[]) {
  // Logs an item only if the VERBOSE_MODE env variable is set
  if (process.env.VERBOSE_MODE === "ON") {
    /*for (let item in items) {
      process.stdout.write(item);
  } */
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

const validateSchema =
  (schema: z.ZodSchema) =>
    (req: Request, res: Response, next: NextFunction) => {
      try {
        schema.parse(req.body);
        next();
      } catch (error) {
        if (error instanceof ZodError) {
          return res.status(400).json(error.errors);
        }
        next(error); // Pass the error to the next error handler
      }
    };

app.ws("/", (ws, req) => {
  // Perform authentication when a new connection is established

  const authResult = authenticate(ws, req);

  if (!authResult.success) {
    console.log("Connection attempted but authentication failed");
    return;
  }

  const username = authResult.username; //users username    

  logVerbose("New connection established")

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
    let processedLoot = allLoot.map((loot: any) => middleearth.Loot.from_db(loot));

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

      if (!currentUser) {
        return
      }

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
            { isAlive: true } // Only include alive users
          ]
        };
      } else {
        // If friendsOnly is not enabled, get users who are alive and either are not friendsOnly or are in mutual friends (excluding current user)
        whereClause = {
          AND: [
            { username: { not: { equals: currentUser.username } } }, // Exclude current user
            { isAlive: true },
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

      // Mapping to format output
      const locations = allGameplayUsers.map((gpu) => ({
        username: gpu.username,
        ...gpu.Locations
      }));
      //bundle for sending
      let playerslocations = locations
      let userinventory = inventory
      let dataBundle = new middleearth.WebSocketMessage([
        new middleearth.WSMsg('health', userhealth),
        new middleearth.WSMsg('inventory', userinventory),
        new middleearth.WSMsg('playerlocations', playerslocations)
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

  // Start sending data every 1 seconds
  const intervalId = setInterval(sendPeriodicData, 1000); //1 second
  sendLessPeriodicData()
  const lessintervalId = setInterval(sendLessPeriodicData, 10000);//10 seconds

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

app.post("/api/login", validateSchema(LoginSchema), async (req, res) => {
  const login: Login = req.body;

  const user = await prisma.users.findFirst({
    where: {
      username: login.username,
    },
  });

  if (user && (await argon2.verify(user.password, login.password))) {
    const token = jwt.sign(
      { username: user.username, password: user.password },
      process.env.JWT_SECRET || ""
    );

    await prisma.users.update({
      where: {
        username: login.username,
      },
      data: {
        notificationToken: login.notificationToken,
      },
    });

    res.status(200).json({ message: "Login successful", token });
  } else {
    res.status(401).json({ message: "Invalid username or password" });
  }
});

app.post("/api/register", validateSchema(RegisterSchema), async (req, res) => {
  const register: Register = req.body;

  const existingUser = await prisma.users.findFirst({
    where: {
      username: register.username,
    },
  });

  if (existingUser) {
    return res.status(409).json({ message: "User already exists" });
  }

  if (register.password.length < 8) {
    return res
      .status(400)
      .json({ message: "Password must be at least 8 characters long" });
  }

  if (register.username.length < 3) {
    return res
      .status(400)
      .json({ message: "Username must be at least 3 characters long" });
  }

  if (!register.username.match(/^[a-zA-Z0-9]+$/)) {
    return res
      .status(400)
      .json({ message: "Username must only contain letters and numbers" });
  }

  if (
    !register.password.match(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/
    )
  ) {
    return res.status(400).json({
      message:
        "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character",
    });
  }

  if (!register.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    return res.status(400).json({ message: "Invalid email address" });
  }

  if (
    (existingUser as unknown as { email: string })?.email === register.email
  ) {
    return res.status(400).json({ message: "Email already exists" });
  }

  const hashedPassword = await argon2.hash(register.password);

  await prisma.users.create({
    data: {
      username: register.username,
      password: hashedPassword,
      email: register.email,
    },
  });

  await prisma.gameplayUser.create({
    data: {
      username: register.username,
      createdAt: new Date().toISOString(),
    },
  });

  const token = jwt.sign(
    { username: register.username, password: register.password },
    process.env.JWT_SECRET || ""
  );

  res.status(200).json({ message: "User created", token });
});

//Entering missiles and landmines into DB

app.post("/api/firemissile@loc", async (req, res) => {
  const { token, destLat, destLong, type } = req.body;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
    if (typeof decoded === 'string' || !decoded.username) {
      return res.status(401).json({ message: "Invalid token" });
    }

    const user = await prisma.gameplayUser.findFirst({
      where: { username: decoded.username }
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const userLocation = await prisma.locations.findUnique({
      where: { username: decoded.username }
    });

    if (!userLocation) {
      return res.status(404).json({ message: "User location not found" });
    }

    const missileType = await prisma.missileType.findUnique({
      where: { name: type }
    });

    if (!missileType) {
      return res.status(404).json({ message: "Missile type not found" });
    }

    const distance = haversine(userLocation.latitude, userLocation.longitude, destLat, destLong);
    const timeToImpact = Math.round(distance / missileType.speed * 1000); // time in milliseconds

    const existingItem = await prisma.inventoryItem.findFirst({
      where: { name: type, userId: user.id }
    });

    if (existingItem) {
      await prisma.inventoryItem.update({
        where: { id: existingItem.id },
        data: { quantity: existingItem.quantity - 1 }
      });
      //to update user statistic
      const existingMissilePlace = await prisma.statistics.findFirst({
        where: {
          userId: user.id,
        },
      });

      if (!existingMissilePlace) {
        await prisma.statistics.create({
          data: {
            userId: user.id,
            numMissilesPlaced: 1,
          },
        });
      }

      if (existingMissilePlace) {
        await prisma.statistics.update({
          where: { id: existingMissilePlace.id },
          data: { numMissilesPlaced: existingMissilePlace.numMissilesPlaced + 1 },
        });
      } else {
        //console.error("Error: No statistics record found for the user.");
      }

      await prisma.missile.create({
        data: {
          destLat,
          destLong,
          radius: missileType.radius,
          damage: missileType.damage,
          type: type,
          sentBy: user.username,
          sentAt: new Date(),
          status: "Incoming",
          currentLat: userLocation.latitude,
          currentLong: userLocation.longitude,
          timeToImpact: new Date(new Date().getTime() + timeToImpact)
        }
      });

      res.status(200).json({ message: "Missile fired successfully" });
    } else {
      res.status(404).json({ message: "Missile not found in inventory" });
    }
  } catch (error) {
    console.error("Operation failed: ", error);
    res.status(500).json({ message: "Operation failed" });
  }
});

app.post("/api/firemissile@player", async (req, res) => {
  const { token, playerusername, type } = req.body;

  try {
    // Verify the token and ensure it's decoded as an object
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "");
    if (typeof decoded === 'string' || !decoded.username) {
      return res.status(401).json({ message: "Invalid token" });
    }

    // Ensure user and their location are found
    const [user, userLocation, playerlocation] = await Promise.all([
      prisma.gameplayUser.findFirst({ where: { username: decoded.username } }),
      prisma.locations.findUnique({ where: { username: decoded.username } }),
      prisma.locations.findUnique({ where: { username: playerusername } })
    ]);

    if (!user || !userLocation || !playerlocation) {
      return res.status(404).json({ message: "Relevant data not found" });
    }

    // Get missile data and check inventory
    const [missileType, existingItem] = await Promise.all([
      prisma.missileType.findUnique({ where: { name: type } }),
      prisma.inventoryItem.findFirst({
        where: { name: type, userId: user.id }
      })
    ]);

    if (!existingItem || !missileType) {
      return res.status(404).json({ message: "Missile type or inventory item not found" });
    }

    // Calculate distance and time to impact
    const distance = haversine(userLocation.latitude, userLocation.longitude,
      playerlocation.latitude, playerlocation.longitude);
    const timeToImpact = distance / missileType.speed * 1000; // time in milliseconds

    // Update inventory and create missile entry
    await prisma.inventoryItem.update({
      where: { id: existingItem.id },
      data: { quantity: existingItem.quantity - 1 }
    });
    //to update user stats
    const existingMissilePlace = await prisma.statistics.findFirst({
      where: {
        userId: user.id,
      },
    });

    if (!existingMissilePlace) {
      await prisma.statistics.create({
        data: {
          userId: user.id,
          numMissilesPlaced: 1,
        },
      });
    }

    if (existingMissilePlace) {
      await prisma.statistics.update({
        where: { id: existingMissilePlace.id },
        data: { numMissilesPlaced: existingMissilePlace.numMissilesPlaced + 1 },
      });
    } else {
      //console.error("Error: No statistics record found for the user.");
    }

    await prisma.missile.create({
      data: {
        destLat: playerlocation.latitude,
        destLong: playerlocation.longitude,
        radius: missileType.radius,
        damage: missileType.damage,
        type: type,
        sentBy: user.username,
        sentAt: new Date(),
        status: "Incoming",
        currentLat: userLocation.latitude,
        currentLong: userLocation.longitude,
        timeToImpact: new Date(new Date().getTime() + timeToImpact)
      }
    });
    await sendNotification(playerusername, "Incoming Missile!", `A missile has been fired at you by ${user.username}!`, user.username);
    res.status(200).json({ message: "Missile fired successfully" });
  } catch (error) {
    console.error("Missile firing failed: ", error);
    res.status(500).json({ message: "Missile firing failed" });
  }
});

//this function manages entities on the map
setInterval(deleteExpiredMissiles, 30000);
setInterval(addRandomLoot, 60000);
setInterval(deleteExpiredLandmines, 30000);
setInterval(deleteExpiredLoot, 30000);
setInterval(updateMissilePositions, 30000);

//manages notifications
startNotificationManager();


app.post("/api/placelandmine", async (req, res) => {
  const { token, locLat, locLong, landminetype } = req.body;

  try {
    // Verify the token and ensure it's decoded as an object
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

    if (typeof decoded === 'string' || !decoded.username) {
      return res.status(401).json({ message: "Invalid token" });
    }

    // Retrieve the user from the database
    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: decoded.username,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if the item is in the user's inventory
    const existingItem = await prisma.inventoryItem.findFirst({
      where: {
        name: landminetype,
        userId: user.id,
      },
    });

    if (existingItem) {
      // If item exists, update the quantity -1
      await prisma.inventoryItem.update({
        where: { id: existingItem.id },
        data: { quantity: existingItem.quantity - 1 },
      });

      //update landmine statistic
      const existingLandminePlace = await prisma.statistics.findFirst({
        where: {
          userId: user.id,
        },
      });
      if (!existingLandminePlace) {
        await prisma.statistics.create({
          data: {
            userId: user.id,
            numLandminesPlaced: 1,
          },
        });
      }

      if (existingLandminePlace) {
        await prisma.statistics.update({
          where: { id: existingLandminePlace.id },
          data: { numLandminesPlaced: existingLandminePlace.numLandminesPlaced + 1 },
        });
      } else {
        //console.error("Error: No statistics record found for the user.");
      }

      const landmineType = await prisma.landmineType.findUnique({
        where: { name: landminetype }
      });

      if (!landmineType) {
        return res.status(404).json({ message: "Landmine type not found" });
      }

      // Convert duration from hours to milliseconds
      // landmine duration is in hours
      const durationInMilliseconds = landmineType.duration * 3600000;

      await prisma.landmine.create({
        data: {
          placedBy: user.username,
          locLat,
          locLong,
          placedtime: new Date().toISOString(),
          type: landminetype,
          damage: landmineType.damage,
          Expires: new Date(new Date().getTime() + durationInMilliseconds) 
        }
      });

    } else {
      // If item does not exist
    }

    // Successful add item response
    res.status(200).json({ message: "Landmine added to map successfully" });
  } catch (error) {
    console.error("Add item failed: ", error);
    res.status(500).json({ message: "Add landmine to map failed" });
  }
});

app.post("/api/steppedonlandmine", async (req, res) => {
  const { token, landmineid, landminedamage } = req.body;

  try {
    // Verify the token and ensure it's decoded as an object
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

    if (typeof decoded === 'string' || !decoded.username) {
      return res.status(401).json({ message: "Invalid token" });
    }

    // Retrieve the user from the database
    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: decoded.username,
      },
    });

    if (user) {
      await prisma.gameplayUser.update({
        where: {
          username: (decoded as JwtPayload).username as string,
        },
        data: {
          health: user.health - landminedamage,
        },
      });
    }

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    //Logic to alert user and reward that placed landmine here!!

    //delete landmine
    const result = await prisma.landmine.delete({
      where: {
        id: landmineid,
      }
    });

    // Successful add item response
    res.status(200).json({ message: `${result} Landmine removed successfully with id ${landmineid}` });
  } catch (error) {
    console.error("Add item failed: ", error);
    res.status(500).json({ message: "Landmine removed failed" });
  }
});

//place loot
const { random } = require('lodash');


//this will take a location, item name
app.post("/api/placeloot", async (req, res) => {
  const { token, locLat, locLong } = req.body;

  console.log("placing loot")

  try {
    // Verify the token and ensure it's decoded as an object
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

    if (typeof decoded === 'string' || !decoded.username) {
      return res.status(401).json({ message: "Invalid token" });
    }

    // Retrieve the user from the database
    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: decoded.username,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Randomly choose a rarity
    const rarities = ['Common', 'Uncommon', 'Rare'];
    const rarity = rarities[random(0, rarities.length - 1)];

    // Generate random coordinates within 100m radius
    const randomCoordinates = getRandomCoordinates(parseFloat(locLat), parseFloat(locLong), 100);

    const randomlocLat = randomCoordinates.latitude.toFixed(6);
    const randomlocLong = randomCoordinates.longitude.toFixed(6);

    // Check if the item is in the user's inventory
    const existingItem = await prisma.inventoryItem.findFirst({
      where: {
        category: "Loot Drops",
        userId: user.id,
      },
    });

    if (existingItem) {
      // If item exists, update the quantity -1
      await prisma.inventoryItem.update({
        where: { id: existingItem.id },
        data: { quantity: existingItem.quantity - 1 },
      });

      // Create a new loot entry
      //console.log(`placing loot with locaiton: ${randomlocLat} ${randomlocLong}, rarity: ${rarity}`)

      //update loot statistic
      const existingLootPlace = await prisma.statistics.findFirst({
        where: {
          userId: user.id,
        },
      });

      if (!existingLootPlace) {
        await prisma.statistics.create({
          data: {
            userId: user.id,
            numLootPlaced: 1,
          },
        });
      }

      if (existingLootPlace) {
        await prisma.statistics.update({
          where: { id: existingLootPlace.id },
          data: { numLootPlaced: existingLootPlace.numLootPlaced + 1 },
        });
      } else {
        //console.error("Error: No statistics record found for the user.");
      }

      await prisma.loot.create({
        data: {
          locLat: randomlocLat,
          locLong: randomlocLong,
          rarity,
          Expires: new Date(new Date().getTime() + 86400000) // Expires in 24 hours
        }
      });

    } else {
      // If item does not exist
    }

    // Successful add item response
    res.status(200).json({ message: "Loot placed successfully" });
  } catch (error) {
    console.error("Add item failed: ", error);
    res.status(500).json({ message: "Add loot to map failed" });
  }
});

app.post("/api/lootpickup", async (req, res) => {
  const { token, lootid, amount } = req.body;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

    if (typeof decoded === 'string' || !decoded.username) {
      return res.status(401).json({ message: "Invalid token" });
    }

    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: decoded.username,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Start a transaction
    const result = await prisma.$transaction(async (prisma) => {
      // Update user
      await prisma.gameplayUser.update({
        where: {
          username: decoded.username,
        },
        data: {
          money: user.money + amount,
          rankPoints: user.rankPoints + 200,
        },
      });

      // Update or create statistics
      let existingLootPickup = await prisma.statistics.findFirst({
        where: { userId: user.id },
      });

      if (existingLootPickup) {
        await prisma.statistics.update({
          where: { id: existingLootPickup.id },
          data: { numLootPickups: existingLootPickup.numLootPickups + 1 },
        });
      } else {
        await prisma.statistics.create({
          data: {
            userId: user.id,
            numLootPickups: 1,
          },
        });
      }

      // Delete loot
      return prisma.loot.delete({
        where: {
          id: parseInt(lootid),
        }
      });
    });

    // Respond after successful transaction
    res.status(200).json({ message: "Transaction completed successfully", details: result });
  } catch (error) {
    console.error("Transaction failed: ", error);
    res.status(500).json({ message: "Transaction failed" });
  }
});

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

      if (lastLocation) {
        // User already has a location, update it
        try {
          await prisma.locations.update({
            where: {
              username: lastLocation.username,
            },
            data: {
              latitude: location.latitude,
              longitude: location.longitude,
              updatedAt: new Date().toISOString(), // Convert Date object to string
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
              updatedAt: new Date().toISOString(), // Convert Date object to string
            },
          });
        } catch (error) {
          console.error("Failed to create location:", error);
          return res.status(500).json({ message: "Failed to create location" });
        }
      }
      res.status(200).json({ message: "Location dispatched" });
      //console.log("Location dispatched")
    } else {
      res.status(404).json({ message: "User not found" });
      console.log("user not found")
    }
  }
);

async function getMutualFriends(currentUser: { friends: any; username: string; }) {
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

interface Statistics {
  badges: string[];
  numDeaths: number;
  numLootPlaced: number;
  numLandminesPlaced: number;
  numMissilesPlaced: number;
  numLootPickups: number;
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

app.get("/api/user-profile", async (req, res) => {
  const { token, username } = req.query;

  if (!token || !username) {
    return res.status(400).json({ success: false, message: "Missing token or username" });
  }

  try {
    const decoded = jwt.verify(token as string, process.env.JWT_SECRET || "");
    if (typeof decoded === 'string' || !decoded.username) {
      return res.status(401).json({ success: false, message: "Invalid token" });
    }

    const user = await prisma.users.findUnique({
      where: { username: username as string },
      include: {
        GameplayUser: {
          include: {
            Statistics: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const mutualFriends = await getMutualFriends(user);

    const statistics: Statistics = {
      badges: user.GameplayUser?.Statistics[0]?.badges || [],
      numDeaths: user.GameplayUser?.Statistics[0]?.numDeaths || 0,
      numLootPlaced: user.GameplayUser?.Statistics[0]?.numLootPlaced || 0,
      numLandminesPlaced: user.GameplayUser?.Statistics[0]?.numLandminesPlaced || 0,
      numMissilesPlaced: user.GameplayUser?.Statistics[0]?.numMissilesPlaced || 0,
      numLootPickups: user.GameplayUser?.Statistics[0]?.numLootPickups || 0,
    };

    const userProfile: UserProfile = {
      username: user.username,
      rankpoints: user.GameplayUser?.rankPoints || 0,
      mutualFriends: mutualFriends,
      statistics: statistics
    };

    res.status(200).json({ success: true, userProfile });
  } catch (error) {
    console.error("Failed to get user profile:", error);
    res.status(500).json({ success: false, message: "Failed to get user profile" });
  }
});

app.get("/api/self-profile", async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ success: false, message: "Missing token" });
  }

  try {
    const decoded = jwt.verify(token as string, process.env.JWT_SECRET || "");
    if (typeof decoded === 'string' || !decoded.username) {
      return res.status(401).json({ success: false, message: "Invalid token" });
    }

    const user = await prisma.users.findUnique({
      where: { username: decoded.username },
      include: {
        GameplayUser: {
          include: {
            Statistics: true
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
    };

    const userProfile: SelfProfile = {
      username: user.username,
      email: user.email,
      rankpoints: user.GameplayUser?.rankPoints || 0,
      mutualFriends: mutualFriends,
      statistics: statistics
    };

    res.status(200).json({ success: true, userProfile });
  } catch (error) {
    console.error("Failed to get self profile:", error);
    res.status(500).json({ success: false, message: "Failed to get self profile" });
  }
});

app.get("/api/playerlocations", async (req, res) => {
  const token = req.query.token;

  if (typeof token !== 'string' || !token.trim()) {
    return res.status(400).json({ message: "Token is required and must be a non-empty string." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

    if (typeof decoded === 'string' || !decoded.username) {
      return res.status(401).json({ message: "Invalid token" });
    }

    const currentUser = await prisma.users.findUnique({
      where: { username: decoded.username },
      include: { GameplayUser: true }
    });

    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

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
          { isAlive: true } // Only include alive users
        ]
      };
    } else {
      // If friendsOnly is not enabled, get users who are alive and either are not friendsOnly or are in mutual friends (excluding current user)
      whereClause = {
        AND: [
          { username: { not: { equals: currentUser.username } } }, // Exclude current user
          { isAlive: true },
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

    // Mapping to format output
    const locations = allGameplayUsers.map((gpu) => ({
      username: gpu.username,
      ...gpu.Locations
    }));

    res.status(200).json(locations);
  } catch (error) {
    console.error("Error fetching locations:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.patch("/api/friendsOnlyStatus", async (req, res) => {
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

app.get("/api/searchplayers", async (req, res) => {
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

app.get("/api/searchfriendsadded", async (req, res) => {
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

app.get("/api/nearby", async (req, res) => {
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

      const distance = geolib.getDistance(
        { latitude, longitude },
        { latitude: parseFloat(userLoc.latitude), longitude: parseFloat(userLoc.longitude) }
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

app.get("/api/friends", async (req, res) => {
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
  const { token, friend } = req.body; // Destructuring from req.body

  if (typeof token !== 'string' || !token.trim()) {
    return res.status(400).json({ message: "Token is required and must be a non-empty string." });
  }

  try {
    // Verify the token and ensure it's treated as an object
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as { username: string; };
    if (!decoded.username) {
      return res.status(401).json({ message: "Invalid token: Username is missing." });
    }

    // Retrieve the user from the database based on the username decoded from the token
    const user = await prisma.users.findFirst({
      where: {
        username: decoded.username,
      },
    });

    if (!user) {
      console.log("User not found")
      return res.status(404).json({ message: "User not found" });
    }

    // Check if the friend exists
    const friendUser = await prisma.users.findFirst({
      where: {
        username: friend,
      },
    });

    if (!friendUser) {
      return res.status(404).json({ message: "Friend not found" });
    }

    // Check if the friend is already added
    if (user.friends.includes(friend)) {
      console.log("Friend already added")
      return res.status(409).json({ message: "Friend already added" });
    }

    // Add friend
    await prisma.users.update({
      where: {
      username: user.username,
      },
      data: {
        friends: {
          push: friend,
        },
      },
    });
    await sendNotification(friend, "Friend Request", `${user.username} has added you as a friend!`, user.username);
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

app.get("/api/testusers", async (req, res) => {
  const users = await prisma.users.findMany({
    where: {
      username: {
        contains: "test",
      },
    },
  });
  res.status(200).json({ users });
});

app.get("/api/getuser", async (req, res) => {
  const { username } = req.query;
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

  if (user) {
    res.status(200).json({ ...fmtUser });
  } else {
    res.status(404).json({ message: "User not found" });
  }
});

app.post('/api/payment-intent', async (req, res) => {
  const { token, productId, price } = req.body;

  if (!token || typeof token !== 'string' || !token.trim()) {
    return res.status(400).json({ message: "Token is required and must be a non-empty string." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as { username: string; };
    const username = decoded.username;
    if (!username) {
      return res.status(401).json({ message: "Invalid token: Username is missing." });
    }

    // Fetch user by username
    const user = await prisma.users.findUnique({
      where: { username },
      select: { email: true, stripeCustomerId: true }
    });

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      // Create a new Stripe customer if not existing
      const newCustomer = await stripe.customers.create({
        email: user.email,
      });
      customerId = newCustomer.id;

      // Store new Stripe customer ID in your database
      await prisma.users.update({
        where: { username },
        data: { stripeCustomerId: customerId }
      });
    }

    // Create a payment intent with the Stripe customer ID
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(price * 100), // Convert price to cents
      currency: 'usd',
      customer: customerId,
      description: `Purchase of product ${productId}`,
      metadata: { productId }
    });

    res.json({
      status: 'pending',
      clientSecret: paymentIntent.client_secret,
    });

  } catch (error) {
    console.error('Error during payment initiation:', error);
    res.status(500).json({
      status: 'failed',
      message: "Server error during payment processing."
    });
  }
});

app.delete("/api/deleteNotificationToken", async (req, res) => {
  const { token } = req.body;

  try {
    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as { username: string };
    if (!decoded.username) {
      return res.status(401).json({ message: "Invalid token" });
    }

    // Update the user, setting notificationToken to null or an empty string
    await prisma.users.update({
      where: { username: decoded.username },
      data: { notificationToken: "" } // Using an empty string instead of null
    });

    res.status(200).json({ message: "Notification token deleted successfully" });
  } catch (error) {
    console.error("Error deleting notification token:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get("/api/notifications", async (req, res) => {
  const token = req.query.token as string;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as { username: string };
    if (!decoded.username) {
      return res.status(401).json({ message: "Invalid token" });
    }

    const notifications = await prisma.notifications.findMany({
      where: { userId: decoded.username },
      orderBy: { timestamp: 'desc' }
    });

    res.status(200).json({ notifications });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.delete("/api/deleteNotification", async (req, res) => {
  const { token, notificationId } = req.body;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as { username: string };
    if (!decoded.username) {
      return res.status(401).json({ message: "Invalid token" });
    }

    const deletedNotification = await prisma.notifications.deleteMany({
      where: {
        id: notificationId,
        userId: decoded.username
      }
    });

    if (deletedNotification.count === 0) {
      return res.status(404).json({ message: "Notification not found" });
    }

    res.status(200).json({ message: "Notification deleted successfully" });
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.patch("/api/markNotificationAsRead", async (req, res) => {
  const { token, notificationId } = req.body;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as { username: string };
    if (!decoded.username) {
      return res.status(401).json({ message: "Invalid token" });
    }

    const updatedNotification = await prisma.notifications.updateMany({
      where: {
        id: notificationId,
        userId: decoded.username
      },
      data: { isRead: true }
    });

    if (updatedNotification.count === 0) {
      return res.status(404).json({ message: "Notification not found" });
    }

    res.status(200).json({ message: "Notification marked as read successfully" });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.post("/api/purchaseItem", async (req, res) => {
  const { token, items, money } = req.body;

  try {
    // Verify the token and ensure it's treated as an object
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

    if (typeof decoded === 'string' || !decoded.username) {
      return res.status(401).json({ message: "Invalid token" });
    }

    // Retrieve the user from the database
    const user = await prisma.gameplayUser.findFirst({
    where: {
        username: decoded.username,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.money < money) {
      return res.status(400).json({ message: "Insufficient funds" });
    }

    // Ensure items is an array and contains valid objects
    if (!Array.isArray(items) || !items.every(item => typeof item.product.name === 'string' && typeof item.quantity === 'number' && typeof item.product.category === 'string')) {
      return res.status(400).json({ message: "Invalid items provided" });
    }

    // Start a transaction
    await prisma.$transaction(async (prisma: { gameplayUser: { update: (arg0: { where: { username: any; }; data: { money: number; }; }) => any; }; inventoryItem: { findFirst: (arg0: { where: { name: any; userId: any; }; }) => any; update: (arg0: { where: { id: any; }; data: { quantity: any; }; }) => any; create: (arg0: { data: { name: any; quantity: any; category: any; userId: any; }; }) => any; }; }) => {
      // Update user's money
      await prisma.gameplayUser.update({
        where: { username: decoded.username },
        data: { money: user.money - money },
      });

      for (const item of items) {
        const { name, category } = item.product;

        // Check if the item already exists in the user's inventory
        const existingItem = await prisma.inventoryItem.findFirst({
          where: {
            name: name,
            userId: user.id,
          },
        });

        if (existingItem) {
          // If item exists, update the quantity
          await prisma.inventoryItem.update({
            where: { id: existingItem.id },
            data: { quantity: existingItem.quantity + item.quantity },
          });
        } else {
          // If item does not exist, create a new entry
          await prisma.inventoryItem.create({
            data: {
              name: name,
              quantity: item.quantity,
              category: category,
              userId: user.id,
            },
          });
        }
      }
    });

    // Successful purchase response
    res.status(200).json({ message: "Items purchased" });
  } catch (error) {
    console.error("Transaction failed: ", error);
    res.status(500).json({ message: "Transaction failed" });
  }
});

app.post("/api/addItem", async (req, res) => {
  const { token, itemName, category } = req.body;

  try {
    // Verify the token and ensure it's decoded as an object
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

    if (typeof decoded === 'string' || !decoded.username) {
      return res.status(401).json({ message: "Invalid token" });
    }

    // Retrieve the user from the database
    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: decoded.username,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if the item is already in the user's inventory
    const existingItem = await prisma.inventoryItem.findFirst({
      where: {
        name: itemName,
        userId: user.id,
      },
    });

    if (existingItem) {
      // If item exists, update the quantity
      await prisma.inventoryItem.update({
        where: { id: existingItem.id },
        data: { quantity: existingItem.quantity + 1 },
      });
    } else {
      // If item does not exist, create a new entry
      await prisma.inventoryItem.create({
        data: {
          name: itemName,
          quantity: 1,
          category: category,  // Category is directly taken from the request body
          userId: user.id,
        },
      });
    }

    // Successful add item response
    res.status(200).json({ message: "Item added successfully" });
  } catch (error) {
    console.error("Add item failed: ", error);
    res.status(500).json({ message: "Add item failed" });
  }
});

app.get("/api/getInventory", async (req, res) => {
  const token = req.query.token;

  if (typeof token !== 'string') {
    return res.status(400).json({ message: "Token is required" });
  }

  try {
    // Verify the token and ensure it's treated as an object
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

    if (typeof decoded === 'string' || !decoded.username) {
      return res.status(401).json({ message: "Invalid token" });
    }

    // Retrieve the user from the database
    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: decoded.username,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Fetch the user's inventory
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

    // Return the inventory
    res.status(200).json(inventory);
  } catch (error) {
    console.error("Failed to fetch inventory: ", error);
    res.status(500).json({ message: "Failed to fetch inventory" });
  }
});

app.post("/api/addMoney", async (req, res) => {
  const { token, amount } = req.body;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

    // Ensure decoded is an object and has the username property
    if (typeof decoded === 'object' && 'username' in decoded) {
      const username = decoded.username;

      const user = await prisma.gameplayUser.findFirst({
        where: {
          username: username,
        },
      });

      if (user) {
        // Perform the update if the user is found
        await prisma.gameplayUser.update({
          where: {
            username: username,
          },
          data: {
            money: user.money + amount, // Ensure correct arithmetic operation
          },
        });

        res.status(200).json({ message: "Money added" });
      } else {
        res.status(404).json({ message: "User not found" });
      }
    } else {
      res.status(401).json({ message: "Invalid token" });
    }
  } catch (error) {
    res.status(500).json({ message: "Error verifying token" });
  }
});

app.post("/api/removeMoney", async (req, res) => {
  const { token, amount } = req.body;

  const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

  if (!decoded) {
    return res.status(401).json({ message: "Invalid token" });
  }

  const user = await prisma.gameplayUser.findFirst({
    where: {
      username: (decoded as JwtPayload).username as string,
    },
  });

  if (user) {
    await prisma.gameplayUser.update({
      where: {
        username: (decoded as JwtPayload).username as string,
      },
      data: {
        money: user.money - amount,
      },
    });

    res.status(200).json({ message: "Money removed" });
  } else {
    res.status(404).json({ message: "User not found" });
  }
});

app.get("/api/getMoney", async (req, res) => {
  const { token } = req.query;

  const decoded = jwt.verify(token as string, process.env.JWT_SECRET || "");

  if (!decoded) {
    return res.status(401).json({ message: "Invalid token" });
  }

  const user = await prisma.gameplayUser.findFirst({
    where: {
      username: (decoded as JwtPayload).username as string,
    },
  });

  if (user) {
    res.status(200).json({ money: user.money });
  } else {
    res.status(404).json({ message: "User not found" });
  }
});

app.post("/api/getRankPoints", async (req, res) => {
  const { token } = req.body;

  const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

  if (!decoded) {
    return res.status(401).json({ message: "Invalid token" });
  }

  const user = await prisma.gameplayUser.findFirst({
    where: {
      username: (decoded as JwtPayload).username as string,
    },
  });

  if (user) {
    res.status(200).json({ rankPoints: user.rankPoints });
  } else {
    res.status(404).json({ message: "User not found" });
  }
});

app.post("/api/addRankPoints", async (req, res) => {
  const { token, points } = req.body;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

    // Check if decoded is of type JwtPayload and has a username property
    if (typeof decoded === 'object' && 'username' in decoded) {
      const username = decoded.username;

      const user = await prisma.gameplayUser.findFirst({
        where: {
          username: username,
        },
      });

      if (user) {
        await prisma.gameplayUser.update({
          where: {
            username: username,
          },
          data: {
            rankPoints: user.rankPoints + points, // Correctly add points to the current rankPoints
          },
        });

        res.status(200).json({ message: "Rank points added" });
      } else {
        res.status(404).json({ message: "User not found" });
      }
    } else {
      // If decoded does not have a username property
      res.status(401).json({ message: "Invalid token" });
    }
  } catch (error) {
    res.status(500).json({ message: "Error verifying token" });
  }
});


app.post("/api/removeRankPoints", async (req, res) => {
  const { token, points } = req.body;

  const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

  if (!decoded) {
    return res.status(401).json({ message: "Invalid token" });
  }

  const user = await prisma.gameplayUser.findFirst({
    where: {
      username: (decoded as JwtPayload).username as string,
    },
  });

  if (user) {
    await prisma.gameplayUser.update({
      where: {
        username: (decoded as JwtPayload).username as string,
      },
      data: {
        rankPoints: user.rankPoints - points,
      },
    });

    res.status(200).json({ message: "Rank points removed" });
  } else {
    res.status(404).json({ message: "User not found" });
  }
});

app.post("/api/getRank", async (req, res) => {
  const { token } = req.body;

  const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

  if (!decoded) {
    return res.status(401).json({ message: "Invalid token" });
  }

  const user = await prisma.gameplayUser.findFirst({
    where: {
      username: (decoded as JwtPayload).username as string,
    },
  });

  if (user) {
    const rank = user.rank;

    res.status(200).json({ rank });
  } else {
    res.status(404).json({ message: "User not found" });
  }
});

app.post("/api/setRank", async (req, res) => {
  const { token, rank } = req.body;

  const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

  if (!decoded) {
    return res.status(401).json({ message: "Invalid token" });
  }

  const user = await prisma.gameplayUser.findFirst({
    where: {
      username: (decoded as JwtPayload).username as string,
    },
  });

  if (user) {
    await prisma.gameplayUser.update({
      where: {
        username: (decoded as JwtPayload).username as string,
      },
      data: {
        rank,
      },
    });

    res.status(200).json({ message: "Rank set" });
  } else {
    res.status(404).json({ message: "User not found" });
  }
});

//health
app.post("/api/getHealth", async (req, res) => {
  const { token } = req.body;

  const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

  if (!decoded) {
    return res.status(401).json({ message: "Invalid token" });
  }

  const user = await prisma.gameplayUser.findFirst({
    where: {
      username: (decoded as JwtPayload).username as string,
    },
  });

  if (user) {
    res.status(200).json({ health: user.health });
  } else {
    res.status(404).json({ message: "User not found" });
  }
});

app.post("/api/addHealth", async (req, res) => {
  const { token, amount } = req.body;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

    // Check if decoded is of type JwtPayload and has a username property
    if (typeof decoded === 'object' && 'username' in decoded) {
      const username = decoded.username;

      const user = await prisma.gameplayUser.findUnique({
        where: {
          username: username,
        },
      });

      if (user) {
        // Calculate new health without exceeding 100
        const newHealth = Math.min(user.health + amount, 100);

        await prisma.gameplayUser.update({
          where: {
            username: username,
          },
          data: {
            health: newHealth,
          },
        });

        res.status(200).json({ message: "Health added", health: newHealth });
      } else {
        res.status(404).json({ message: "User not found" });
      }
    } else {
      // If decoded does not have a username property
      res.status(401).json({ message: "Invalid token" });
    }
  } catch (error) {
    res.status(500).json({ message: "Error verifying token" });
  }
});

app.post("/api/removeHealth", async (req, res) => {
  const { token, amount } = req.body;

  const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

  if (!decoded) {
    return res.status(401).json({ message: "Invalid token" });
  }

  const user = await prisma.gameplayUser.findFirst({
    where: {
      username: (decoded as JwtPayload).username as string,
    },
  });

  if (user) {
    await prisma.gameplayUser.update({
      where: {
        username: (decoded as JwtPayload).username as string,
      },
      data: {
        health: user.health - amount,
      },
    });

    res.status(200).json({ message: "Health removed" });
  } else {
    res.status(404).json({ message: "User not found" });
  }
});

app.post("/api/setHealth", async (req, res) => {
  const { token, newHealth } = req.body;

  const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

  if (!decoded) {
    return res.status(401).json({ message: "Invalid token" });
  }

  const user = await prisma.gameplayUser.findFirst({
    where: {
      username: (decoded as JwtPayload).username as string,
    },
  });

  if (user) {
    await prisma.gameplayUser.update({
      where: {
        username: (decoded as JwtPayload).username as string,
      },
      data: {
        health: newHealth,
      },
    });

    res.status(200).json({ message: "Health set" });
  } else {
    res.status(404).json({ message: "User not found" });
  }
});

//isAlive
app.patch("/api/isAlive", async (req, res) => {
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

    if (typeof req.body.isAlive !== 'boolean') {
      return res.status(400).json({ message: "isAlive status must be provided and be a boolean." });
    }

    const updatedUser = await prisma.gameplayUser.update({
      where: {
        username: decoded.username
      },
      data: {
        isAlive: req.body.isAlive
      }
    });

    //update death statistic
    const existingDeaths = await prisma.statistics.findFirst({
      where: {
        userId: decoded.id,
      },
    });

    if (!existingDeaths) {
      await prisma.statistics.create({
        data: {
          userId: decoded.id,
          numDeaths: 1,
        },
      });
    }

    if (existingDeaths) {
      await prisma.statistics.update({
        where: { id: existingDeaths.id },
        data: { numDeaths: existingDeaths.numDeaths + 1 },
      });
    } else {
      //console.error("Error: No statistics record found for the user.");
    }

    // If no user is found or updated, send a 404 error
    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Return the updated user info
    res.status(200).json({
      message: "isAlive status updated successfully",
      user: {
        username: updatedUser.username,
        isAlive: updatedUser.isAlive
      }
    });
  } catch (error) {
    console.error("Error updating isAlive status:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.post("/api/getisAlive", async (req, res) => {
  const { token } = req.body;

  const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

  if (!decoded) {
    return res.status(401).json({ message: "Invalid token" });
  }

  const user = await prisma.gameplayUser.findFirst({
    where: {
      username: (decoded as JwtPayload).username as string,
    },
  });

  if (user) {
    res.status(200).json({ isAlive: user.isAlive });
  } else {
    res.status(404).json({ message: "User not found" });
  }
});


////////////////////////

let port = process.env.PORT;

app.listen(port, () => {
  console.log("listening on port", port);
});
