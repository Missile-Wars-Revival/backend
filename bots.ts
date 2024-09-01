import { PrismaClient } from "@prisma/client";
import * as geolib from 'geolib';
import { v4 as uuidv4 } from 'uuid';
import { sample } from 'lodash';

const prisma = new PrismaClient();

interface AIBot {
  id: string;
  username: string;
  latitude: number;
  longitude: number;
  isOnline: boolean;
  lastUpdate: Date;
  health: number;
  inventory: { [key: string]: number };
}

let aiBots: AIBot[] = [];

const adjectives = ['Happy', 'Sleepy', 'Grumpy', 'Dopey', 'Bashful', 'Sneezy', 'Doc'];
const nouns = ['Dwarf', 'Elf', 'Hobbit', 'Wizard', 'Ranger', 'Knight', 'Archer'];

function generateRandomUsername(): string {
  return `${sample(adjectives)}${sample(nouns)}${Math.floor(Math.random() * 1000)}`;
}

// New configuration object
const config = {
  maxBots: 50,
  minBots: 10,
  updateInterval: 60000,
  batchSize: 10,
  landCoordinates: [
    { minLat: 25, maxLat: 49, minLong: -125, maxLong: -66 }, // North America
    { minLat: 36, maxLat: 70, minLong: -10, maxLong: 40 },   // Europe
    { minLat: -34, maxLat: -10, minLong: 112, maxLong: 154 }, // Australia
    // Add more regions as needed
  ]
};

function getRandomLandCoordinates() {
  const region = sample(config.landCoordinates);
  if (!region) {
    throw new Error('No land coordinates available');
  }
  const latitude = Math.random() * (region.maxLat - region.minLat) + region.minLat;
  const longitude = Math.random() * (region.maxLong - region.minLong) + region.minLong;
  return { latitude, longitude };
}

async function createBot(): Promise<AIBot> {
  const { latitude, longitude } = getRandomLandCoordinates();
  
  // Get all missile types
  const missileTypes = await prisma.missileType.findMany();
  
  // Create an inventory with random quantities of each missile type
  const inventory: { [key: string]: number } = {};
  missileTypes.forEach(type => {
    inventory[type.name] = Math.floor(Math.random() * 5) + 1; // 1 to 5 missiles of each type
  });

  let botUsername: string;
  let createdUser: any;

  // Keep trying to create a user until we succeed with a unique username
  while (true) {
    try {
      botUsername = generateRandomUsername();
      
      createdUser = await prisma.users.create({
        data: {
          email: `${botUsername}@example.com`,
          password: uuidv4(), // Generate a random password
          username: botUsername,
          role: "bot", // Explicitly set the role to "bot"
          avatar: "", // You might want to set a default avatar for bots
          friends: [],
          notificationToken: "",
          GameplayUser: {
            create: {
              isAlive: true,
              friendsOnly: false,
              health: 100,
              Locations: {
                create: {
                  latitude: latitude.toString(),
                  longitude: longitude.toString()
                }
              }
            }
          }
        },
        include: {
          GameplayUser: {
            include: { Locations: true }
          }
        }
      });

      // If we reach here, the user was created successfully
      break;
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002' &&
        'meta' in error &&
        typeof error.meta === 'object' &&
        error.meta !== null &&
        'target' in error.meta &&
        Array.isArray(error.meta.target) &&
        error.meta.target.includes('username')
      ) {
        // Username already exists, we'll try again with a new username
        console.log(`Username already exists, trying again...`);
        continue;
      } else {
        // If it's a different error, we throw it
        throw error;
      }
    }
  }

  const bot: AIBot = {
    id: createdUser.id,
    username: botUsername,
    latitude,
    longitude,
    isOnline: true, // Start as online
    lastUpdate: new Date(),
    health: 100,
    inventory: inventory
  };

  return bot;
}

async function updateBotPosition(bot: AIBot) {
  if (bot.isOnline) {
    // Move the bot slightly, staying on land
    const newCoords = getRandomLandCoordinates();
    bot.latitude = newCoords.latitude;
    bot.longitude = newCoords.longitude;

    // Update the bot's location in the database
    await prisma.locations.update({
      where: { username: bot.username },
      data: {
        latitude: bot.latitude.toString(),
        longitude: bot.longitude.toString(),
        updatedAt: new Date()
      }
    });
  }
  bot.lastUpdate = new Date();
}

async function botAction(bot: AIBot) {
  if (!bot.isOnline) return;

  // Find nearby players
  const nearbyPlayers = await prisma.gameplayUser.findMany({
    where: {
      isAlive: true,
      username: { not: bot.username },
      Locations: {
        latitude: { not: "" },
        longitude: { not: "" }
      }
    },
    include: { Locations: true }
  });

  for (const player of nearbyPlayers) {
    if (!player.Locations) continue;

    const distance = geolib.getDistance(
      { latitude: bot.latitude, longitude: bot.longitude },
      { latitude: parseFloat(player.Locations.latitude), longitude: parseFloat(player.Locations.longitude) }
    );

    if (distance <= 10000 && bot.inventory["BasicMissile"] > 0) { // Within 10km and has missiles
      // Fire a missile at the player
      await fireMissile(bot, player);
      break; // Only fire one missile per action
    }
  }
}

async function fireMissile(bot: AIBot, target: any) {
  // Get all available missile types
  const missileTypes = await prisma.missileType.findMany();
  
  if (missileTypes.length === 0) return; // No missile types available

  // Select a random missile type
  const randomMissileType = missileTypes[Math.floor(Math.random() * missileTypes.length)];

  // Check if the bot has this type of missile in inventory
  if (!bot.inventory[randomMissileType.name] || bot.inventory[randomMissileType.name] <= 0) {
    return; // Bot doesn't have this type of missile
  }

  const distance = geolib.getDistance(
    { latitude: bot.latitude, longitude: bot.longitude },
    { latitude: parseFloat(target.Locations.latitude), longitude: parseFloat(target.Locations.longitude) }
  );

  const timeToImpact = Math.round(distance / randomMissileType.speed * 1000); // time in milliseconds

  await prisma.missile.create({
    data: {
      destLat: target.Locations.latitude,
      destLong: target.Locations.longitude,
      radius: randomMissileType.radius,
      damage: randomMissileType.damage,
      type: randomMissileType.name,
      sentBy: bot.username,
      sentAt: new Date(),
      status: "Incoming",
      currentLat: bot.latitude.toString(),
      currentLong: bot.longitude.toString(),
      timeToImpact: new Date(new Date().getTime() + timeToImpact)
    }
  });

  // Decrease the inventory count for the used missile type
  bot.inventory[randomMissileType.name]--;
}

async function updateBotsInBatch(bots: AIBot[]) {
  await prisma.$transaction(
    bots.map(bot => 
      prisma.locations.updateMany({
        where: { username: bot.username },
        data: {
          latitude: bot.latitude.toString(),
          longitude: bot.longitude.toString(),
          updatedAt: new Date()
        }
      })
    )
  );
}

export async function manageAIBots() {
  let lastUpdateTime = Date.now();

  async function updateLoop() {
    const currentTime = Date.now();
    const timeSinceLastUpdate = currentTime - lastUpdateTime;

    // Dynamically adjust bot count based on active players
    const activePlayers = await prisma.gameplayUser.count({ where: { isAlive: true } });
    const targetBotCount = Math.min(Math.max(config.minBots, Math.floor(activePlayers / 2)), config.maxBots);

    // Create or remove bots as needed
    while (aiBots.length < targetBotCount) {
      aiBots.push(await createBot());
    }
    while (aiBots.length > targetBotCount) {
      const removedBot = aiBots.pop();
      if (removedBot) {
        await prisma.users.delete({ where: { username: removedBot.username } });
      }
    }

    // Update bots in batches
    for (let i = 0; i < aiBots.length; i += config.batchSize) {
      const batch = aiBots.slice(i, i + config.batchSize);
      await Promise.all(batch.map(async (bot) => {
        await updateBotPosition(bot);
        await botAction(bot);

        if (Math.random() > 0.9) {
          bot.isOnline = !bot.isOnline;
          await prisma.gameplayUser.update({
            where: { username: bot.username },
            data: { isAlive: bot.isOnline }
          });
        }
      }));

      await updateBotsInBatch(batch);
    }

    lastUpdateTime = currentTime;

    // Schedule next update
    const nextUpdateTime = Math.max(0, config.updateInterval - (Date.now() - currentTime));
    setTimeout(updateLoop, nextUpdateTime);
  }

  updateLoop();
}

export { aiBots };