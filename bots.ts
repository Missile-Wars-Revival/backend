import { PrismaClient } from "@prisma/client";
import { sendNotification } from "./runners/notificationhelper";
import * as geolib from "geolib";
import { sample } from "lodash";
import * as tf from '@tensorflow/tfjs-node';

interface AIBot {
  id: number;
  username: string;
  latitude: number;
  longitude: number;
  lastUpdate: Date;
  isOnline: boolean;
  behaviorTree: BehaviorTree;
  personality: {
    aggressiveness: number;
    curiosity: number;
    sociability: number;
    tacticalAwareness: number;
    riskTolerance: number;
  };
  missilesFiredToday: number;
  lastMissileFiredAt: Date | null;
  money: number;
  inventory: {
    missiles: any[];
    // Add other inventory categories as needed
  };
}

class NeuralNetwork {
  model: tf.Sequential;

  constructor() {
    this.model = this.createModel();
  }

  createModel(): tf.Sequential {
    const model = tf.sequential();
    model.add(tf.layers.dense({ inputShape: [10], units: 16, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 8, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 5, activation: 'softmax' }));
    model.compile({ optimizer: 'adam', loss: 'categoricalCrossentropy' });
    return model;
  }

  predict(input: number[]): number[] {
    const inputTensor = tf.tensor2d([input]);
    const prediction = this.model.predict(inputTensor) as tf.Tensor;
    return Array.from(prediction.dataSync());
  }

  // Add methods for training the model if needed
}

class BehaviorTree {
  private bot: AIBot;
  private neuralNetwork: NeuralNetwork;

  constructor(bot: AIBot) {
    this.bot = bot;
    this.neuralNetwork = new NeuralNetwork();
  }

  async execute() {
    const input = this.getStateInput();
    const actionProbabilities = this.neuralNetwork.predict(input);
    const actionIndex = tf.argMax(actionProbabilities).dataSync()[0];

    switch (actionIndex) {
      case 0: await this.explore(); break;
      case 1: await this.attack(); break;
      case 2: await this.socialize(); break;
      case 3: await this.collectLoot(); break;
      case 4: await this.manageMissiles(); break;
    }
  }

  private getStateInput(): number[] {
    return [
      this.bot.personality.aggressiveness,
      this.bot.personality.curiosity,
      this.bot.personality.sociability,
      this.bot.personality.tacticalAwareness,
      this.bot.personality.riskTolerance,
      this.bot.missilesFiredToday / config.maxMissilesPerDay,
      this.bot.money / 1000, // Normalize money
      this.bot.inventory.missiles.length / 10, // Normalize missile count
      Math.random(), // Add some randomness
      this.bot.lastMissileFiredAt ? (Date.now() - this.bot.lastMissileFiredAt.getTime()) / (24 * 60 * 60 * 1000) : 1, // Time since last missile fired, normalized to 1 day
    ];
  }

  private async explore() {
    const newLocation = getRandomLandCoordinates();
    await updateBotPosition(this.bot, newLocation);
    console.log(`${this.bot.username} is exploring a new location.`);
  }

  private async attack() {
    if (this.bot.missilesFiredToday >= config.maxMissilesPerDay) {
      console.log(`${this.bot.username} has reached the daily missile limit.`);
      return;
    }

    if (this.bot.inventory.missiles.length === 0) {
      console.log(`${this.bot.username} has no missiles to fire.`);
      return;
    }

    const now = new Date();
    if (this.bot.lastMissileFiredAt && (now.getTime() - this.bot.lastMissileFiredAt.getTime()) < config.missileCooldownPeriod) {
      console.log(`${this.bot.username} is waiting for missile cooldown.`);
      return;
    }

    const player = await getRandomPlayer();
    if (player) {
      const missile = this.bot.inventory.missiles.pop(); // Use a missile from inventory
      if (missile) {
        await fireMissileAtPlayer(this.bot, player, missile);
        this.bot.missilesFiredToday++;
        this.bot.lastMissileFiredAt = now;
        console.log(`${this.bot.username} fired a ${missile.name} at ${player.username}`);
      }
    }
  }

  private async socialize() {
    const nearbyPlayers = await getNearbyPlayers(this.bot);
    if (nearbyPlayers.length > 0) {
      const player = sample(nearbyPlayers);
      if (player) {
        console.log(`${this.bot.username} is socializing with ${player.username}.`);
        await sendNotification(player.username, "Friendly Bot", `${this.bot.username} waves hello!`, this.bot.username);
      } else {
        console.log(`${this.bot.username} couldn't find anyone to socialize with.`);
      }
    } else {
      console.log(`${this.bot.username} couldn't find anyone to socialize with.`);
    }
  }

  private async collectLoot() {
    const loot = await findNearbyLoot(this.bot);
    if (loot) {
      console.log(`${this.bot.username} found ${loot.rarity} and collected it.`);
      await collectLootItem(this.bot, loot);
    } else {
      console.log(`${this.bot.username} couldn't find any loot nearby.`);
    }
  }

  private async idle() {
    console.log(`${this.bot.username} is idling.`);
  }

  private async manageMissiles() {
    if (this.bot.inventory.missiles.length < 3 && this.bot.money >= 100) {
      await this.buyMissile();
    }
  }

  private async buyMissile() {
    const missileTypes = await prisma.missileType.findMany();
    const affordableMissiles = missileTypes.filter(m => m.price <= this.bot.money);
    if (affordableMissiles.length > 0) {
      const missileType = sample(affordableMissiles);
      if (missileType) {
        this.bot.money -= missileType.price;
        this.bot.inventory.missiles.push(missileType);
        await prisma.gameplayUser.update({
          where: { username: this.bot.username },
          data: { 
            money: this.bot.money,
            InventoryItem: {
              create: {
                name: missileType.name,
                quantity: 1,
                category: 'missile'
              }
            }
          }
        });
        console.log(`${this.bot.username} bought a ${missileType.name} missile for $${missileType.price}`);
      }
    }
  }
}

const prisma = new PrismaClient();
const aiBots: AIBot[] = [];

const adjectives = ["Swift", "Brave", "Cunning", "Mighty", "Stealthy", "Tactical", "Resourceful", "Vigilant"];
const nouns = ["Eagle", "Tiger", "Wolf", "Bear", "Hawk", "Panther", "Falcon", "Viper"];

const config = {
  maxBots: 10,
  minBots: 5,
  updateInterval: 5000, // 5 seconds
  batchSize: 10,
  maxActiveMissiles: 30,
  maxMissilesPerDay: 5,
  pois: [
    { latitude: 40.7128, longitude: -74.0060, name: "New York" },
    { latitude: 34.0522, longitude: -118.2437, name: "Los Angeles" },
    { latitude: 51.5074, longitude: -0.1278, name: "London" },
    { latitude: 48.8566, longitude: 2.3522, name: "Paris" },
    { latitude: 35.6895, longitude: 139.6917, name: "Tokyo" },
    { latitude: 55.7558, longitude: 37.6173, name: "Moscow" },
    { latitude: -33.8688, longitude: 151.2093, name: "Sydney" },
    { latitude: 37.7749, longitude: -122.4194, name: "San Francisco" },
    { latitude: 39.9042, longitude: 116.4074, name: "Beijing" },
    { latitude: 19.4326, longitude: -99.1332, name: "Mexico City" },
    { latitude: 52.5200, longitude: 13.4050, name: "Berlin" },
    { latitude: 41.9028, longitude: 12.4964, name: "Rome" },
    { latitude: 40.4168, longitude: -3.7038, name: "Madrid" },
    { latitude: 25.2048, longitude: 55.2708, name: "Dubai" },
    { latitude: -22.9068, longitude: -43.1729, name: "Rio de Janeiro" },
    { latitude: 1.3521, longitude: 103.8198, name: "Singapore" },
    { latitude: 31.2304, longitude: 121.4737, name: "Shanghai" },
    { latitude: -37.8136, longitude: 144.9631, name: "Melbourne" },
    { latitude: 43.6532, longitude: -79.3832, name: "Toronto" },
    { latitude: 59.9139, longitude: 10.7522, name: "Oslo" },
  ],
  movementStepSize: 0.002,
  missileCooldownPeriod: 4 * 60 * 60 * 1000, // 4 hours in milliseconds
  maxRetries: 3,
  retryDelay: 1000, // 1 second
};

async function getActiveMissileCount() {
  const activeMissiles = await prisma.missile.count({
    where: { status: "Incoming" },
  });
  return activeMissiles;
}

async function fireMissileAtPlayer(bot: AIBot, player: any, missile: any) {
  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    try {
      if (!bot.latitude || !bot.longitude || !player.latitude || !player.longitude) {
        throw new Error("Bot or player coordinates are missing");
      }

      const distance = geolib.getDistance(
        { latitude: bot.latitude, longitude: bot.longitude },
        { latitude: player.latitude, longitude: player.longitude }
      );
      const timeToImpact = Math.round(distance / missile.speed * 1000); // time in milliseconds

      await prisma.missile.create({
        data: {
          destLat: player.latitude.toString(),
          destLong: player.longitude.toString(),
          radius: missile.radius,
          damage: missile.damage,
          type: missile.name,
          sentBy: bot.username,
          sentAt: new Date(),
          status: "Incoming",
          currentLat: bot.latitude.toString(),
          currentLong: bot.longitude.toString(),
          timeToImpact: new Date(new Date().getTime() + timeToImpact)
        },
      });

      console.log(`Missile fired successfully from ${bot.username} to ${player.username}`);

      await sendNotification(player.username, "Incoming Missile!", `A missile has been fired at you by ${bot.username}!`, bot.username);

      // After successfully firing the missile:
      const inventoryItem = await prisma.inventoryItem.findFirst({
        where: {
          GameplayUser: { username: bot.username },
          name: missile.name,
          category: 'missile'
        }
      });

      if (inventoryItem) {
        if (inventoryItem.quantity > 1) {
          await prisma.inventoryItem.update({
            where: { id: inventoryItem.id },
            data: { quantity: { decrement: 1 } }
          });
        } else {
          await prisma.inventoryItem.delete({
            where: { id: inventoryItem.id }
          });
        }
      }

      return; // Success, exit the function
    } catch (error) {
      console.error(`Attempt ${attempt + 1} failed to fire missile from ${bot.username} to ${player.username}:`, error);
      if (attempt === config.maxRetries - 1) {
        console.error(`All attempts to fire missile from ${bot.username} to ${player.username} have failed.`);
      } else {
        await new Promise(resolve => setTimeout(resolve, config.retryDelay));
      }
    }
  }
}

function generateRandomUsername() {
  const adjective = sample(adjectives);
  const noun = sample(nouns);
  const number = Math.floor(Math.random() * 1000);
  return `${adjective}${noun}${number}`;
}

function getRandomLandCoordinates() {
  const land = sample(config.pois);
  if (!land) {
    throw new Error("No land coordinates available");
  }
  return {
    latitude: land.latitude + (Math.random() - 0.5) * 0.01,
    longitude: land.longitude + (Math.random() - 0.5) * 0.01,
  };
}

function getRandomOfflineDuration() {
  const durationType = sample(["minutes", "hours", "days"]);
  let duration;

  switch (durationType) {
    case "minutes":
      duration = Math.floor(Math.random() * 60) + 1; // 1 to 60 minutes
      return duration * 60 * 1000; // Convert to milliseconds
    case "hours":
      duration = Math.floor(Math.random() * 24) + 1; // 1 to 24 hours
      return duration * 60 * 60 * 1000; // Convert to milliseconds
    case "days":
      duration = Math.floor(Math.random() * 7) + 1; // 1 to 7 days
      return duration * 24 * 60 * 60 * 1000; // Convert to milliseconds
    default:
      return 0;
  }
}

function setBotOffline(bot: AIBot) {
  bot.isOnline = false;

  setTimeout(() => {
    bot.isOnline = true;
  }, getRandomOfflineDuration());
}

async function getRandomMissileType() {
  const missileTypes = await prisma.missileType.findMany();
  return sample(missileTypes);
}

async function getRandomPlayer() {
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const players = await prisma.users.findMany({
    where: { role: { not: "bot" } }, // Exclude bots
    include: {
      GameplayUser: {
        include: {
          Locations: {
            where: {
              updatedAt: { gte: twoDaysAgo },
            },
          },
        },
      },
    },
  });

  const activePlayers = players.filter(player => player.GameplayUser && player.GameplayUser.Locations);
  const player = sample(activePlayers);
  if (player && player.GameplayUser && player.GameplayUser.Locations) {
    return {
      ...player,
      latitude: parseFloat(player.GameplayUser.Locations.latitude),
      longitude: parseFloat(player.GameplayUser.Locations.longitude),
    };
  }
  return null;
}

async function interactWithPlayers(bot: AIBot) {
  if (!bot.isOnline) {
    return;
  }

  const activeMissileCount = await getActiveMissileCount();
  if (activeMissileCount >= config.maxActiveMissiles) {
    console.log(`Too many active missiles. ${bot.username} will not fire a missile.`);
    return;
  }

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  // Count the number of missiles fired by this bot in the last 24 hours
  const missilesFiredToday = await prisma.missile.count({
    where: {
      sentBy: bot.username,
      sentAt: { gte: oneDayAgo },
    },
  });

  if (missilesFiredToday >= config.maxMissilesPerDay) {
    console.log(`${bot.username} has already fired the maximum number of missiles today.`);
    return;
  }

  if (Math.random() < bot.personality.aggressiveness * 0.05) { // 5% chance to interact with players
    const missileType = await getRandomMissileType();
    const player = await getRandomPlayer();
    if (missileType && player) {
      console.log(`${bot.username} is firing a ${missileType.name} missile at player ${player.username}!`);
      await fireMissileAtPlayer(bot, player, missileType);
      bot.lastMissileFiredAt = now; // Update the last missile fired time
    }
  }

  if (Math.random() < bot.personality.curiosity * 0.05) {
    await exploreNewLocation(bot);
  }
}

async function createBot() {
  const username = generateRandomUsername();
  const { latitude, longitude } = getRandomLandCoordinates();
  const bot: AIBot = {
    id: 0, // Temporary placeholder
    username,
    latitude,
    longitude,
    lastUpdate: new Date(),
    isOnline: true,
    behaviorTree: new BehaviorTree({} as AIBot), // Temporary placeholder
    personality: generateRandomPersonality(),
    missilesFiredToday: 0,
    lastMissileFiredAt: null,
    money: 0,
    inventory: {
      missiles: [],
      // Add other inventory categories as needed
    },
  };
  bot.behaviorTree = new BehaviorTree(bot); // Now we can pass the full bot object

  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    try {
      await prisma.$transaction(async (prisma) => {
        const createdBot = await prisma.users.create({
          data: {
            username: bot.username,
            role: "bot",
            GameplayUser: {
              create: {
                Locations: {
                  create: {
                    latitude: bot.latitude.toString(),
                    longitude: bot.longitude.toString(),
                    updatedAt: bot.lastUpdate,
                  },
                },
              },
            },
          },
        });
        bot.id = createdBot.id; // Update the bot's ID with the one from the database
      });
      aiBots.push(bot);
      return; // Success, exit the function
    } catch (error) {
      console.error(`Attempt ${attempt + 1} failed to create bot ${username}:`, error);
      if (attempt === config.maxRetries - 1) {
        console.error(`All attempts to create bot ${username} have failed.`);
      } else {
        await new Promise(resolve => setTimeout(resolve, config.retryDelay));
      }
    }
  }
}

function calculateNewPosition(bot: AIBot, target: { latitude: number; longitude: number }) {
  const distance = geolib.getDistance(
    { latitude: bot.latitude, longitude: bot.longitude },
    { latitude: target.latitude, longitude: target.longitude }
  );

  if (distance < config.movementStepSize * 1000) {
    return target; // If the target is within one step, move directly to the target
  }

  const newCoords = geolib.computeDestinationPoint(
    { latitude: bot.latitude, longitude: bot.longitude },
    config.movementStepSize * 1000, // Convert step size to meters
    geolib.getRhumbLineBearing(
      { latitude: bot.latitude, longitude: bot.longitude },
      { latitude: target.latitude, longitude: target.longitude }
    )
  );

  // Add some randomness to movement
  const randomFactor = 0.2; // Adjust this value to control randomness
  const randomAngle = Math.random() * 2 * Math.PI;
  const randomOffset = {
    latitude: Math.sin(randomAngle) * config.movementStepSize * randomFactor,
    longitude: Math.cos(randomAngle) * config.movementStepSize * randomFactor,
  };

  return {
    latitude: newCoords.latitude + randomOffset.latitude,
    longitude: newCoords.longitude + randomOffset.longitude,
  };
}

async function updateBotPosition(bot: AIBot, target: { latitude: number; longitude: number }) {
  if (!bot.isOnline) return;

  const newPosition = calculateNewPosition(bot, target);

  bot.latitude = newPosition.latitude;
  bot.longitude = newPosition.longitude;
  bot.lastUpdate = new Date();

  await prisma.locations.update({
    where: { username: bot.username },
    data: {
      latitude: bot.latitude.toString(),
      longitude: bot.longitude.toString(),
      updatedAt: bot.lastUpdate,
    },
  });

  await bot.behaviorTree.execute();
}

async function updateBotsInBatch(bots: AIBot[]) {
  const maxRetries = 5;
  const baseDelay = 100; // 100ms
  const batchSize = 10; // Adjust this value based on your needs

  for (let i = 0; i < bots.length; i += batchSize) {
    const batch = bots.slice(i, i + batchSize);
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await prisma.$transaction(async (prisma) => {
          for (const bot of batch) {
            await prisma.locations.upsert({
              where: { username: bot.username },
              update: {
                latitude: bot.latitude.toString(),
                longitude: bot.longitude.toString(),
                updatedAt: new Date(),
              },
              create: {
                username: bot.username,
                latitude: bot.latitude.toString(),
                longitude: bot.longitude.toString(),
                updatedAt: new Date(),
              },
            });
            // Small delay between each bot update
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        });

        console.log(`Updated locations for ${batch.length} bots`);
        break; // Success, move to next batch
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'P2034' && attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt);
          console.log(`Transaction failed due to conflict. Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw error; // Rethrow if it's not a conflict error or we've exhausted retries
        }
      }
    }
  }
}

async function manageAIBots() {
  await loadExistingBots();

  setInterval(async () => {
    const activePlayers = await prisma.users.count({
      where: { role: "player" },
    });

    const desiredBotCount = Math.min(
      config.maxBots,
      Math.max(config.minBots, Math.floor(activePlayers / 2))
    );

    while (aiBots.length < desiredBotCount) {
      await createBot();
    }

    while (aiBots.length > desiredBotCount) {
      const bot = aiBots.pop();
      if (bot) {
        try {
          // Delete related records first
          await prisma.$transaction(async (prisma) => {
            // Delete Notifications
            await prisma.notifications.deleteMany({ where: { userId: bot.username } });

            // Delete FriendRequests
            await prisma.friendRequests.deleteMany({ where: { username: bot.username } });
            await prisma.friendRequests.deleteMany({ where: { friend: bot.username } });

            // Delete BattleSessions
            await prisma.battleSessions.deleteMany({ where: { attackerUsername: bot.username } });
            await prisma.battleSessions.deleteMany({ where: { defenderUsername: bot.username } });

            // Delete Locations
            await prisma.locations.delete({ where: { username: bot.username } }).catch(() => {});

            // Delete InventoryItems
            await prisma.inventoryItem.deleteMany({ where: { GameplayUser: { username: bot.username } } });

            // Delete Statistics
            await prisma.statistics.deleteMany({ where: { GameplayUser: { username: bot.username } } });

            // Delete GameplayUser
            await prisma.gameplayUser.delete({ where: { username: bot.username } }).catch(() => {});

            // Finally, delete the User
            await prisma.users.delete({ where: { username: bot.username } });
          });

          console.log(`Successfully deleted bot: ${bot.username}`);
        } catch (error) {
          console.error(`Failed to delete bot ${bot.username}:`, error);
        }
      }
    }

    const botsToUpdate = aiBots.slice(0, config.batchSize);
    await updateBotsInBatch(botsToUpdate);  // Add this line

    for (const bot of botsToUpdate) {
      if (bot.isOnline) {
        await bot.behaviorTree.execute();
        // This assumes you have a way to check if a bot has defeated a player
        if (botHasDefeatedPlayer(bot)) {
          const defeatedPlayer = getDefeatedPlayer(bot);
          await earnMoneyFromDefeat(bot, defeatedPlayer);
        }
      } else if (Math.random() < 0.1) {
        bot.isOnline = true;
        console.log(`${bot.username} is back online.`);
      }
    }

    aiBots.forEach(bot => {
      if (Math.random() < 0.05) { // 5% chance to go offline
        setBotOffline(bot);
      } else if (Math.random() < 0.05) { // 5% chance to go to sleep
        setBotSleeping(bot);
      }
    });

    // Reset daily missile count at midnight
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 0) {
      aiBots.forEach(bot => {
        bot.missilesFiredToday = 0;
      });
      console.log("Daily missile counts reset for all bots.");
    }
  }, config.updateInterval);
}

function setBotSleeping(bot: AIBot) {
  bot.isOnline = false;

  setTimeout(() => {
    bot.isOnline = true;
  }, getRandomSleepDuration());
}

function getRandomSleepDuration() {
  const durationType = sample(["minutes", "hours"]);
  let duration;

  switch (durationType) {
    case "minutes":
      duration = Math.floor(Math.random() * 60) + 1; // 1 to 60 minutes
      return duration * 60 * 1000; // Convert to milliseconds
    case "hours":
      duration = Math.floor(Math.random() * 8) + 1; // 1 to 8 hours
      return duration * 60 * 60 * 1000; // Convert to milliseconds
    default:
      return 0;
  }
}

async function deleteAllBots() {
  await prisma.$transaction(async (prisma) => {
    // Delete Notifications related to bots
    await prisma.notifications.deleteMany({
      where: { user: { role: "bot" } }
    });

    // Delete FriendRequests related to bots
    await prisma.friendRequests.deleteMany({
      where: { 
        OR: [
          { GameplayUser: { Users: { role: "bot" } } },
          { friend: { in: await prisma.users.findMany({ where: { role: "bot" }, select: { username: true } }).then(users => users.map(u => u.username)) } }
        ]
      }
    });

    // Delete BattleSessions related to bots
    await prisma.battleSessions.deleteMany({
      where: { 
        OR: [
          { GameplayUser_BattleSessions_attackerUsernameToGameplayUser: { Users: { role: "bot" } } },
          { GameplayUser_BattleSessions_defenderUsernameToGameplayUser: { Users: { role: "bot" } } }
        ]
      }
    });

    // Delete InventoryItems related to bots
    await prisma.inventoryItem.deleteMany({
      where: { GameplayUser: { Users: { role: "bot" } } }
    });

    // Delete Statistics related to bots
    await prisma.statistics.deleteMany({
      where: { GameplayUser: { Users: { role: "bot" } } }
    });

    // Delete Locations related to bots
    await prisma.locations.deleteMany({
      where: { GameplayUser: { Users: { role: "bot" } } }
    });

    // Delete GameplayUser entries related to bots
    await prisma.gameplayUser.deleteMany({
      where: { Users: { role: "bot" } }
    });

    // Finally, delete the bot Users
    await prisma.users.deleteMany({ where: { role: "bot" } });
  });

  aiBots.length = 0;
  console.log("All bots have been deleted.");
}

function generateRandomPersonality() {
  return {
    aggressiveness: Math.random(),
    curiosity: Math.random(),
    sociability: Math.random(),
    tacticalAwareness: Math.random(),
    riskTolerance: Math.random(),
  };
}

async function exploreNewLocation(bot: AIBot) {
  const newLocation = getRandomLandCoordinates();
  console.log(`${bot.username} is exploring a new location: ${newLocation.latitude}, ${newLocation.longitude}`);
  await updateBotPosition(bot, newLocation);
}

// New helper functions

async function getNearbyPlayers(bot: AIBot) {
  const searchRadius = 5000; // 5 km radius, adjust as needed

  const nearbyPlayers = await prisma.gameplayUser.findMany({
    where: {
      AND: [
        { username: { not: bot.username } },
        { isAlive: true },
        {
          OR: [
            { friendsOnly: false },
            { username: { in: await getMutualFriends(bot) } }
          ]
        }
      ]
    },
    include: { Locations: true, Users: true }
  });

  return nearbyPlayers.filter(player => 
    player.Locations && geolib.isPointWithinRadius(
      { latitude: parseFloat(player.Locations.latitude), longitude: parseFloat(player.Locations.longitude) },
      { latitude: bot.latitude, longitude: bot.longitude },
      searchRadius
    )
  ).map(player => ({
    username: player.username,
    latitude: parseFloat(player.Locations!.latitude),
    longitude: parseFloat(player.Locations!.longitude),
    // Include other relevant player information
  }));
}

async function findNearbyLoot(bot: AIBot) {
  const searchRadius = 1000; // 1 km radius, adjust as needed

  const nearbyLoot = await prisma.loot.findMany();

  const closeLoot = nearbyLoot.filter(loot => 
    geolib.isPointWithinRadius(
      { latitude: parseFloat(loot.locLat), longitude: parseFloat(loot.locLong) },
      { latitude: bot.latitude, longitude: bot.longitude },
      searchRadius
    )
  );

  return closeLoot.length > 0 ? closeLoot[0] : null;
}

async function collectLootItem(bot: AIBot, loot: any) {
  try {
    // Remove the loot from the game world
    await prisma.loot.delete({
      where: { id: loot.id }
    });

    // Check if the item already exists in the bot's inventory
    const existingItem = await prisma.inventoryItem.findFirst({
      where: {
        userId: bot.id,
        name: loot.name
      }
    });

    if (existingItem) {
      // If item exists, update the quantity
      await prisma.inventoryItem.update({
        where: { id: existingItem.id },
        data: { quantity: { increment: 1 } }
      });
    } else {
      // If item does not exist, create a new entry
      await prisma.inventoryItem.create({
        data: {
          userId: bot.id,
          name: loot.name,
          quantity: 1,
          category: loot.category || 'misc' // Provide a default category if not available
        }
      });
    }

    console.log(`${bot.username} collected ${loot.name}`);
  } catch (error) {
    console.error(`Error collecting loot for ${bot.username}:`, error);
  }
}

async function getMutualFriends(bot: AIBot): Promise<string[]> {
  const user = await prisma.users.findUnique({
    where: { username: bot.username },
    select: { friends: true }
  });

  if (!user || !user.friends) return [];

  const mutualFriends = await prisma.users.findMany({
    where: {
      username: { in: user.friends },
      friends: { has: bot.username }
    },
    select: { username: true }
  });

  return mutualFriends.map(friend => friend.username);
}

async function loadExistingBots() {
  const existingBots = await prisma.users.findMany({
    where: { role: "bot" },
    include: {
      GameplayUser: {
        include: {
          Locations: true,
          InventoryItem: true,
        },
      },
    },
  });

  aiBots.length = 0; // Clear existing bots

  for (const botData of existingBots) {
    const bot: AIBot = {
      id: botData.id,
      username: botData.username,
      latitude: parseFloat(botData.GameplayUser?.Locations?.latitude || "0"),
      longitude: parseFloat(botData.GameplayUser?.Locations?.longitude || "0"),
      lastUpdate: new Date(),
      isOnline: true,
      behaviorTree: new BehaviorTree({} as AIBot), // Temporary placeholder
      personality: generateRandomPersonality(),
      missilesFiredToday: 0,
      lastMissileFiredAt: null,
      money: botData.GameplayUser?.money || 0,
      inventory: {
        missiles: botData.GameplayUser?.InventoryItem.filter(item => item.category === "missile") || [],
        // Add other inventory categories as needed
      },
    };
    bot.behaviorTree = new BehaviorTree(bot);
    aiBots.push(bot);
  }
}

async function earnMoneyFromDefeat(bot: AIBot, defeatedPlayer: any) {
  const earnedAmount = Math.floor(Math.random() * 50) + 50; // Earn 50-100 money units for defeating a player
  bot.money += earnedAmount;
  await prisma.gameplayUser.update({
    where: { username: bot.username },
    data: { money: { increment: earnedAmount } },
  });
  console.log(`${bot.username} earned $${earnedAmount} for defeating ${defeatedPlayer.username}`);
}

// You'll need to implement these functions based on your game logic:
function botHasDefeatedPlayer(bot: AIBot): any {
  // Check if the bot has defeated a player recently
  // This could involve checking a battle log or some other game state
}

function getDefeatedPlayer(bot: AIBot): any {
  // Retrieve information about the player the bot has defeated
  // This could come from a battle log or game state
}

export { manageAIBots, aiBots, deleteAllBots, createBot };