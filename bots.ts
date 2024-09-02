import { PrismaClient } from "@prisma/client";
import { sendNotification } from "./notificationhelper";
import * as geolib from "geolib";
import { v4 as uuidv4 } from "uuid";
import { sample } from "lodash";
import { AStarFinder } from 'pathfinding'; // Importing A* pathfinding library

interface AIBot {
  id: string;
  username: string;
  latitude: number;
  longitude: number;
  lastUpdate: Date;
  isOnline: boolean;
  behaviorTree: any; // Placeholder for behavior tree
}

const prisma = new PrismaClient();
const aiBots: AIBot[] = [];

const adjectives = ["Swift", "Brave", "Cunning", "Mighty"];
const nouns = ["Eagle", "Tiger", "Wolf", "Bear"];

const config = {
  maxBots: 10,
  minBots: 5,
  updateInterval: 10000, // 10 seconds
  batchSize: 5,
  maxActiveMissiles: 20, // Maximum number of active missiles
  pois: [
    { latitude: 40.7128, longitude: -74.0060 }, // New York
    { latitude: 34.0522, longitude: -118.2437 }, // Los Angeles
    { latitude: 51.5074, longitude: -0.1278 }, // London
    { latitude: 48.8566, longitude: 2.3522 }, // Paris
    { latitude: 35.6895, longitude: 139.6917 }, // Tokyo
    { latitude: 55.7558, longitude: 37.6173 }, // Moscow
    { latitude: -33.8688, longitude: 151.2093 }, // Sydney
    { latitude: 37.7749, longitude: -122.4194 }, // San Francisco
    { latitude: 39.9042, longitude: 116.4074 }, // Beijing
    { latitude: 19.4326, longitude: -99.1332 }, // Mexico City
    { latitude: 52.5200, longitude: 13.4050 }, // Berlin
    { latitude: 41.9028, longitude: 12.4964 }, // Rome
    { latitude: 40.4168, longitude: -3.7038 }, // Madrid
  ],
  movementStepSize: 0.005, // Adjust this value for smaller steps
};

async function getActiveMissileCount() {
  const activeMissiles = await prisma.missile.count({
    where: { status: "Incoming" },
  });
  return activeMissiles;
}

async function fireMissileAtPlayer(bot: AIBot, player: any, missileType: any) {
  try {
    if (!bot.latitude || !bot.longitude || !player.latitude || !player.longitude) {
      throw new Error("Bot or player coordinates are missing");
    }

    const distance = geolib.getDistance(
      { latitude: bot.latitude, longitude: bot.longitude },
      { latitude: player.latitude, longitude: player.longitude }
    );
    const timeToImpact = Math.round(distance / missileType.speed * 1000); // time in milliseconds

    await prisma.missile.create({
      data: {
        destLat: player.latitude.toString(),
        destLong: player.longitude.toString(),
        radius: missileType.radius,
        damage: missileType.damage,
        type: missileType.name,
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
  } catch (error) {
    console.error(`Failed to fire missile from ${bot.username} to ${player.username}:`, error);
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

  if (Math.random() < 0.05) { // 5% chance to interact with players
    const missileType = await getRandomMissileType();
    const player = await getRandomPlayer();
    if (missileType && player) {
      console.log(`${bot.username} is firing a ${missileType.name} missile at player ${player.username}!`);
      await fireMissileAtPlayer(bot, player, missileType);
    }
  }
}

async function createBot() {
  const username = generateRandomUsername();
  const { latitude, longitude } = getRandomLandCoordinates();
  const bot: AIBot = {
    id: uuidv4(),
    username,
    latitude,
    longitude,
    lastUpdate: new Date(),
    isOnline: true,
    behaviorTree: null, // Initialize behavior tree
  };
  aiBots.push(bot);

  await prisma.users.create({
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

  return {
    latitude: newCoords.latitude,
    longitude: newCoords.longitude,
  };
}

async function updateBotPosition(bot: AIBot) {
  if (!bot.isOnline) return;

  const target = getRandomLandCoordinates();
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

  await interactWithPlayers(bot);
}

async function updateBotsInBatch(bots: AIBot[]) {
  for (const bot of bots) {
    await updateBotPosition(bot);
  }
}

async function manageAIBots() {
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
				await prisma.users.delete({ where: { username: bot.username } });
			}
		}

		const botsToUpdate = aiBots.slice(0, config.batchSize);
		await updateBotsInBatch(botsToUpdate);

		aiBots.forEach(bot => {
			if (Math.random() < 0.1) { // 10% chance to go offline
				setBotOffline(bot);
			} else if (Math.random() < 0.1) { // 10% chance to go to sleep
				setBotSleeping(bot);
			}
		});
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
  await prisma.locations.deleteMany({
    where: {
      GameplayUser: {
        Users: {
          role: "bot",
        },
      },
    },
  });

  await prisma.gameplayUser.deleteMany({
    where: {
      Users: {
        role: "bot",
      },
    },
  });

  await prisma.users.deleteMany({ where: { role: "bot" } });

  aiBots.length = 0;
}

export { manageAIBots, aiBots, deleteAllBots };