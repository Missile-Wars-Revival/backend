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
    const message = `You're in a missile impact zone! You will start taking damage in 30 seconds.`;
    await sendNotification(user.username, "Missile Impact Alert!", message, "Server");
    
    processedMissiles.get(user.username)!.set(missile.id, Date.now());
    
    setTimeout(async () => {
      await applyDamage(user, missile.damage, missile.sentBy, 'missile', missile.type);
    }, DAMAGE_INTERVAL);
  } else {
    // Missile already processed, apply damage immediately
    await applyDamage(user, missile.damage, missile.sentBy, 'missile', missile.type);
  }
}

async function handleLandmineDamage(user: any, landmine: any) {
  if (!processedLandmines.has(user.username)) {
    processedLandmines.set(user.username, new Set());
  }
  
  if (!processedLandmines.get(user.username)!.has(landmine.id)) {
    const message = `You've stepped on a landmine! You will take damage in 30 seconds.`;
    await sendNotification(user.username, "Landmine Alert!", message, "Server");
    
    processedLandmines.get(user.username)!.add(landmine.id);
    
    setTimeout(async () => {
      await applyDamage(user, landmine.damage, landmine.placedBy, 'landmine', landmine.type);
      // Delete the landmine after damage is applied
      await prisma.landmine.delete({ where: { id: landmine.id } });
      // Remove the landmine from processed set after it's deleted
      processedLandmines.get(user.username)!.delete(landmine.id);
    }, DAMAGE_INTERVAL);
  }
  // No else block needed for landmines as they are one-time damage
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
async function applyDamage(user: GameplayUser, damage: number, attackerUsername: string, damageSource: 'missile' | 'landmine', recivedtype: string) {
  try {
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

      if (!updatedUser.Locations) {
        console.error(`No location data found for user ${user.username}`);
        return;
      }

      const locationAge = Date.now() - updatedUser.Locations.updatedAt.getTime();
      console.log(`Location age for ${user.username}: ${locationAge} ms`);

      if (locationAge > TWO_MINUTES) {
        console.log(`Processing death reward for ${user.username}, killed by ${attackerUsername}`);

        const attacker = await prisma.gameplayUser.findUnique({
          where: { username: attackerUsername },
        });

        if (!attacker) {
          console.error(`Attacker ${attackerUsername} not found`);
          return;
        }

        let rewardAmount = 0;
        let rankPointsReward = 0;

        if (damageSource === 'landmine') {
          const landmineType = await prisma.landmineType.findUnique({
            where: { name: recivedtype }, 
          });
          if (landmineType) {
            rewardAmount = Math.round(landmineType.price * 1.5);
            rankPointsReward = 300; // Base rank points for landmine kill
          }
        } else if (damageSource === 'missile') {
          const missileType = await prisma.missileType.findUnique({
            where: { name: recivedtype }, // Adjust this type as needed
          });
          if (missileType) {
            rewardAmount = Math.round(missileType.price * 1.5);
            rankPointsReward = 500; // Base rank points for missile kill
          }
        }

        // Add bonus rank points based on item price
        rankPointsReward += Math.round(rewardAmount / 10);

        console.log(`Calculated reward: ${rewardAmount} coins, ${rankPointsReward} rank points`);

        // Update attacker's money and rank points
        const updatedAttacker = await prisma.gameplayUser.update({
          where: { id: attacker.id },
          data: {
            money: { increment: rewardAmount },
            rankPoints: { increment: rankPointsReward },
          },
        });

        console.log(`Attacker ${attackerUsername} updated. New balance: ${updatedAttacker.money}, New rank points: ${updatedAttacker.rankPoints}`);

        // Create a notification for the attacker
        await prisma.notifications.create({
          data: {
            userId: attacker.username,
            title: "Kill Reward",
            body: `You've been rewarded ${rewardAmount} coins and ${rankPointsReward} rank points for killing ${user.username} with your ${damageSource}!`,
            sentby: "server",
          },
        });

        console.log(`Notification created for ${attackerUsername}`);
      } else {
        console.log(`No reward given. Location update too recent: ${locationAge} ms`);
      }

      const message = `You have been eliminated by a ${recivedtype} ${damageSource} sent by ${attackerUsername}!`;
      await sendNotification(user.username, "Eliminated!", message, attackerUsername);
    } else if (damageSource === 'missile') {
      // Continue dealing damage for missiles only if the user is still alive
      setTimeout(() => applyDamage(user, damage, attackerUsername, damageSource, recivedtype), DAMAGE_INTERVAL);
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