import { prisma } from "../server";
import { haversine } from "./entitymanagment";
import { sendNotification } from "./notificationhelper";
import { getMutualFriends } from "../server-routes/friendsApi";
import { v4 as uuidv4 } from 'uuid';

const DAMAGE_INTERVAL = 30000; // 30 seconds in milliseconds
const TWO_MINUTES = 2 * 60 * 1000; // 2 minutes in milliseconds
const PROCESS_INTERVAL = 15000; // 15 seconds in milliseconds

const processedMissiles = new Map<string, Map<string, number>>();
const processedLandmines = new Map<string, Set<string>>();

export const processDamage = async () => {
  try {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const activeUsers = await prisma.gameplayUser.findMany({
      where: {
        Locations: {
          updatedAt: { gte: oneWeekAgo }
        },
        isAlive: true
      },
      include: { Locations: true }
    });

    for (const user of activeUsers) {
      if (!user.Locations) continue;

      const userCoords = { latitude: parseFloat(user.Locations.latitude), longitude: parseFloat(user.Locations.longitude) };

      // Fetch the current user with their friends
      const currentUser = await prisma.users.findUnique({
        where: { username: user.username },
        include: { GameplayUser: true }
      });

      if (!currentUser) continue;

      const mutualFriendsUsernames = await getMutualFriends(currentUser);

      let usernamesToFetchEntitiesFrom = [];

      if (currentUser.GameplayUser && currentUser.GameplayUser.friendsOnly) {
        // If friendsOnly is enabled, only fetch entities from mutual friends
        usernamesToFetchEntitiesFrom = mutualFriendsUsernames;
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
            username: true
          }
        });

        usernamesToFetchEntitiesFrom = nonFriendsOnlyUsers.map(u => u.username);
      }

      // Fetch missiles
      const activeMissiles = await prisma.missile.findMany({
        where: { 
          status: 'Hit',
          sentBy: {
            in: usernamesToFetchEntitiesFrom
          }
        }
      });

      // Check missiles
      for (const missile of activeMissiles) {
        const missileCoords = { latitude: parseFloat(missile.destLat), longitude: parseFloat(missile.destLong) };
        const distance = haversine(userCoords.latitude.toString(), userCoords.longitude.toString(), missileCoords.latitude.toString(), missileCoords.longitude.toString());

        if (distance <= missile.radius) {
          await handleMissileDamage(user, missile);
        }
      }

      // Fetch landmines
      const activeLandmines = await prisma.landmine.findMany({
        where: {
          placedBy: {
            in: usernamesToFetchEntitiesFrom
          }
        }
      });

      // Check landmines
      for (const landmine of activeLandmines) {
        const landmineCoords = { latitude: parseFloat(landmine.locLat), longitude: parseFloat(landmine.locLong) };
        const distance = haversine(userCoords.latitude.toString(), userCoords.longitude.toString(), landmineCoords.latitude.toString(), landmineCoords.longitude.toString());

        if (distance <= 10) { // Assuming 10 meters activation radius for landmines
          await handleLandmineDamage(user, landmine);
        }
      }
    }
  } catch (error) {
    console.error('Failed to process damage:', error);
  }
};

async function handleMissileDamage(user: any, missile: any) {
  if (!processedMissiles.has(user.username)) {
    processedMissiles.set(user.username, new Map());
  }
  
  if (!processedMissiles.get(user.username)!.has(missile.id)) {
    processedMissiles.get(user.username)!.set(missile.id, Date.now());
    await applyDamage(user, missile.damage, missile.sentBy, 'missile', missile.type);
  }
}

async function handleLandmineDamage(user: any, landmine: any) {
  if (!processedLandmines.has(user.username)) {
    processedLandmines.set(user.username, new Set());
  }
  
  if (!processedLandmines.get(user.username)!.has(landmine.id)) {
    processedLandmines.get(user.username)!.add(landmine.id);
    await applyDamage(user, landmine.damage, landmine.placedBy, 'landmine', landmine.type);
    // Delete the landmine after damage is applied (this will happen after the 30-second delay)
    setTimeout(async () => {
      await prisma.landmine.delete({ where: { id: landmine.id } });
      processedLandmines.get(user.username)!.delete(landmine.id);
    }, 30000);
  }
}

interface GameplayUser {
    id: number;
    username: string;
    health: number;
    isAlive: boolean;
    Locations?: {
      latitude: string;
      longitude: string;
    };
  }
async function applyDamage(user: GameplayUser, damage: number, attackerUsername: string, damageSource: 'missile' | 'landmine', receivedType: string) {
  try {
    const applyDamageRecursively = async () => {
      const updatedUser = await prisma.gameplayUser.update({
        where: { id: user.id },
        data: { health: { decrement: damage } },
        include: { Locations: true }
      });

      console.log(`User ${user.username} health updated to ${updatedUser.health}`);

      if (updatedUser.health <= 0 || !updatedUser.isAlive) {
        await prisma.gameplayUser.update({
          where: { id: user.id },
          data: { isAlive: false, health: 0 }
        });

        console.log(`User ${user.username} eliminated`);

        const message = `You have been eliminated by a ${receivedType} ${damageSource} sent by ${attackerUsername}!`;
        await sendNotification(user.username, "Eliminated!", message, attackerUsername);

        // Process death reward logic here
        // ...

      } else if (damageSource === 'missile') {
        // Send damage notification
        const damageMessage = `You have taken ${damage} damage from a ${receivedType} missile sent by ${attackerUsername}!`;
        await sendNotification(user.username, "Damaged!", damageMessage, attackerUsername);

        // Schedule next damage application after 30 seconds
        setTimeout(applyDamageRecursively, 30000);
      }
    };

    // Start the damage cycle immediately for missiles, or apply once for landmines
    if (damageSource === 'missile') {
      //const initialMessage = `You're in a missile impact zone! You will start taking damage in 30 seconds.`;
      //await sendNotification(user.username, "Missile Impact Alert!", initialMessage, attackerUsername);
      setTimeout(applyDamageRecursively, 30000);
    } else {
      // For landmines, apply damage once after 30 seconds
      const initialMessage = `You've stepped on a landmine! You will take damage in 30 seconds.`;
      await sendNotification(user.username, "Landmine Alert!", initialMessage, attackerUsername);
      setTimeout(applyDamageRecursively, 30000);
    }

  } catch (error) {
    console.error("Error in applyDamage function:", error);
  }
}

// New function to start the damage processing interval
export const startDamageProcessing = () => {
  setInterval(() => {
    processDamage();
    cleanupProcessedEntities();
  }, PROCESS_INTERVAL);
  console.log('Damage processing started, running every 15 seconds');
};

function cleanupProcessedEntities() {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  
  processedMissiles.forEach((missiles, username) => {
    missiles.forEach((timestamp, missileId) => {
      if (timestamp < fiveMinutesAgo) {
        missiles.delete(missileId);
      }
    });
    if (missiles.size === 0) {
      processedMissiles.delete(username);
    }
  });
  
  processedLandmines.forEach((landmines, username) => {
    if (landmines.size === 0) {
      processedLandmines.delete(username);
    }
  });
}