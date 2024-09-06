import { prisma } from "../server";
import { haversine } from "./entitymanagment";
import { sendNotification } from "./notificationhelper";

const DAMAGE_INTERVAL = 30000; // 30 seconds in milliseconds
const FIVE_MINUTES = 5 * 60 * 1000; // 5 minutes in milliseconds

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

    const activeMissiles = await prisma.missile.findMany({
      where: { status: 'Hit' }
    });

    const activeLandmines = await prisma.landmine.findMany();

    for (const user of activeUsers) {
      if (!user.Locations) continue;

      const userCoords = { latitude: parseFloat(user.Locations.latitude), longitude: parseFloat(user.Locations.longitude) };

      // Check missiles
      for (const missile of activeMissiles) {
        const missileCoords = { latitude: parseFloat(missile.destLat), longitude: parseFloat(missile.destLong) };
        const distance = haversine(userCoords.latitude.toString(), userCoords.longitude.toString(), missileCoords.latitude.toString(), missileCoords.longitude.toString());

        if (distance <= missile.radius) {
          await handleMissileDamage(user, missile);
        }
      }

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
  const message = `You're in a missile impact zone! You will start taking damage in 30 seconds.`;
  await sendNotification(user.username, "Missile Impact Alert!", message, "Server");

  setTimeout(async () => {
    await applyDamage(user, missile.damage, missile.sentBy, 'missile');
  }, DAMAGE_INTERVAL);
}

async function handleLandmineDamage(user: any, landmine: any) {
  const message = `You've stepped on a landmine! You will take damage in 30 seconds.`;
  await sendNotification(user.username, "Landmine Alert!", message, "Server");

  setTimeout(async () => {
    await applyDamage(user, landmine.damage, landmine.placedBy, 'landmine');
    // Delete the landmine after damage is applied
    await prisma.landmine.delete({ where: { id: landmine.id } });
  }, DAMAGE_INTERVAL);
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
async function applyDamage(user: GameplayUser, damage: number, attackerUsername: string, damageSource: 'missile' | 'landmine') {
  const updatedUser = await prisma.gameplayUser.update({
    where: { id: user.id },
    data: { health: { decrement: damage } },
    include: { Locations: true }
  });

  if (updatedUser.health <= 0) {
    await prisma.gameplayUser.update({
      where: { id: user.id },
      data: { isAlive: false, health: 0 }
    });
    // Check if the user's location is older than 5 minutes
    const locationAge = updatedUser.Locations?.updatedAt
      ? Date.now() - updatedUser.Locations.updatedAt.getTime()
      : Infinity;
    if (locationAge > FIVE_MINUTES) {
      // Death reward logic
      try {
        const attacker = await prisma.gameplayUser.findUnique({
          where: { username: attackerUsername },
        });

        if (attacker) {
          let rewardAmount = 0;
          let rankPointsReward = 0;

          if (damageSource === 'landmine') {
            const landmineType = await prisma.landmineType.findUnique({
              where: { name: 'StandardLandmine' }, // Adjust this type as needed
            });
            if (landmineType) {
              rewardAmount = Math.round(landmineType.price * 1.5);
              rankPointsReward = 300; // Base rank points for landmine kill
            }
          } else if (damageSource === 'missile') {
            const missileType = await prisma.missileType.findUnique({
              where: { name: 'StandardMissile' }, // Adjust this type as needed
            });
            if (missileType) {
              rewardAmount = Math.round(missileType.price * 1.5);
              rankPointsReward = 500; // Base rank points for missile kill
            }
          }

          // Add bonus rank points based on item price
          rankPointsReward += Math.round(rewardAmount / 10);

          // Update attacker's money and rank points
          await prisma.gameplayUser.update({
            where: { id: attacker.id },
            data: {
              money: { increment: rewardAmount },
              rankPoints: { increment: rankPointsReward },
            },
          });

          // Create a notification for the attacker
          await prisma.notifications.create({
            data: {
              userId: attacker.username,
              title: "Kill Reward",
              body: `You've been rewarded ${rewardAmount} coins and ${rankPointsReward} rank points for killing ${user.username} with your ${damageSource}!`,
              sentby: "server",
            },
          });
        }
      } catch (error) {
        console.error("Failed to process death reward:", error);
      }
    }

    const message = `You have been eliminated by a ${damageSource}!`;
    await sendNotification(user.username, "Eliminated!", message, "Server");
  } else if (damageSource === 'missile') {
    // Continue dealing damage for missiles
    setTimeout(() => applyDamage(user, damage, attackerUsername, damageSource), DAMAGE_INTERVAL);
  }
}