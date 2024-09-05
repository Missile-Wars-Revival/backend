import * as jwt from "jsonwebtoken";
import { prisma } from "../server";
import { Request, Response } from "express";
import { JwtPayload } from "jsonwebtoken";
import { getRandomCoordinates, haversine } from "../runners/entitymanagment";
import { sendNotification } from "../runners/notificationhelper";

//Entering missiles and landmines into DB

export function setupEntityApi(app: any) {
  app.post("/api/firemissile@loc", async (req: Request, res: Response) => {
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

  app.post("/api/firemissile@player", async (req: Request, res: Response) => {
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


  app.post("/api/placelandmine", async (req: Request, res: Response) => {
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

  app.post("/api/steppedonlandmine", async (req: Request, res: Response) => {
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
  app.post("/api/placeloot", async (req: Request, res: Response) => {
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

  app.post("/api/lootpickup", async (req: Request, res: Response) => {
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
}