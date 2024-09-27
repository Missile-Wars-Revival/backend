import { prisma } from "../server";
import { haversine } from "./entitymanagment";
import { sendNotification } from "./notificationhelper";
import { getMutualFriends } from "../server-routes/friendsApi";


const PROCESS_INTERVAL = 15000; // 15 seconds in milliseconds
const FIVE_MINUTES = 5 * 60 * 1000; // 5 minutes in milliseconds

const processedMissiles = new Map<string, Map<string, number>>();
const processedLandmines = new Map<string, Set<string>>();
const lastDeathTime = new Map<string, number>();

export const processDamage = async () => {
  try {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Fetch all necessary data in bulk
    const [activeUsers, activeMissiles, activeLandmines, activeShields, allGameplayUsers] = await Promise.all([
      prisma.gameplayUser.findMany({
        where: {
          Locations: { updatedAt: { gte: oneWeekAgo } },
          isAlive: true,
          locActive: true 
        },
        include: { Locations: true }
      }),
      prisma.missile.findMany({ where: { status: 'Hit' } }),
      prisma.landmine.findMany(),
      prisma.other.findMany({
        where: {
          type: { in: ['Shield', 'UltraShield'] },
          Expires: { gt: new Date() }
        }
      }),
      prisma.gameplayUser.findMany({
        select: { username: true, friendsOnly: true }
      })
    ]);

    // Create a map for quick lookup of gameplay users
    const gameplayUserMap = new Map(allGameplayUsers.map(u => [u.username, u]));

    for (const user of activeUsers) {
      if (!user.Locations) continue;

      const userCoords = { latitude: parseFloat(user.Locations.latitude), longitude: parseFloat(user.Locations.longitude) };

      // Determine which entities to process for this user
      const usernamesToProcess = await determineUsernamesToProcess(user.username, gameplayUserMap);

      // Check missiles
      for (const missile of activeMissiles.filter(m => usernamesToProcess.includes(m.sentBy))) {
        const missileCoords = { latitude: parseFloat(missile.destLat), longitude: parseFloat(missile.destLong) };
        const distance = haversine(userCoords.latitude.toString(), userCoords.longitude.toString(), missileCoords.latitude.toString(), missileCoords.longitude.toString());

        if (distance <= missile.radius && !isUserProtectedByShield(userCoords, activeShields)) {
          await handleMissileDamage(user, missile);
        }
      }

      // Check landmines
      for (const landmine of activeLandmines.filter(l => usernamesToProcess.includes(l.placedBy))) {
        const landmineCoords = { latitude: parseFloat(landmine.locLat), longitude: parseFloat(landmine.locLong) };
        const distance = haversine(userCoords.latitude.toString(), userCoords.longitude.toString(), landmineCoords.latitude.toString(), landmineCoords.longitude.toString());

        if (distance <= 10 && !isUserProtectedByShield(userCoords, activeShields)) {
          await handleLandmineDamage(user, landmine);
        }
      }
    }
  } catch (error) {
    console.error('Failed to process damage:', error);
  }
};

async function determineUsernamesToProcess(username: string, gameplayUserMap: Map<string, { friendsOnly: boolean }>) {
  const currentUser = gameplayUserMap.get(username);
  if (!currentUser) return [];

  if (currentUser.friendsOnly) {
    try {
      const mutualFriends = await getMutualFriends({ friends: [], username: username });
      return mutualFriends.map(friend => friend.username);
    } catch (error) {
      console.error(`Error getting mutual friends for ${username}:`, error);
      return [];
    }
  } else {
    // Process entities from all users who are not in friendsOnly mode
    return Array.from(gameplayUserMap.entries())
      .filter(([_, user]) => !user.friendsOnly)
      .map(([username, _]) => username);
  }
}

// async function determineUsernamesToProcess(username: string, gameplayUserMap: Map<string, { friendsOnly: boolean, league?: { tier: string, division: number } }>) {
//   const currentUser = gameplayUserMap.get(username);
//   if (!currentUser) return [];

//   if (currentUser.friendsOnly) {
//     try {
//       const mutualFriends = await getMutualFriends({ friends: [], username: username });
//       return mutualFriends.map(friend => friend.username);
//     } catch (error) {
//       console.error(`Error getting mutual friends for ${username}:`, error);
//       return [];
//     }
//   } else {
//     // Process entities from users in the same league and division who are not in friendsOnly mode
//     return Array.from(gameplayUserMap.entries())
//       .filter(([_, user]) => 
//         !user.friendsOnly && 
//         user.league && 
//         currentUser.league &&
//         user.league.tier === currentUser.league.tier &&
//         user.league.division === currentUser.league.division
//       )
//       .map(([username, _]) => username);
//   }
// }

function isUserProtectedByShield(userCoords: { latitude: number, longitude: number }, shields: any[]): { id: number, placedBy: string } | false {
  for (const shield of shields) {
    const shieldCoords = { latitude: parseFloat(shield.locLat), longitude: parseFloat(shield.locLong) };
    const distance = haversine(
      userCoords.latitude.toString(),
      userCoords.longitude.toString(),
      shieldCoords.latitude.toString(),
      shieldCoords.longitude.toString()
    );
    if (distance <= shield.radius) {
      return { id: shield.id, placedBy: shield.placedBy };
    }
  }
  return false;
}

async function handleMissileDamage(user: any, missile: any) {
  if (!processedMissiles.has(user.username)) {
    processedMissiles.set(user.username, new Map());
  }
  
  if (!processedMissiles.get(user.username)!.has(missile.id)) {
    processedMissiles.get(user.username)!.set(missile.id, Date.now());
    
    const userCoords = { latitude: parseFloat(user.Locations.latitude), longitude: parseFloat(user.Locations.longitude) };
    const activeShields = await prisma.other.findMany({
      where: {
        type: { in: ['Shield', 'UltraShield'] },
        Expires: { gt: new Date() }
      }
    });

    if (missile.type === 'ShieldBreaker') {
      const shieldsToBreak = activeShields.filter(shield => {
        const shieldCoords = { latitude: parseFloat(shield.locLat), longitude: parseFloat(shield.locLong) };
        const distance = haversine(
          userCoords.latitude.toString(),
          userCoords.longitude.toString(),
          shieldCoords.latitude.toString(),
          shieldCoords.longitude.toString()
        );
        return distance <= missile.radius;
      });

      for (const shield of shieldsToBreak) {
        await prisma.other.delete({ where: { id: shield.id } });
        
        // Notification for the user being protected
        await sendNotification(user.username, "Shield Destroyed!", `Your shield has been destroyed by a Shield Breaker missile from ${missile.sentBy}!`, missile.sentBy);
        
        // Notification for the user who placed the shield (if different from the protected user)
        if (user.username !== shield.placedBy) {
          await sendNotification(shield.placedBy, "Shield Destroyed!", `The shield you placed for ${user.username} has been destroyed by a Shield Breaker missile from ${missile.sentBy}!`, missile.sentBy);
        }
      }

      if (shieldsToBreak.length === 0) {
        // If no shields were broken, apply damage to the user
        await applyDamage(user, missile.damage, missile.sentBy, 'missile', missile.type);
      }
    } else {
      // For non-ShieldBreaker missiles, check if the user is protected by any shield
      const isProtected = activeShields.some(shield => {
        const shieldCoords = { latitude: parseFloat(shield.locLat), longitude: parseFloat(shield.locLong) };
        const distance = haversine(
          userCoords.latitude.toString(),
          userCoords.longitude.toString(),
          shieldCoords.latitude.toString(),
          shieldCoords.longitude.toString()
        );
        return distance <= shield.radius;
      });

      if (!isProtected) {
        // Apply damage only if there's no shield protection
        await applyDamage(user, missile.damage, missile.sentBy, 'missile', missile.type);
      }
    }
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
      try {
        // Check if the landmine still exists before attempting to delete
        const existingLandmine = await prisma.landmine.findUnique({
          where: { id: landmine.id }
        });
        if (existingLandmine) {
          await prisma.landmine.delete({ where: { id: landmine.id } });
        }
      } catch (error) {
        console.error(`Failed to delete landmine ${landmine.id}:`, error);
      } finally {
        processedLandmines.get(user.username)!.delete(landmine.id);
      }
    }, 30000);
  }
}

interface GameplayUser {
    id: number;
    username: string;
    health: number;
    isAlive: boolean;
    money: number;
    rankPoints: number;
    Locations?: {
      latitude: string;
      longitude: string;
    };
  }
async function applyDamage(user: GameplayUser, damage: number, attackerUsername: string, damageSource: 'missile' | 'landmine', receivedType: string) {
  try {
    const applyDamageRecursively = async () => {
      // Fetch the latest user data and active shields
      const [currentUser, activeShields] = await Promise.all([
        prisma.gameplayUser.findUnique({
          where: { id: user.id },
          include: { Locations: true }
        }),
        prisma.other.findMany({
          where: {
            type: { in: ['Shield', 'UltraShield'] },
            Expires: { gt: new Date() }
          }
        })
      ]);

      // Check if the user is in the grace period
      const lastDeath = lastDeathTime.get(user.username);
      if (lastDeath && Date.now() - lastDeath < FIVE_MINUTES) {
        console.log(`User ${user.username} is in grace period. Stopping damage application.`);
        return;
      }

      // Check if the user is not alive or protected by a shield, and if so, stop the damage application
      if (!currentUser || !currentUser.isAlive || !currentUser.Locations ||!currentUser.Locations) {
        console.log(`User ${user.username} is not alive or has no location. Stopping damage application.`);
        return;
      }

      const userCoords = { 
        latitude: parseFloat(currentUser.Locations.latitude), 
        longitude: parseFloat(currentUser.Locations.longitude) 
      };

      if (isUserProtectedByShield(userCoords, activeShields)) {
        console.log(`User ${user.username} is protected by a shield. Stopping damage application.`);
        return;
      }

      // Move these queries outside the transaction
      let rewardAmount = 0;
      let rankPointsReward = 0;

      if (damageSource === 'landmine') {
        const landmineType = await prisma.landmineType.findUnique({
          where: { name: receivedType },
        });
        if (landmineType) {
          rewardAmount = Math.round(landmineType.price * 1.5);
          rankPointsReward = 30; // Base rank points for landmine kill
        }
      } else if (damageSource === 'missile') {
        const missileType = await prisma.missileType.findUnique({
          where: { name: receivedType },
        });
        if (missileType) {
          rewardAmount = Math.round(missileType.price * 1.1);
          rankPointsReward = 20; // Base rank points for missile kill
        }
      }

      // Add bonus rank points based on item price, but cap it
      const bonusPoints = Math.min(Math.round(rewardAmount / 100), 20);
      rankPointsReward += bonusPoints;

      // Cap total rank points reward
      rankPointsReward = Math.min(rankPointsReward, 67);

      // Continue with the existing damage application logic
      await prisma.$transaction(async (prisma) => {
        const updatedUser = await prisma.gameplayUser.update({
          where: { id: user.id },
          data: { health: { decrement: damage } },
          include: { Locations: true }
        });

        console.log(`User ${user.username} health updated to ${updatedUser.health}`);

        if (updatedUser.health <= 0 && updatedUser.isAlive) {
          // Calculate penalties for the eliminated user
          const moneyLoss = Math.floor(updatedUser.money * 0.2);
          const maxRankPointsLoss = Math.floor(Math.random() * (30 - 5 + 1)) + 5; // Random value between 5 and 30
          const rankPointsLoss = Math.min(updatedUser.rankPoints, maxRankPointsLoss);

          await prisma.gameplayUser.update({
            where: { id: user.id },
            data: { 
              isAlive: false, 
              health: 0,
              money: updatedUser.money - moneyLoss,
              rankPoints: { decrement: rankPointsLoss }
            }
          });

          console.log(`User ${user.username} eliminated. Lost ${moneyLoss} coins and ${rankPointsLoss} rank points.`);

          // Use the pre-calculated rewardAmount and rankPointsReward here
          const updatedAttacker = await prisma.gameplayUser.update({
            where: { username: attackerUsername },
            data: {
              money: { increment: rewardAmount + moneyLoss },
              rankPoints: { increment: rankPointsReward },
            },
          });

          console.log(`Attacker ${attackerUsername} updated. New balance: ${updatedAttacker.money}, New rank points: ${updatedAttacker.rankPoints}`);

          // Create a notification for the attacker
          await prisma.notifications.create({
            data: {
              userId: attackerUsername,
              title: "Elimination Reward",
              body: `You've been rewarded ${rewardAmount + moneyLoss} coins and ${rankPointsReward} rank points for eliminating ${user.username} with your ${damageSource}!`,
              sentby: "server",
            },
          });

          // Create a notification for the eliminated user
          const eliminationMessage = `You have been eliminated by a ${receivedType} ${damageSource} sent by ${attackerUsername}! You lost ${moneyLoss} coins and ${rankPointsLoss} rank points.`;
          await sendNotification(user.username, "Eliminated!", eliminationMessage, attackerUsername);

          // Update death statistic
          await updateDeathStatistic(user.id, prisma);

          // Set the last death time for the user
          lastDeathTime.set(user.username, Date.now());
        } else if (updatedUser.isAlive && damageSource === 'missile') {
          // Send damage notification
          const damageMessage = `You have taken ${damage} damage from a ${receivedType} missile sent by ${attackerUsername}!`;
          await sendNotification(user.username, "Damaged!", damageMessage, attackerUsername);

          // Schedule next damage application after 30 seconds
          setTimeout(applyDamageRecursively, 30000);
        }
      }, {
        timeout: 10000 // 10 seconds
      });
    };

    // Start the damage cycle immediately for missiles, or apply once for landmines
    if (damageSource === 'missile') {
      const initialMissileMessage = `Warning! A ${receivedType} missile from ${attackerUsername} is heading your way! Impact in 30 seconds.`;
      await sendNotification(user.username, "Missile Damage!", initialMissileMessage, attackerUsername);
      setTimeout(applyDamageRecursively, 30000);
    } else {
      // For landmines, apply damage once after 30 seconds
      const initialMessage = `You've stepped on a landmine! You will take damage in 30 seconds.`;
      await sendNotification(user.username, "Landmine Damage!", initialMessage, attackerUsername);
      setTimeout(applyDamageRecursively, 30000);
    }

  } catch (error) {
    console.error("Error in applyDamage function:", error);
  }
}

// New helper function to update death statistic
async function updateDeathStatistic(userId: number, prisma: any) {
  const existingDeaths = await prisma.statistics.findFirst({
    where: { userId: userId },
  });

  if (existingDeaths) {
    await prisma.statistics.update({
      where: { id: existingDeaths.id },
      data: { numDeaths: existingDeaths.numDeaths + 1 },
    });
  } else {
    await prisma.statistics.create({
      data: {
        userId: userId,
        numDeaths: 1,
      },
    });
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

  // Clean up lastDeathTime
  lastDeathTime.forEach((timestamp, username) => {
    if (timestamp < fiveMinutesAgo) {
      lastDeathTime.delete(username);
    }
  });
}