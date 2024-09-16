import { sendNotification } from "./runners/notificationhelper";
import * as geolib from "geolib";
import { sample } from "lodash";
import * as tf from '@tensorflow/tfjs-node';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';
import { MissileType } from "@prisma/client";

export const prisma = new PrismaClient();

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
  neuralNetwork: NeuralNetwork;
  inventory: { [key: string]: number };
  money: number;
  health: number;
  isAlive: boolean;
  rankpoints: number;
  respawning?: boolean;
  respawn: () => Promise<void>;
}

class BehaviorTree {
  private bot: AIBot;

  constructor(bot: AIBot) {
    this.bot = bot;
  }

  async execute() {
    await this.checkForIncomingMissiles();
    await this.updateBotMoney();
    await this.updateBotInventory();
    await this.checkFinances();

    const input = await this.getStateInput();
    const prediction = await this.bot.neuralNetwork.predict(input);
    
    const action = tf.argMax(prediction as tf.Tensor, 1).dataSync()[0];

    switch(action) {
      case 0: await this.explore(); break;
      case 1: await this.attack(); break;
      case 2: await this.socialize(); break;
      case 3: await this.collectLoot(); break;
      case 4: await this.idle(); break;
    }

    // Remove the chance to perform an additional action
    // if (Math.random() < 0.3) {  // 30% chance
    //   await this.performAdditionalAction();
    // }
  }

  private async performAdditionalAction() {
    const action = Math.random();
    if (action < 0.5) {
      await this.collectLoot();
    } else {
      await this.attack();
    }
  }

  private async updateBotMoney() {
    const updatedBot = await prisma.gameplayUser.findUnique({
      where: { username: this.bot.username },
      select: { money: true }
    });

    if (updatedBot) {
      this.bot.money = updatedBot.money;
    } else {
      console.error(`Failed to fetch updated money for bot ${this.bot.username}`);
    }
  }

  private async updateBotInventory() {
    const inventoryItems = await prisma.inventoryItem.findMany({
      where: { GameplayUser: { username: this.bot.username } }
    });

    this.bot.inventory = inventoryItems.reduce((acc, item) => {
      acc[item.name] = item.quantity;
      return acc;
    }, {} as { [key: string]: number });
  }

  private async getStateInput(): Promise<number[]> {
    const nearbyPlayers = await getNearbyPlayers(this.bot);
    const nearbyLoot = await findNearbyLoot(this.bot, 2000);
    const nearbyMissiles = await getNearbyMissiles(this.bot);

    return [
      this.bot.latitude,
      this.bot.longitude,
      this.bot.personality.aggressiveness,
      this.bot.personality.curiosity,
      this.bot.personality.sociability,
      this.bot.personality.tacticalAwareness,
      this.bot.personality.riskTolerance,
      this.bot.missilesFiredToday,
      this.bot.inventory['Missiles'] || 0,
      this.bot.money,
      nearbyPlayers.length,
      nearbyLoot ? 1 : 0,
      nearbyMissiles.length,
      this.bot.health,
      this.bot.rankpoints,
      Math.random() // Add a random factor to increase variability
    ];
  }

  private async explore() {
    const newLocation = getRandomLandCoordinates();
    await updateBotPosition(this.bot, newLocation);
    console.log(`${this.bot.username} is exploring a new location.`);

    // Check for loot in the new location
    const loot = await findNearbyLoot(this.bot, 2000);
    if (loot) {
      console.log(`${this.bot.username} found loot while exploring!`);
      await this.collectLoot();
    }
  }

  private async attack() {
    console.log(`[ATTACK] ${this.bot.username} is attempting to attack.`);

    await this.updateBotInventory();
    await this.updateBotMoney();

    console.log(`[ATTACK] ${this.bot.username}'s current money: ${this.bot.money}`);
    console.log(`[ATTACK] ${this.bot.username}'s current inventory:`, this.bot.inventory);

    const currentTime = new Date().getTime();
    if (this.bot.lastMissileFiredAt && currentTime - this.bot.lastMissileFiredAt.getTime() < config.missileCooldownPeriod) {
      console.log(`[ATTACK] ${this.bot.username} is still on cooldown for firing missiles.`);
      return; // Exit the method early
    }

    if (this.bot.missilesFiredToday >= config.maxMissilesPerDay) {
      console.log(`[ATTACK] ${this.bot.username} has reached the daily missile firing limit.`);
      return; // Exit the method early
    }

    const target = await this.selectTarget();

    if (!target) {
      console.log(`[ATTACK] ${this.bot.username} couldn't select a target.`);
      return;
    }
    console.log(`[ATTACK] ${this.bot.username} selected ${target.username} as the target.`);

    const missile = await this.selectMissile();
    if (!missile) {
      console.log(`[ATTACK] ${this.bot.username} couldn't select a missile to fire.`);
      return;
    }

    console.log(`[ATTACK] ${this.bot.username} selected ${missile.name} missile.`);

    console.log(`[ATTACK] Attempting to fire missile. Bot coordinates: ${this.bot.latitude}, ${this.bot.longitude}`);
    console.log(`[ATTACK] Target details:`, JSON.stringify(target, null, 2));

    try {
      await fireMissileAtPlayer(this.bot, target, missile);
      this.bot.lastMissileFiredAt = new Date(currentTime);
      this.bot.missilesFiredToday++;
      console.log(`[ATTACK] ${this.bot.username} successfully fired a missile at ${target.username}.`);
    } catch (error) {
      console.error(`[ATTACK] Error firing missile for ${this.bot.username}:`, error);
    }
  }

  private async selectTarget(): Promise<any> {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

    const recentAttacker = await this.getRecentAttacker();
    if (recentAttacker && recentAttacker.isAlive && recentAttacker.Locations?.updatedAt >= twoDaysAgo) {
      console.log(`${this.bot.username} is retaliating against ${recentAttacker.username}`);
      return recentAttacker;
    }

    const nearbyPlayers = await this.getNearbyPlayers();
    if (nearbyPlayers.length > 0) {
      const target = sample(nearbyPlayers);
      console.log(`${this.bot.username} is targeting nearby player ${target.username}`);
      return target;
    }

    return getRandomAlivePlayer();
  }

  private async getRecentAttacker(): Promise<any> {
    const recentMissile = await prisma.missile.findFirst({
      where: {
        destLat: this.bot.latitude.toString(),
        destLong: this.bot.longitude.toString(),
        sentAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
        status: "Hit"
      },
      orderBy: { sentAt: 'desc' }
    });

    if (recentMissile) {
      return getPlayerByUsername(recentMissile.sentBy);
    }

    return null;
  }

  private async getNearbyPlayers(): Promise<any[]> {
    const detectionRadius = 200;
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    return await prisma.gameplayUser.findMany({
      where: {
        AND: [
          { username: { not: this.bot.username } },
          { isAlive: true },
          {
            Locations: {
              latitude: {
                gte: (this.bot.latitude - 0.002).toString(),
                lte: (this.bot.latitude + 0.002).toString(),
              },
              longitude: {
                gte: (this.bot.longitude - 0.002).toString(),
                lte: (this.bot.longitude + 0.002).toString(),
              },
              updatedAt: { gte: twoDaysAgo }
            }
          }
        ]
      },
      include: { Locations: true, Users: true }
    });
  }

  private async selectMissile(): Promise<MissileType | null> {
    try {
      const missileTypes = await prisma.missileType.findMany();

      if (missileTypes.length === 0) {
        console.log(`${this.bot.username} couldn't find any missile types in the database`);
        return null;
      }

      const scoredMissiles = missileTypes.map(missile => ({
        ...missile,
        score: this.calculateMissileScore(missile)
      }));

      scoredMissiles.sort((a, b) => b.score - a.score);

      for (const missile of scoredMissiles) {
        if (this.bot.inventory[missile.name] && this.bot.inventory[missile.name] > 0) {
          return missile;
        }
      }

      console.log(`${this.bot.username} has no missiles in inventory`);
      return null;
    } catch (error) {
      console.error(`Error selecting missile for ${this.bot.username}:`, error);
      return null;
    }
  }

  private calculateMissileScore(missile: MissileType): number {
    const normalizedSpeed = missile.speed / 100;
    const normalizedDamage = missile.damage / 100;
    const normalizedRadius = 80 / 100;

    let score = 0;
    score += this.bot.personality.aggressiveness * normalizedDamage * 2;
    score += this.bot.personality.tacticalAwareness * normalizedRadius;
    score += this.bot.personality.riskTolerance * normalizedSpeed;

    score += Math.random() * 0.2;

    return score;
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

async collectLoot() {
  const initialMoney = this.bot.money;
  const initialInput = await this.getStateInput();

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    const loot = await findNearbyLoot(this.bot, 2000);
    if (loot) {
      const lootPosition = {
        latitude: parseFloat(loot.locLat),
        longitude: parseFloat(loot.locLong)
      };
    
      console.log(`${this.bot.username} moving towards loot at ${lootPosition.latitude}, ${lootPosition.longitude}`);
      
      while (geolib.getDistance(
        { latitude: this.bot.latitude, longitude: this.bot.longitude },
        lootPosition
      ) > 1) {
        const newPosition = calculateNewPosition(this.bot, lootPosition);
        await updateBotPosition(this.bot, newPosition);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    
      console.log(`${this.bot.username} has reached loot location`);
      
      // Wait for a moment to simulate loot collection
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Fetch the updated bot information
      const updatedBot = await prisma.gameplayUser.findUnique({
        where: { username: this.bot.username },
        select: { money: true }
      });
      
      if (updatedBot) {
        this.bot.money = updatedBot.money;
        console.log(`${this.bot.username}'s current money: ${this.bot.money}`);
        
        if (this.bot.money > initialMoney) {
          console.log(`${this.bot.username} successfully collected loot!`);
          break; // Exit the loop if money has increased
        }
      }
    } else {
      console.log(`${this.bot.username} couldn't find any loot nearby.`);
      break; // Exit the loop if no loot is found
    }

    attempts++;
    if (attempts < maxAttempts) {
      console.log(`${this.bot.username} is trying again to collect loot. Attempt ${attempts + 1} of ${maxAttempts}`);
    }
  }

  const moneyGained = this.bot.money - initialMoney;
  console.log(`${this.bot.username} gained ${moneyGained} from loot collection attempt`);
  const reward = moneyGained / 1000;  // Normalize the reward
  await this.bot.neuralNetwork.trainOnLootCollection(initialInput, reward);

  // Simply return without calling any other method
  return;
}

  private async idle() {
    console.log(`${this.bot.username} is idling.`);
    
    // Add more varied idle behaviors
    const idleAction = Math.random();
    if (idleAction < 0.3) {
      console.log(`${this.bot.username} is taking a short nap.`);
      await new Promise(resolve => setTimeout(resolve, 5000 + Math.random() * 10000));
    } else if (idleAction < 0.6) {
      console.log(`${this.bot.username} is observing the surroundings.`);
      // Potentially update the bot's awareness of nearby entities
    } else {
      console.log(`${this.bot.username} is conserving energy.`);
      // Potentially recover some health or resources
    }
  }

  private async buyMissile() {
    await this.updateBotMoney();
    await this.updateBotInventory();

    try {
      const missileTypes = await prisma.missileType.findMany();

      if (missileTypes.length === 0) {
        console.log(`${this.bot.username} couldn't find any missile types in the database`);
        return;
      }

      const scoredMissiles = missileTypes.map(missile => ({
        ...missile,
        score: this.calculateMissileScore(missile)
      }));

      scoredMissiles.sort((a, b) => b.score - a.score);

      const affordableMissile = scoredMissiles.find(missile => this.bot.money >= missile.price && this.bot.money - missile.price >= 100);

      if (affordableMissile) {
        await prisma.$transaction(async (prisma) => {
          // First, ensure the bot has a GameplayUser entry
          const gameplayUser = await prisma.gameplayUser.upsert({
            where: { username: this.bot.username },
            update: { money: { decrement: affordableMissile.price } },
            create: {
              username: this.bot.username,
              money: this.bot.money - affordableMissile.price,
            }
          });

          const existingItem = await prisma.inventoryItem.findFirst({
            where: {
              GameplayUser: { username: this.bot.username },
              name: affordableMissile.name,
              category: 'Missiles'
            }
          });

          if (existingItem) {
            await prisma.inventoryItem.update({
              where: { id: existingItem.id },
              data: { quantity: { increment: 1 } }
            });
          } else {
            await prisma.inventoryItem.create({
              data: {
                name: affordableMissile.name,
                quantity: 1,
                category: 'Missiles',
                GameplayUser: { connect: { username: this.bot.username } }
              }
            });
          }
        });

        await this.updateBotMoney();
        await this.updateBotInventory();
        console.log(`${this.bot.username} bought a ${affordableMissile.name} missile. Money: ${this.bot.money}, Missiles: ${this.bot.inventory[affordableMissile.name]}`);
      } else {
        console.log(`${this.bot.username} couldn't afford any missiles or would have too little money left. Money: ${this.bot.money}`);
        console.log(`${this.bot.username} is going to look for loot instead.`);
        await this.collectLoot();
      }
    } catch (error) {
      console.error(`Error while ${this.bot.username} was trying to buy a missile:`, error);
    }
  }

  private async handleLowFunds() {
    console.log(`${this.bot.username} is low on funds. Choosing a new action.`);
    const action = Math.random();
    if (action < 0.6) {
      console.log(`${this.bot.username} is going to collect loot.`);
      await this.collectLoot();
    } else if (action < 0.8) {
      console.log(`${this.bot.username} is going to explore for opportunities.`);
      await this.explore();
    } else {
      console.log(`${this.bot.username} is going to socialize.`);
      await this.socialize();
    }
  }

  private async checkForIncomingMissiles() {
    const radiusInDegrees = 800 / 111000;

    const incomingMissiles = await prisma.missile.findMany({
      where: {
        status: "Incoming",
        destLat: {
          gte: (this.bot.latitude - radiusInDegrees).toString(),
          lte: (this.bot.latitude + radiusInDegrees).toString(),
        },
        destLong: {
          gte: (this.bot.longitude - radiusInDegrees).toString(),
          lte: (this.bot.longitude + radiusInDegrees).toString(),
        },
        timeToImpact: { gt: new Date() },
      },
      orderBy: { timeToImpact: 'asc' },
    });

    if (incomingMissiles.length > 0) {
      const closestMissile = incomingMissiles.reduce((closest, missile) => {
        const missileDistance = geolib.getDistance(
          { latitude: this.bot.latitude, longitude: this.bot.longitude },
          { latitude: parseFloat(missile.destLat), longitude: parseFloat(missile.destLong) }
        );
        const closestDistance = geolib.getDistance(
          { latitude: this.bot.latitude, longitude: this.bot.longitude },
          { latitude: parseFloat(closest.destLat), longitude: parseFloat(closest.destLong) }
        );
        return missileDistance < closestDistance ? missile : closest;
      });

      await this.evadeMissile(closestMissile);
    }
  }

  private async evadeMissile(missile: any) {
    const evasionChance = this.bot.personality.tacticalAwareness * 0.7;
    const timeToImpact = new Date(missile.timeToImpact).getTime() - Date.now();
    const minimumEvadeTime = 5 * 60 * 1000;

    if (timeToImpact < minimumEvadeTime) {
      console.log(`${this.bot.username} doesn't have enough time to evade the missile!`);
      return;
    }
    
    if (Math.random() < evasionChance) {
      console.log(`${this.bot.username} is attempting to evade a missile!`);
    
      const impactPoint = {
        latitude: parseFloat(missile.destLat),
        longitude: parseFloat(missile.destLong)
      };
      const botPosition = {
        latitude: this.bot.latitude,
        longitude: this.bot.longitude
      };
    
      const bearing = geolib.getRhumbLineBearing(impactPoint, botPosition);

      const evasionDistance = Math.min(1000, timeToImpact / 1000 * 5);
      const safePosition = geolib.computeDestinationPoint(
        botPosition,
        evasionDistance,
        bearing
      );

      await this.moveToPosition(safePosition);

      console.log(`${this.bot.username} has evaded to ${safePosition.latitude}, ${safePosition.longitude}`);
    } else {
      console.log(`${this.bot.username} failed to evade the incoming missile!`);
    }
  }

  private async moveToPosition(position: { latitude: number, longitude: number }) {
    const startTime = Date.now();
    const maxEvadeTime = 5 * 60 * 1000;

    while (geolib.getDistance(
      { latitude: this.bot.latitude, longitude: this.bot.longitude },
      position
    ) > 1 && Date.now() - startTime < maxEvadeTime) {
      const newPosition = calculateNewPosition(this.bot, position);
      await updateBotPosition(this.bot, newPosition);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  private async checkFinances() {
    await this.updateBotMoney();
    if (this.bot.money < 100) {  // Set a threshold, e.g., 100
      console.log(`${this.bot.username} is low on funds. Current money: ${this.bot.money}`);
      await this.earnMoney();
    }
  }

  private async earnMoney() {
    console.log(`${this.bot.username} is attempting to earn money.`);
    const action = Math.random();
    if (action < 0.7) {  // 70% chance to collect loot
      await this.collectLoot();
    } else {  // 30% chance to attack a player
      await this.attack();
    }
  }
}

class NeuralNetwork {
  model: tf.Sequential;
  isTraining: boolean;

  constructor() {
    this.model = this.initializeModel();
    this.isTraining = false;
  }

  predict(input: number[]): tf.Tensor {
    return this.model.predict(tf.tensor2d([input])) as tf.Tensor;
  }

  async train(inputs: number[][], outputs: number[][], epochs: number = 100) {
    if (this.isTraining) {
      console.log("Training already in progress. Skipping this request.");
      return;
    }

    this.isTraining = true;
    try {
      const xs = tf.tensor2d(inputs);
      const ys = tf.tensor2d(outputs);

      await this.model.fit(xs, ys, {
        epochs: epochs,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            console.log(`Epoch ${epoch}: loss = ${logs?.loss}`);
          }
        }
      });

      xs.dispose();
      ys.dispose();
    } catch (error) {
      console.error("Error during training:", error);
    } finally {
      this.isTraining = false;
    }
  }

  async saveModel(botUsername: string) {
    const saveDir = path.join(process.cwd(), 'bot-models', botUsername);
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
    }
    await this.model.save(`file://${saveDir}`);
    console.log(`Model saved for bot ${botUsername} in ${saveDir}`);
  }

  async loadModel(botUsername: string) {
    const loadDir = path.join(process.cwd(), 'bot-models', botUsername);
    if (fs.existsSync(loadDir)) {
      try {
        const loadedModel = await tf.loadLayersModel(`file://${loadDir}/model.json`);
        this.model = this.convertToSequential(loadedModel);
        console.log(`Model loaded for bot ${botUsername} from ${loadDir}`);
      } catch (error) {
        console.error(`Error loading model for bot ${botUsername}:`, error);
        this.model = this.initializeModel();
      }
    } else {
      console.log(`No saved model found for bot ${botUsername}. Initializing new model.`);
      this.model = this.initializeModel();
    }
  }

  private initializeModel(): tf.Sequential {
    const model = tf.sequential();
    model.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [15] }));
    model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 5, activation: 'softmax' }));
    model.compile({ optimizer: 'adam', loss: 'categoricalCrossentropy' });
    return model;
  }

  private convertToSequential(loadedModel: tf.LayersModel): tf.Sequential {
    const sequentialModel = tf.sequential();
    for (const layer of loadedModel.layers) {
      sequentialModel.add(layer);
    }
    sequentialModel.compile({ optimizer: 'adam', loss: 'categoricalCrossentropy' });
    return sequentialModel;
  }

  async trainOnLootCollection(input: number[], reward: number) {
    if (this.isTraining) {
      console.log("Training already in progress. Skipping loot collection training.");
      return;
    }

    const prediction = await this.predict(input);
    const target = prediction.clone();
    const collectLootIndex = 3;  // Assuming 3 is the index for collectLoot action
    
    // Create a 2D tensor with the same shape as the prediction
    const updatedTarget = target.arraySync() as number[][];
    updatedTarget[0][collectLootIndex] = reward;

    const targetTensor = tf.tensor2d(updatedTarget);

    await this.train([input], updatedTarget, 1);
    
    target.dispose();
    targetTensor.dispose();
  }
}

const aiBots: AIBot[] = [];

const adjectives = ["Swift", "Brave", "Cunning", "Mighty", "Stealthy", "Tactical", "Resourceful", "Vigilant"];
const nouns = ["Eagle", "Tiger", "Wolf", "Bear", "Hawk", "Panther", "Falcon", "Viper"];

const config = {
  maxBots: 10,
  minBots: 5,
  updateInterval: 20000,
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
    { latitude: -33.8688, longitude: 144.9631, name: "Sydney" },
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
  movementStepSize: 0.0002,
  movementSpeed: 5,
  missileCooldownPeriod: 4 * 60 * 60 * 1000,
  maxRetries: 3,
  retryDelay: 1000,
};

async function fireMissileAtPlayer(bot: AIBot, player: any, missileType: any) {
  console.log(`[FIRE_MISSILE] Attempting to fire missile from ${bot.username} to ${player.username}`);
  console.log(`[FIRE_MISSILE] Bot coordinates: ${bot.latitude}, ${bot.longitude}`);
  console.log(`[FIRE_MISSILE] Player details:`, JSON.stringify(player, null, 2));
  console.log(`[FIRE_MISSILE] Missile type:`, JSON.stringify(missileType, null, 2));

  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    try {
      if (!bot.latitude || !bot.longitude || !player.Locations || !player.Locations.latitude || !player.Locations.longitude) {
        throw new Error("Bot or player coordinates are missing");
      }

      const distance = geolib.getDistance(
        { latitude: bot.latitude, longitude: bot.longitude },
        { latitude: parseFloat(player.Locations.latitude), longitude: parseFloat(player.Locations.longitude) }
      );
      const timeToImpact = Math.round(distance / missileType.speed * 1000);

      console.log(`[FIRE_MISSILE] Calculated distance: ${distance}, Time to impact: ${timeToImpact}`);

      const missileData = {
        destLat: player.Locations.latitude,
        destLong: player.Locations.longitude,
        radius: 80,
        damage: missileType.damage,
        type: missileType.name,
        sentBy: bot.username,
        sentAt: new Date(),
        status: "Incoming",
        currentLat: bot.latitude.toString(),
        currentLong: bot.longitude.toString(),
        timeToImpact: new Date(new Date().getTime() + timeToImpact)
      };

      console.log(`[FIRE_MISSILE] Missile data to be created:`, JSON.stringify(missileData, null, 2));

      await prisma.missile.create({ data: missileData });

      console.log(`[FIRE_MISSILE] Missile fired successfully from ${bot.username} to ${player.username}`);

      await sendNotification(player.username, "Incoming Missile!", `A missile has been fired at you by ${bot.username}!`, bot.username);
      return;
    } catch (error) {
      console.error(`[FIRE_MISSILE] Attempt ${attempt + 1} failed to fire missile from ${bot.username} to ${player.username}:`, error);
      if (attempt === config.maxRetries - 1) {
        console.error(`[FIRE_MISSILE] All attempts to fire missile from ${bot.username} to ${player.username} have failed.`);
      } else {
        console.log(`[FIRE_MISSILE] Retrying in ${config.retryDelay}ms...`);
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
      duration = Math.floor(Math.random() * 60) + 1;
      return duration * 60 * 1000;
    case "hours":
      duration = Math.floor(Math.random() * 24) + 1;
      return duration * 60 * 60 * 1000;
    case "days":
      duration = Math.floor(Math.random() * 7) + 1;
      return duration * 24 * 60 * 60 * 1000;
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

async function createBot() {
  const username = generateRandomUsername();
  const { latitude, longitude } = getRandomLandCoordinates();
  const neuralNetwork = new NeuralNetwork();
  await neuralNetwork.loadModel(username);
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
    neuralNetwork,
    inventory: {},
    money: 1000, 
    health: 100,
    isAlive: true,
    rankpoints: 0,
    respawn: async () => await respawnBot(bot)
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
async function respawnBot(bot: AIBot) {
  console.log(`${bot.username} has died. Initiating respawn process...`);

  // Set a respawn delay
  const minDelay = 5 * 60 * 1000; // 5 minutes
  const maxDelay = 15 * 60 * 1000; // 15 minutes
  const respawnDelay = Math.floor(Math.random() * (maxDelay - minDelay)) + minDelay;

  console.log(`${bot.username} will respawn in ${respawnDelay / 1000} seconds.`);

  // Wait for the respawn delay
  await new Promise(resolve => setTimeout(resolve, respawnDelay));

  try {
    // Reset bot properties
    bot.health = 100;
    bot.isAlive = true;
    bot.missilesFiredToday = 0;
    bot.lastMissileFiredAt = null;
    bot.inventory = {};
    bot.money = 1000; // Starting money

    // Choose a new spawn location
    const { latitude, longitude } = getRandomLandCoordinates();
    bot.latitude = latitude;
    bot.longitude = longitude;

    // Update bot in database
    await prisma.$transaction(async (prisma) => {
      // Update GameplayUser
      await prisma.gameplayUser.update({
        where: { username: bot.username },
        data: {
          health: bot.health,
          isAlive: bot.isAlive,
          money: bot.money,
        }
      });

      // Update Location
      await prisma.locations.update({
        where: { username: bot.username },
        data: {
          latitude: bot.latitude.toString(),
          longitude: bot.longitude.toString(),
          updatedAt: new Date()
        }
      });

      // Clear Inventory
      await prisma.inventoryItem.deleteMany({
        where: { userId: bot.id }
      });

      // Update Statistics
      await prisma.statistics.updateMany({
        where: { userId: bot.id },
        data: { numDeaths: { increment: 1 } }
      });
    });

    // Fetch updated bot data from database
    const updatedBot = await prisma.gameplayUser.findUnique({
      where: { username: bot.username },
      include: {
        Locations: true,
        InventoryItem: true,
        Statistics: true
      }
    });

    if (updatedBot) {
      // Update bot object with fresh data from database
      bot.money = updatedBot.money;
      bot.health = updatedBot.health;
      bot.isAlive = updatedBot.isAlive;
      bot.latitude = parseFloat(updatedBot.Locations?.latitude || "0");
      bot.longitude = parseFloat(updatedBot.Locations?.longitude || "0");
      bot.inventory = updatedBot.InventoryItem.reduce((acc, item) => {
        acc[item.name] = item.quantity;
        return acc;
      }, {} as { [key: string]: number });
    }

    bot.isOnline = true;
    console.log(`${bot.username} has respawned at ${bot.latitude}, ${bot.longitude}`);
  } catch (error) {
    console.error(`Error respawning bot ${bot.username}:`, error);
    // You might want to implement some retry logic here
  }
}

function calculateNewPosition(bot: AIBot, target: { latitude: number; longitude: number }) {
  const distance = geolib.getDistance(
    { latitude: bot.latitude, longitude: bot.longitude },
    { latitude: target.latitude, longitude: target.longitude }
  );

  // Calculate maximum distance the bot can move in this update
  const maxDistance = (config.movementSpeed / 3600) * (config.updateInterval / 1000) * 1000; // in meters

  if (distance <= maxDistance) {
    return target; // If the target is within reach, move directly to the target
  }

  const bearing = geolib.getRhumbLineBearing(
    { latitude: bot.latitude, longitude: bot.longitude },
    { latitude: target.latitude, longitude: target.longitude }
  );

  const newPosition = geolib.computeDestinationPoint(
    { latitude: bot.latitude, longitude: bot.longitude },
    Math.min(maxDistance, config.movementStepSize * 1000), // Use the smaller of maxDistance or movementStepSize
    bearing
  );

  // Add some randomness to movement
  const randomFactor = 0.2; // Adjust this value to control randomness
  const randomAngle = Math.random() * 2 * Math.PI;
  const randomOffset = {
    latitude: Math.sin(randomAngle) * config.movementStepSize * randomFactor,
    longitude: Math.cos(randomAngle) * config.movementStepSize * randomFactor,
  };

  return {
    latitude: newPosition.latitude + randomOffset.latitude,
    longitude: newPosition.longitude + randomOffset.longitude,
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

  // Only execute behavior tree if the bot has moved
  if (newPosition.latitude !== target.latitude || newPosition.longitude !== target.longitude) {
    await bot.behaviorTree.execute();
  }
}

async function updateBotsInBatch(bots: AIBot[]) {
  const maxRetries = 5;
  const baseDelay = 100; // 100ms
  const batchSize = 5; // Reduced from 10 to 5

  for (let i = 0; i < bots.length; i += batchSize) {
    const batch = bots.slice(i, i + batchSize);
    
    await Promise.all(batch.map(bot => updateSingleBot(bot, maxRetries, baseDelay)));
    
    // Add a small delay between batches
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  // Periodically save the model for each bot
  for (const bot of bots) {
    if (bot.isOnline && Math.random() < 0.1) { // 10% chance to save on each cycle
      await bot.neuralNetwork.saveModel(bot.username);
    }
  }
}

async function updateSingleBot(bot: AIBot, maxRetries: number, baseDelay: number) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Check the bot's alive status in the database
      const botStatus = await prisma.gameplayUser.findUnique({
        where: { username: bot.username },
        select: { isAlive: true }
      });

      if (!botStatus || !botStatus.isAlive) {
        if (!bot.respawning) {
          console.log(`Bot ${bot.username} is dead in the database. Initiating respawn process.`);
          bot.respawning = true;
          respawnBot(bot).then(() => {
            bot.respawning = false;
          });
        } else {
          console.log(`Bot ${bot.username} is in the process of respawning. Skipping update.`);
        }
        return;
      }

      if (bot.isOnline) {
        const target = getRandomLandCoordinates(); // Or any other way you determine the bot's target
        await updateBotPosition(bot, target);
        await bot.behaviorTree.execute(); // Execute behavior tree regardless of movement
      }

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

      console.log(`Updated location for bot: ${bot.username}`);
      return; // Success, exit the function
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`Update failed for bot ${bot.username}. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error(`Unexpected error updating bot ${bot.username}:`, error);
        break; // Exit the retry loop for unexpected errors
      }
    }
  }
  console.error(`Failed to update bot ${bot.username} after ${maxRetries} attempts.`);
}

async function loadExistingBots() {
  const existingBots = await prisma.users.findMany({
    where: { role: "bot" },
    include: {
      GameplayUser: {
        include: {
          Locations: true,
          InventoryItem: true,
          Statistics: true,
        },
      },
    },
  });

  for (const botData of existingBots) {
    if (botData.GameplayUser && botData.GameplayUser.Locations) {
      const bot: AIBot = {
        id: botData.id,
        username: botData.username,
        latitude: parseFloat(botData.GameplayUser.Locations.latitude),
        longitude: parseFloat(botData.GameplayUser.Locations.longitude),
        lastUpdate: botData.GameplayUser.Locations.lastUpdated,
        isOnline: true,
        behaviorTree: new BehaviorTree({} as AIBot), // Temporary placeholder
        personality: generateRandomPersonality(),
        missilesFiredToday: 0, // You might want to store this in Statistics
        lastMissileFiredAt: null, // You might want to store this in Statistics
        neuralNetwork: new NeuralNetwork(),
        inventory: botData.GameplayUser.InventoryItem.reduce((acc, item) => {
          acc[item.name] = item.quantity;
          return acc;
        }, {} as { [key: string]: number }),
        money: botData.GameplayUser.money,
        health: botData.GameplayUser.health,
        isAlive: botData.GameplayUser.isAlive,
        rankpoints: botData.GameplayUser.rankPoints,
        respawn: async () => await respawnBot(bot)
      };
      bot.behaviorTree = new BehaviorTree(bot);
      aiBots.push(bot);
    }
  }
  console.log(`Loaded ${aiBots.length} existing bots from the database.`);
}

async function manageAIBots() {
//load existing bots
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
    await updateBotsInBatch(botsToUpdate);

    for (const bot of botsToUpdate) {
      if (bot.isOnline) {
        const target = getRandomLandCoordinates(); // Or any other way you determine the bot's target
        await updateBotPosition(bot, target);
        await bot.behaviorTree.execute(); // Execute behavior tree for each online bot
        
        // Periodically train the bot (e.g., every 10 executions)
        if (Math.random() < 0.1) {  // 10% chance to train on each cycle
          trainBot(bot).catch(error => console.error(`Error training bot ${bot.username}:`, error));
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

    for (const bot of aiBots) {
      if (bot.isOnline) {
        const nearbyLoot = await findNearbyLoot(bot, 2000);
        if (nearbyLoot) {
          console.log(`${bot.username} has detected nearby loot!`);
          await bot.behaviorTree.collectLoot();
        }
      }
    }
  }, config.updateInterval);

  // Check for loot less frequently than main update
  setInterval(async () => {
    for (const bot of aiBots) {
      if (bot.isOnline) {
        const nearbyLoot = await findNearbyLoot(bot, 2000);
        if (nearbyLoot) {
          console.log(`${bot.username} has detected nearby loot!`);
          await bot.behaviorTree.collectLoot();
        }
      }
    }
  }, config.updateInterval * 2);
}

async function trainBot(bot: AIBot) {
  if (bot.neuralNetwork.isTraining) {
    console.log(`${bot.username} is already training. Skipping this training cycle.`);
    return;
  }

  const trainingData = await generateTrainingData(bot);
  const inputs = trainingData.map(data => data.input);
  const outputs = trainingData.map(data => data.output);
  await bot.neuralNetwork.train(inputs, outputs);
  console.log(`${bot.username} completed a training cycle.`);
}

async function generateTrainingData(bot: AIBot): Promise<{ input: number[], output: number[] }[]> {
  const trainingData = [];
  for (let i = 0; i < 100; i++) {  // Generate 100 training samples
    const nearbyPlayers = await getNearbyPlayers(bot);
    const nearbyLoot = await findNearbyLoot(bot, 2000);
    const nearbyMissiles = await getNearbyMissiles(bot);

    const input = [
      bot.latitude,
      bot.longitude,
      bot.personality.aggressiveness,
      bot.personality.curiosity,
      bot.personality.sociability,
      bot.personality.tacticalAwareness,
      bot.personality.riskTolerance,
      bot.missilesFiredToday,
      bot.inventory['missile'] || 0,
      bot.money,
      nearbyPlayers.length,
      nearbyLoot ? 1 : 0,
      nearbyMissiles.length,
      bot.health,
      bot.rankpoints
    ];
    
    const output = calculateOutputProbabilities(bot, nearbyPlayers, nearbyLoot, nearbyMissiles);
    
    trainingData.push({ input, output });
  }
  return trainingData;
}

function calculateOutputProbabilities(bot: AIBot, nearbyPlayers: any[], nearbyLoot: any, nearbyMissiles: any[]): number[] {
  let explore = 0.15;
  let attack = 0.15;
  let socialize = 0.15;
  let collectLoot = 0.15;
  let idle = 0.4; // Increase the base probability of idling

  // Adjust probabilities based on game state and bot personality
  if (nearbyPlayers.length > 0) {
    attack += bot.personality.aggressiveness * 0.2;
    socialize += bot.personality.sociability * 0.1;
  }

  if (nearbyLoot) {
    collectLoot += bot.personality.curiosity * 0.2;
    collectLoot += Math.max(0, (1000 - bot.money) / 1000) * 0.2;
  }

  if (nearbyMissiles.length > 0) {
    explore += bot.personality.riskTolerance * 0.1;
  }

  if (bot.health < 50) {
    idle += 0.2;
  }

  // Add more conditions to increase idling
  if (bot.money > 5000) {
    idle += 0.1; // More likely to idle when rich
  }

  if (bot.inventory['Missiles'] < 2) {
    idle += 0.1; // More likely to idle when low on missiles
  }

  if (Math.random() < 0.3) {
    idle += 0.2; // Random chance to increase idling
  }

  // Normalize probabilities
  const sum = explore + attack + socialize + collectLoot + idle;
  return [explore, attack, socialize, collectLoot, idle].map(p => p / sum);
}

async function getNearbyMissiles(bot: AIBot): Promise<any[]> {
  return await prisma.missile.findMany({
    where: {
      status: "Incoming",
      destLat: {
        gte: (bot.latitude - 0.1).toString(),
        lte: (bot.latitude + 0.1).toString(),
      },
      destLong: {
        gte: (bot.longitude - 0.1).toString(),
        lte: (bot.longitude + 0.1).toString(),
      },
    },
  });
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

async function findNearbyLoot(bot: AIBot, radius: number) {
  const nearbyLoot = await prisma.loot.findMany({
    where: {
      locLat: {
        gte: (bot.latitude - radius / 111000).toString(),
        lte: (bot.latitude + radius / 111000).toString(),
      },
      locLong: {
        gte: (bot.longitude - radius / 111000).toString(),
        lte: (bot.longitude + radius / 111000).toString(),
      },
    },
    orderBy: {
      id: 'asc', // or any other consistent ordering
    },
    take: 5, // Limit the number of results
  });

  const closeLoot = nearbyLoot.filter(loot => 
    geolib.isPointWithinRadius(
      { latitude: parseFloat(loot.locLat), longitude: parseFloat(loot.locLong) },
      { latitude: bot.latitude, longitude: bot.longitude },
      radius
    )
  );

  return closeLoot.length > 0 ? sample(closeLoot) : null; // Return a random loot from the close ones
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

async function getPlayerByUsername(username: string) {
  const player = await prisma.users.findUnique({
    where: { username },
    include: {
      GameplayUser: {
        include: {
          Locations: true
        }
      }
    }
  });

  if (player && player.GameplayUser && player.GameplayUser.Locations) {
    return {
      ...player,
      latitude: parseFloat(player.GameplayUser.Locations.latitude),
      longitude: parseFloat(player.GameplayUser.Locations.longitude),
    };
  }
  return null;
}

async function getRandomAlivePlayer() {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

  const alivePlayers = await prisma.gameplayUser.findMany({
    where: { 
      isAlive: true,
      Users: { role: { not: "bot" } },
      Locations: {
        updatedAt: { gte: twoDaysAgo }
      }
    },
    include: { Locations: true, Users: true }
  });
  
  const playersWithCoordinates = alivePlayers.filter(player => 
    player.Locations && player.Locations.latitude && player.Locations.longitude
  );
  
  return sample(playersWithCoordinates);
}

export { manageAIBots, aiBots, deleteAllBots };