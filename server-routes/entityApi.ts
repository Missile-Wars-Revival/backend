import { prisma } from "../server";
import { Request, Response } from "express";
import { getRandomCoordinates, haversine } from "../runners/entitymanagment";
import { sendNotification } from "../runners/notificationhelper";
import { verifyToken } from "../utils/jwt";
import { z } from "zod";
import { handleAsync } from "../utils/router";
import _ from "lodash"

//Entering missiles and landmines into DB

export function setupEntityApi(app: any) {
  const FireMissileAtLocSchema = z.object({
    token: z.string(),
    destLat: z.string(),
    destLong: z.string(),
    type: z.string()
  })
  app.post("/api/firemissile@loc", handleAsync(async (req: Request, res: Response) => {
    const { token, destLat, destLong, type } = await FireMissileAtLocSchema.parseAsync(req.body);

    const claims = await verifyToken(token);

    const user = await prisma.gameplayUser.findFirst({
      where: { username: claims.username }
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const userLocation = await prisma.locations.findUnique({
      where: { username: claims.username }
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
    let timeToImpact = Math.round(distance / missileType.speed * 1000); // time in milliseconds
    
    // Add minimum time of 5-10 minutes
    const minAdditionalTime = 5 * 60 * 1000; // 5 minutes in milliseconds
    const maxAdditionalTime = 10 * 60 * 1000; // 10 minutes in milliseconds
    const additionalTime = Math.floor(Math.random() * (maxAdditionalTime - minAdditionalTime + 1)) + minAdditionalTime;
    timeToImpact += additionalTime;

    const existingItem = await prisma.inventoryItem.findFirst({
      where: { name: type, userId: user.id }
    });

    if (!existingItem || existingItem.quantity <= 0) {
      return res.status(404).json({ message: "Missile not found in inventory" });
    }

    await prisma.inventoryItem.update({
      where: { id: existingItem.id },
      data: {
        quantity: {
          decrement: 1
        }
      }
    });
    //to update user statistic
    const existingMissilePlace = await prisma.statistics.findFirst({
      where: {
        userId: user.id,
      },
    });

    if (existingMissilePlace) {
      await prisma.statistics.update({
        where: { id: existingMissilePlace.id },
        data: {
          numMissilesPlaced: {
            increment: 1
          }
        },
      });
    } else {
      await prisma.statistics.create({
        data: {
          userId: user.id,
          numMissilesPlaced: 1,
        },
      });
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
  }));

  const FireMissileAtPlayerSchema = z.object({
    token: z.string(),
    playerusername: z.string(),
    type: z.string()
  })
  app.post("/api/firemissile@player", handleAsync(async (req: Request, res: Response) => {
    const { token, playerusername, type } = req.body;

    const claims = await verifyToken(token);

    // Ensure user and their location are found
    const [user, userLocation, playerlocation] = await Promise.all([
      prisma.gameplayUser.findFirst({ where: { username: claims.username } }),
      prisma.locations.findUnique({ where: { username: claims.username } }),
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

    if (!existingItem || existingItem.quantity <= 0 || !missileType) {
      return res.status(404).json({ message: "Missile type or inventory item not found" });
    }

    // Calculate distance and time to impact
    const distance = haversine(userLocation.latitude, userLocation.longitude,
      playerlocation.latitude, playerlocation.longitude);
    let timeToImpact = Math.round(distance / missileType.speed * 1000); // time in milliseconds

    // Add minimum time of 5-10 minutes
    const minAdditionalTime = 5 * 60 * 1000; // 5 minutes in milliseconds
    const maxAdditionalTime = 10 * 60 * 1000; // 10 minutes in milliseconds
    const additionalTime = Math.floor(Math.random() * (maxAdditionalTime - minAdditionalTime + 1)) + minAdditionalTime;
    timeToImpact += additionalTime;

    // Update inventory and create missile entry
    await prisma.inventoryItem.update({
      where: { id: existingItem.id },
      data: {
        quantity: {
          decrement: 1
        }
      }
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
    }else{
      await prisma.statistics.update({
        where: { id: existingMissilePlace.id },
        data: {
          numMissilesPlaced: {
            increment: 1
          }
        },
      });
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
  }));

  const PlaceLandmineSchema = z.object({
    token: z.string(),
    locLat: z.string(),
    locLong: z.string(),
    landminetype: z.string()
  })
  app.post("/api/placelandmine", handleAsync(async (req: Request, res: Response) => {
    const { token, locLat, locLong, landminetype } = await PlaceLandmineSchema.parseAsync(req.body);

    // Verify the token and ensure it's decoded as an object
    const claims = await verifyToken(token);

    // Retrieve the user from the database
    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: claims.username,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const landmineType = await prisma.landmineType.findUnique({
      where: { name: landminetype }
    });

    if (!landmineType) {
      return res.status(404).json({ message: "Landmine type not found" });
    }

    // Check if the item is in the user's inventory
    const existingItem = await prisma.inventoryItem.findFirst({
      where: {
        name: landmineType.name,
        userId: user.id,
      },
    });

    if (!existingItem || existingItem.quantity <= 0) {
      return res.status(404).json({ message: "Landmine not found in inventory" });
    }

    // If item exists, update the quantity -1
    await prisma.inventoryItem.update({
      where: { id: existingItem.id },
      data: {
        quantity: {
          decrement: 1
        }
      },
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
    } else {
      await prisma.statistics.update({
        where: { id: existingLandminePlace.id },
        data: {
          numLandminesPlaced: {
            increment: 1
          }
        },
      });
    }

    // Convert duration from hours to milliseconds
    // landmine duration is in hours
    const durationInMilliseconds = landmineType.duration * 3600000;

    await prisma.landmine.create({
      data: {
        placedBy: user.username,
        locLat,
        locLong,
        type: landmineType.name,
        damage: landmineType.damage,
        Expires: new Date(new Date().getTime() + durationInMilliseconds)
      }
    });

    // Successful add item response
    res.status(200).json({ message: "Landmine added to map successfully" });
  }));

  const SteppedOnLandmineSchema = z.object({
    token: z.string(),
    landmineid: z.number().int(),
    landminedamage: z.number().int()
  })
  app.post("/api/steppedonlandmine", async (req: Request, res: Response) => {
    const { token, landmineid, landminedamage } = await SteppedOnLandmineSchema.parseAsync(req.body);

    try {
      // Verify the token and ensure it's decoded as an object
      const claims = await verifyToken(token);

      // Retrieve the user from the database
      const user = await prisma.gameplayUser.findFirst({
        where: {
          username: claims.username,
        },
      });

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      await prisma.gameplayUser.update({
        where: {
          username: claims.username,
        },
        data: {
          health: user.health - landminedamage,
        },
      });

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
  //this will take a location, item name
  const PlaceLootSchema = z.object({
    token: z.string(),
    locLat: z.string(),
    locLong: z.string(),
  })
  app.post("/api/placeloot", handleAsync(async (req: Request, res: Response) => {
    const { token, locLat, locLong } = await PlaceLootSchema.parseAsync(req.body);

    console.log("placing loot")

    // Verify the token and ensure it's decoded as an object
    const claims = await verifyToken(token);

    // Retrieve the user from the database
    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: claims.username,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if the item is in the user's inventory
    const existingItem = await prisma.inventoryItem.findFirst({
      where: {
        category: "Loot Drops",
        userId: user.id,
      },
    });

    if (!existingItem || existingItem.quantity <= 0) {
      return res.status(404).json({ message: "Loot Drops not found in inventory" });
    }

    // If item exists, update the quantity -1
    await prisma.inventoryItem.update({
      where: { id: existingItem.id },
      data: { quantity: existingItem.quantity - 1 },
    });

    // Randomly choose a rarity
    const rarities = ['Common', 'Uncommon', 'Rare'];
    const rarity = rarities[_.random(0, rarities.length - 1)];

    // Generate random coordinates within 100m radius
    const randomCoordinates = getRandomCoordinates(parseFloat(locLat), parseFloat(locLong), 100);

    const randomlocLat = randomCoordinates.latitude.toFixed(6);
    const randomlocLong = randomCoordinates.longitude.toFixed(6);

    // Create a new loot entry
    //console.log(`placing loot with location: ${randomlocLat} ${randomlocLong}, rarity: ${rarity}`)

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
    }else{
      await prisma.statistics.update({
        where: { id: existingLootPlace.id },
        data: {
          numLootPlaced: {
            increment: 1
          }
        },
      });
    }

    await prisma.loot.create({
      data: {
        locLat: randomlocLat,
        locLong: randomlocLong,
        rarity,
        Expires: new Date(new Date().getTime() + 86400000) // Expires in 24 hours
      }
    });

    // Successful add item response
    res.status(200).json({ message: "Loot placed successfully" });
  }));

  const PlaceShieldSchema = z.object({
    token: z.string(),
    type: z.union([
      z.literal("Shield"),
      z.literal("UltraShield"),
    ]),
    loclat: z.string(),
    loclong: z.string()
  })
  app.post("/api/placeshield", handleAsync(async (req: Request, res: Response) => {
    const { token, type, loclat, loclong } = await PlaceShieldSchema.parseAsync(req.body);    

    // Verify the token and decode it
    const claims = await verifyToken(token);

    // Retrieve the user first
    const user = await prisma.gameplayUser.findUnique({ 
      where: { username: claims.username } 
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Now find the inventory item using the user's id
    const existingItem = await prisma.inventoryItem.findFirst({
      where: {
        name: type,
        category: "Other",
        userId: user.id, // Use the user's id here
      },
    });

    if (!existingItem || existingItem.quantity <= 0) {
      return res.status(400).json({ message: "Shield not available in inventory" });
    }

    // Define shield properties based on type
    const shield = await prisma.otherType.findFirst({
      where: {
        name: type
      }
    })

    if (!shield) {
      return res.status(400).json({ message: "Invalid shield type" });
    }

    // Update inventory and create shield in a transaction
    await prisma.$transaction([
      prisma.inventoryItem.update({
        where: { id: existingItem.id },
        data: { quantity: { decrement: 1 } },
      }),
      prisma.other.create({
        data: {
          locLat: loclat,
          locLong: loclong,
          type,
          placedBy: user.username,
          radius: shield.radius,
          Expires: new Date(Date.now() + shield.duration),
        },
      }),
    ]);

    res.status(200).json({ message: `${type} placed successfully` });
  }));

  const LootPickupSchema = z.object({
    token: z.string(),
    lootid: z.coerce.number().int(),
    amount: z.coerce.number().int()
  })
  app.post("/api/lootpickup", handleAsync(async (req: Request, res: Response) => {
    const { token, lootid, amount } = await LootPickupSchema.parseAsync(req.body);

    const claims = await verifyToken(token);

    const user = await prisma.gameplayUser.findFirst({
      where: {
        username: claims.username,
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
          username: claims.username,
        },
        data: {
          money: {
            increment: amount
          },
          rankPoints: {
            increment: 200
          },
        },
      });

      // Update or create statistics
      let existingLootPickup = await prisma.statistics.findFirst({
        where: { userId: user.id },
      });

      if (existingLootPickup) {
        await prisma.statistics.update({
          where: { id: existingLootPickup.id },
          data: {
            numLootPickups: {
              increment: 1
            }
          },
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
          id: lootid,
        }
      });
    });

    // Respond after successful transaction
    res.status(200).json({ message: "Transaction completed successfully", details: result });
  }));

  const DeathRewardSchema = z.object({
    token: z.string(),
    itemType: z.string(),
    type: z.string(),
    sentby: z.string()
  })
  app.post("/api/deathreward", handleAsync(async (req: Request, res: Response) => {
    const { token, itemType, type, sentby } = await DeathRewardSchema.parseAsync(req.body);

    const claims = await verifyToken(token);

    const killedUsername = claims.username;

    const sender = await prisma.gameplayUser.findUnique({
        where: { username: sentby },
    });

    if (!sender) {
        return res.status(404).json({ success: false, message: "Sender not found" });
    }

    let rewardAmount = 0;
    let rankPointsReward = 0;

    if (itemType === "landmine") {
        const landmineType = await prisma.landmineType.findUnique({
            where: { name: type },
        });
        if (landmineType) {
            rewardAmount = Math.round(landmineType.price * 1.5);
            rankPointsReward = 30; // Base rank points for landmine kill
        }
    } else if (itemType === "missile") {
        const missileType = await prisma.missileType.findUnique({
            where: { name: type },
        });
        if (missileType) {
            rewardAmount = Math.round(missileType.price * 1.5);
            rankPointsReward = 40; // Base rank points for missile kill
        }
    }

    if (rewardAmount === 0) {
        return res.status(400).json({ success: false, message: "Invalid item type or type" });
    }

    // Add bonus rank points based on item price, but cap it
    const bonusPoints = Math.min(Math.round(rewardAmount / 100), 20); // 1 additional point per 100 coins, max 20 bonus points
    rankPointsReward += bonusPoints;

    // Cap total rank points reward
    rankPointsReward = Math.min(rankPointsReward, 67); // Ensure it never exceeds 67 points

    // Update sender's money and rank points
    await prisma.gameplayUser.update({
        where: { id: sender.id },
        data: {
            money: { increment: rewardAmount },
            rankPoints: { increment: rankPointsReward },
        },
    });

    // Create a notification for the sender (killer)
    await prisma.notifications.create({
        data: {
            userId: sender.username,
            title: "Kill Reward",
            body: `You've been rewarded ${rewardAmount} coins and ${rankPointsReward} rank points for killing ${killedUsername} with your ${itemType}!`,
            sentby: "server",
        },
    });

    res.status(200).json({
        success: true,
        message: "Death reward processed successfully",
        reward: {
            coins: rewardAmount,
            rankPoints: rankPointsReward,
        },
    });
  }));
}