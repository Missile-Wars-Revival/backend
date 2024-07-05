import express, { Request, Response, NextFunction } from "express";
import bodyParser from "body-parser";
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import swaggerUi from "swagger-ui-express";
import swaggerJSDoc from "swagger-jsdoc";
import expressWs from "express-ws";
import { ParamsDictionary } from "express-serve-static-core";
import { ParsedQs } from "qs";
import * as jwt from "jsonwebtoken";
import { JwtPayload } from "jsonwebtoken";
import { WebSocketMessage } from "middle-earth";
import * as middleearth from "middle-earth";
import { z, ZodError } from "zod";
import { pack, unpack } from "msgpackr";
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
const app = wsServer.app;

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

  ws.on("message", (message: string /*: WebSocketMessage*/) => {
    // Determine if a message is encoded in MessagePack by trying
    // to unpack it

    let wsm: middleearth.WebSocketMessage;
    
    if (message.slice(0, 6) === "devcon") {
        ws.send("Dev console!");
        let words = message.split(' ');
        if (words[1] === "add") {
            ws.send("Adding missile...");
        }

    }
    
    try {
      wsm = middleearth.unzip(Buffer.from(message));
    } catch {
      logVerbose("Not valid MessagePack");
      // Fall back to JSON if not MessagePack
      try {
        wsm = JSON.parse(message);
        logVerbose("Is JSON, ", typeof message);
      } catch {
        logVerbose("Not JSON, cannot decode");
        return;
      }
    }
    try {
      // Handle main communications here
      wsm.messages.forEach(async function (msg) {
        switch (msg.itemType) {
          case "Echo":
            ws.send(middleearth.zip_single(msg));
            break;

          case "FetchMissiles":
            logVerbose("Fetching Missiles...");
            let allMissiles = await prisma.missile.findMany();
            let processedMissiles: middleearth.Missile[] = [];
            for (let missile in allMissiles) {
              processedMissiles.push(middleearth.Missile.from_db(missile));
            }
            logVerbose(processedMissiles);
            let reply = new middleearth.MissileGroup(processedMissiles);
            ws.send(middleearth.zip_single(reply));
            break;

          default:
            logVerbose(
              "Msg received, but is not yet implemented and was skipped"
            );
        }
      });
    } catch {
      logVerbose(
        "Unable to handle messages. Please make sure they are being formatted correctly inside a WebSocketMessage."
      );
    }
  }); // </ws.on("message")>

  ws.send(JSON.stringify({ message: "Connection established" }));
  ws.on("close", () => {
    logVerbose("Connection closed");
  });
}); // </app.ws()>

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
      createdAt: new Date().toDateString(),
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
    } else {
      res.status(404).json({ message: "User not found" });
    }
  }
);

app.get("/api/playerlocations", async (req, res) => {
  try {
    const allLocations = await prisma.locations.findMany({
      select: {
        username: true,
        latitude: true,
        longitude: true,
        updatedAt: true,
      },
    });
    res.status(200).json(allLocations);
  } catch (error) {
    console.error("Error fetching locations:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get(
  "/api/nearby",
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
      // Approximate conversion factor from kilometers to degrees
      const kmToDegrees = 1 / 111.12; // Approximately 1 degree is 111.12 kilometers

      // Convert 15km radius to degrees
      const radiusInDegrees = 15 * kmToDegrees;

      const nearbyUsers = await prisma.gameplayUser.findMany({
        where: {
          username: {
            not: (decoded as JwtPayload).username as string,
          },
          location: {
            some: {
              latitude: {
                gte: String(parseInt(location.latitude) - radiusInDegrees),
                lte: String(parseInt(location.latitude) + radiusInDegrees),
              },
              longitude: {
                gte: String(parseInt(location.longitude) - radiusInDegrees),
                lte: String(parseInt(location.longitude) + radiusInDegrees),
              },
            },
          },
        },
      });

      if (nearbyUsers.length > 0) {
        res.status(200).json({ message: "Nearby users found", nearbyUsers });
      } else {
        res.status(404).json({ message: "No nearby users found" });
      }
    }
  }
);

app.post("/api/friends", async (req, res) => {
  const { username, password } = req.body; // Destructuring timestamp from req.body

  const user = await prisma.users.findFirst({
    where: {
      username: username,
    },
  });

  if (user) {
    if (await argon2.verify(user.password, password)) {
      const friends = await prisma.users.findMany({
        where: {
          username: {
            in: user.friends,
          },
        },
      });

      const friendUsers = await prisma.users.findMany({
        where: {
          username: {
            in: user.friends,
          },
        },
      });

      if (friends) {
        res.status(200).json({ message: "Friends found", friendUsers });
      } else {
        res.status(404).json({ message: "No friends found" });
      }
    }
  }
});

app.post("/api/addFriend", async (req, res) => {
  const { username, password, friend } = req.body; // Destructuring timestamp from req.body

  const user = await prisma.users.findFirst({
    where: {
      username: username,
    },
  });

  const friendUser = await prisma.users.findFirst({
    where: {
      username: friend,
    },
  });

  if (!friendUser) {
    return res.status(404).json({ message: "Friend not found" });
  }

  if (user) {
    if (await argon2.verify(user.password, password)) {
      await prisma.users.update({
        where: {
          username: username,
        },
        data: {
          friends: {
            push: friend,
          },
        },
      });

      res.status(200).json({ message: "Friend added" });
    } else {
      res.status(404).json({ message: "User not found" });
    }
  }
});

app.delete("/api/removeFriend", async (req, res) => {
  const { username, password, friend } = req.body; // Destructuring timestamp from req.body

  const user = await prisma.users.findFirst({
    where: {
      username: username,
    },
  });

  const friendUser = await prisma.users.findFirst({
    where: {
      username: friend,
    },
  });

  if (!friendUser) {
    return res.status(404).json({ message: "Friend not found" });
  }

  if (user) {
    if (await argon2.verify(user.password, password)) {
      await prisma.users.update({
        where: {
          username: username,
        },
        data: {
          friends: {
            set: user.friends.filter((f) => f !== friend),
          },
        },
      });

      res.status(204).end();
    } else {
      res.status(404).json({ message: "User not found" });
    }
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

app.post("/api/purchaseItem", async (req, res) => {
  const { token, item, money } = req.body;

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
    if (user.money >= money) {
      await prisma.gameplayUser.update({
        where: {
          username: (decoded as JwtPayload).username as string,
        },
        data: {
          money: user.money - money,
        },
      });

      // add item to user's inventory
      await prisma.gameplayUser.update({
        where: {
          username: (decoded as JwtPayload).username as string,
        },
        data: {
          inventory: {
            push: item,
          },
        },
      });

      res.status(200).json({ message: "Item purchased" });
    } else {
      res.status(400).json({ message: "Insufficient funds" });
    }
  } else {
    res.status(404).json({ message: "User not found" });
  }
});

app.post("/api/addMoney", async (req, res) => {
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
        money: user.money + amount,
      },
    });

    res.status(200).json({ message: "Money added" });
  } else {
    res.status(404).json({ message: "User not found" });
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

////////////////////////

let port = process.env.PORT;

app.listen(port, () => {
  console.log("listening on port", port);
});
