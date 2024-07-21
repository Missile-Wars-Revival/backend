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
import { z, ZodError } from "zod";
import Stripe from 'stripe';
import { encode, decode } from "msgpack-lite";
import {
  AuthWithLocation,
  AuthWithLocationSchema,
  Login,
  LoginSchema,
  Register,
  RegisterSchema,
} from "./interfaces/api";

const prisma = new PrismaClient();

const wsServer = expressWs(express());
const app = wsServer.app;;

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

function authenticate(
  ws: import("ws"),
  req: express.Request<
    ParamsDictionary,
    any,
    any,
    ParsedQs,
    Record<string, any>
  >
) {
  const authToken = req.headers["sec-websocket-protocol"];

  if (
    (!authToken || authToken !== "missilewars") &&
    process.env.DISABLE_AUTH !== "ON"
  ) {
    ws.send(JSON.stringify({ error: "Authentication failed. Disconnecting." }));

    ws.close();
    return false;
  }

  return true;
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
  if (!authenticate(ws, req)) {
    logVerbose("Connection attempted but authentication failed");
    return;
  }

  logVerbose("New connection established");

  const sendPeriodicData = async () => {
    // Fetch all data
    let allMissiles = await prisma.missile.findMany();
    let processedMissiles = allMissiles.map(missile => middleearth.Missile.from_db(missile));

    let allLoot = await prisma.loot.findMany();
    let processedLoot = allLoot.map(loot => middleearth.Loot.from_db(loot));

    let allLandmines = await prisma.landmine.findMany();
    let processedLandmines = allLandmines.map(landmine => middleearth.Landmine.from_db(landmine));

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

  // Start sending data every 1 seconds
  const intervalId = setInterval(sendPeriodicData, 1000);

  ws.on("message", (message: Buffer /*: WebSocketMessage*/) => {
    //logVerbose("Received message:", message);
    // Determine if a message is encoded in MessagePack by trying
    // to unpack it

    let wsm: middleearth.WebSocketMessage;
    
    if (message.toString().slice(0, 6) === "devcon") {
        let devmsg = message.toString();
        ws.send("Dev console!");
        let words = devmsg.split(' ');
        if (words[1] === "add") {
            ws.send("Adding missile...");
        }

    }
    
    try {
      wsm = decode(message);
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
            ws.send(encode(new middleearth.WebSocketMessage([msg])));
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

  res.status(200).json({ message: "User created" });
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

    let whereClause = {};
    if (currentUser.GameplayUser && currentUser.GameplayUser.friendsOnly) {
      // If friendsOnly is enabled, filter by mutual friends and ensure they are alive
      whereClause = {
        AND: [
          { username: { in: mutualFriendsUsernames } },
          { isAlive: true }
        ]
      };
    } else {
      // If friendsOnly is not enabled, get users who are alive and either are not friendsOnly or are in mutual friends
      whereClause = {
        AND: [
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
      include: { location: true }
    });

    // Mapping to format output
    const locations = allGameplayUsers.map((gpu: { username: any; location: any; }) => ({
      username: gpu.username,
      ...gpu.location
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
  const username = req.query.username;

  if (typeof username !== 'string') {
    return res.status(400).json({ message: "Username is required and must be a single string." });
  }
  try {
    // Fetching the current user and their friends
    const currentUser = await prisma.users.findUnique({
      where: {
        username: username,
      },
      select: {
        friends: true,  // Assuming friends is an array of usernames
      }
    });

    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Fetch all other users excluding the current user
    const potentialUsers = await prisma.users.findMany({
      where: {
        username: {
          not: username
        }
      },
      select: {
        username: true,
        friends: true,  // Fetch friends to check for mutual friendship
        updatedAt: true,
      },
    });

    // Enhance potentialUsers with friendship status
    const enhancedUsers = potentialUsers.map((user: { username: any; }) => {
      return {
        ...user,
        isFriend: currentUser.friends.includes(user.username) ? "You are already friends with this person." : "Not friends."
      };
    });

    res.status(200).json(enhancedUsers);
  } catch (error) {
    console.error("Error fetching user data:", error);
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
    const mainUser = await prisma.users.findFirst({
      where: {
        username: decoded.username,
      },
    });

    if (!mainUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Exclude friends from the search
    const allUsers = await prisma.gameplayUser.findMany({
      where: {
        username: {
          not: {
            in: [decoded.username, ...mainUser.friends] // Exclude self and friends
          }
        }
      },
      include: {
        location: true // Include the location data
      }
    });

    const radiusInMeters = 15000; // 15 km
    const nearbyUsers = allUsers.filter(user =>
      user.location && geolib.isPointWithinRadius(
        { latitude: parseFloat(user.location.latitude), longitude: parseFloat(user.location.longitude) },
        { latitude, longitude },
        radiusInMeters
      )
    );

    if (nearbyUsers.length > 0) {
      res.status(200).json({ message: "Nearby users found", nearbyUsers });
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
    console.log("Friend added")
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
            rankPoints: user.health + amount, // Correctly add points to the current rankPoints
          },
        });

        res.status(200).json({ message: "Health added" });
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

    // Check if friendsOnly status is provided in the request body
    if (typeof req.body.isAlive !== 'boolean') {
      return res.status(400).json({ message: "isAlive status must be provided and be a boolean." });
    }

    // Update the friendsOnly status in the GameplayUser table
    const updatedUser = await prisma.gameplayUser.update({
      where: {
        username: decoded.username
      },
      data: {
        isAlive: req.body.isAlive
      }
    });

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
