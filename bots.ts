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

function getRandomLandCoordinates() {
  // This is a simplified version. You might want to use a more sophisticated method
  // to ensure bots are on land, possibly using a geography API or predefined land areas.
  const latitude = Math.random() * 180 - 90;
  const longitude = Math.random() * 360 - 180;
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

  const bot: AIBot = {
    id: uuidv4(),
    username: generateRandomUsername(),
    latitude,
    longitude,
    isOnline: Math.random() > 0.3, // 70% chance of being online
    lastUpdate: new Date(),
    health: 100,
    inventory: inventory
  };

  // Create a GameplayUser entry for the bot
  await prisma.gameplayUser.create({
    data: {
      username: bot.username,
      isAlive: true,
      friendsOnly: false,
      health: bot.health,
      Locations: {
        create: {
          latitude: bot.latitude.toString(),
          longitude: bot.longitude.toString()
        }
      }
    }
  });

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

export async function manageAIBots() {
  const maxBots = 50; // Adjust this number as needed
  const updateInterval = 60000; // Update every minute

  // Create initial bots if needed
  while (aiBots.length < maxBots) {
    aiBots.push(await createBot());
  }

  // Update bot positions and perform actions
  setInterval(async () => {
    for (const bot of aiBots) {
      await updateBotPosition(bot);
      await botAction(bot);

      if (Math.random() > 0.9) { // 10% chance of changing online status
        bot.isOnline = !bot.isOnline;
        await prisma.gameplayUser.update({
          where: { username: bot.username },
          data: { isAlive: bot.isOnline }
        });
      }
    }
  }, updateInterval);
}

export { aiBots };