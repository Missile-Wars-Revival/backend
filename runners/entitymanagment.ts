import { prisma } from "../server";
import * as geolib from 'geolib';
import { getMutualFriends } from "../server-routes/friendsApi";
import { sendNotification } from "./notificationhelper";
import * as turf from '@turf/turf';
import { getRandomLoot } from "./lootconfig";

// Define our own Position interface
interface Position extends Array<number> {
  0: number;
  1: number;
}

// Add this at the top of your file or in an appropriate scope
const notifiedEntities = new Set<string>();
const notifiedLootItems = new Set<string>();

export const haversine = (lat1: string, lon1: string, lat2: string, lon2: string) => {
  const R = 6371e3; // meters
  const φ1 = parseFloat(lat1) * Math.PI / 180;
  const φ2 = parseFloat(lat2) * Math.PI / 180;
  const Δφ = (parseFloat(lat2) - parseFloat(lat1)) * Math.PI / 180;
  const Δλ = (parseFloat(lon2) - parseFloat(lon1)) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c); // in meters, rounded to the nearest integer
};

export function getRandomCoordinates(latitude: number, longitude: number, radiusInMeters: number) {
  // Generate a random point within the given radius
  const randomPoint = geolib.computeDestinationPoint(
    { latitude, longitude },
    Math.random() * radiusInMeters,
    Math.random() * 360
  );
  return randomPoint;
}

const HOLDING_PATTERN_DISTANCE = 1; // km from target to start holding pattern
const HOLDING_PATTERN_RADIUS = 0.5; // km radius of the holding pattern circle

export const updateMissilePositions = async () => {
  try {
    const currentTime = new Date();
    const missiles = await prisma.missile.findMany({
      where: { status: 'Incoming' },
    });

    for (const missile of missiles) {
      const timeToImpact = new Date(missile.timeToImpact);
      const remainingTime = timeToImpact.getTime() - currentTime.getTime();

      if (remainingTime <= 0) {
        await prisma.missile.update({
          where: { id: missile.id },
          data: { 
            currentLat: missile.destLat,
            currentLong: missile.destLong,
            status: 'Hit' 
          }
        });
      } else {
        // Calculate new position
        const newPosition = calculateNewPosition({
          ...missile,
          timeToImpact: missile.timeToImpact.toISOString(),
          sentAt: missile.sentAt.toISOString()
        }, currentTime);
        
        await prisma.missile.update({
          where: { id: missile.id },
          data: { 
            currentLat: newPosition.lat,
            currentLong: newPosition.long,
            status: 'Incoming'
          }
        });
      }
    }

    console.log(`Updated ${missiles.length} missiles`);

  } catch (error) {
    console.error('Failed to update missile positions:', error);
  }
};

// Helper function to calculate new position (implement this based on your logic)
function calculateNewPosition(missile: {
  currentLong: string;
  currentLat: string;
  destLong: string;
  destLat: string;
  timeToImpact: string;
  sentAt: string;
}, currentTime: Date) {
  const startLong = parseFloat(missile.currentLong);
  const startLat = parseFloat(missile.currentLat);
  const endLong = parseFloat(missile.destLong);
  const endLat = parseFloat(missile.destLat);

  const start = turf.point([startLong, startLat]);
  const end = turf.point([endLong, endLat]);
  const totalDistance = turf.distance(start, end, {units: 'kilometers'});

  const timeToImpact = new Date(missile.timeToImpact);
  const totalTravelTime = timeToImpact.getTime() - new Date(missile.sentAt).getTime();
  const elapsedTime = currentTime.getTime() - new Date(missile.sentAt).getTime();
  const fractionCompleted = Math.min(elapsedTime / totalTravelTime, 1);

  let newPosition;

  if (fractionCompleted >= 1) {
    newPosition = end;
  } else {
    const line = turf.lineString([start.geometry.coordinates, end.geometry.coordinates]);
    const distanceToTravel = totalDistance * fractionCompleted;
    newPosition = turf.along(line, distanceToTravel, {units: 'kilometers'});

    const distanceToTarget = turf.distance(newPosition, end, {units: 'kilometers'});
    
    if (distanceToTarget <= HOLDING_PATTERN_DISTANCE && (timeToImpact.getTime() - currentTime.getTime()) > 0) {
      const holdingCenter = turf.destination(end, HOLDING_PATTERN_DISTANCE, 0, {units: 'kilometers'});
      const angleInPattern = (currentTime.getTime() % 10000) / 10000 * 360;
      newPosition = turf.destination(holdingCenter, HOLDING_PATTERN_RADIUS, angleInPattern, {units: 'kilometers'});
    }
  }

  return {
    lat: newPosition.geometry.coordinates[1].toString(),
    long: newPosition.geometry.coordinates[0].toString()
  };
}

// Delete items:
export const deleteExpiredMissiles = async () => {
  try {
    // Current time
    const now = new Date();

    // Fetch all missile types with their fallout times
    const missileTypes = await prisma.missileType.findMany({
      select: { name: true, fallout: true }
    });

    // Create a map for quick lookup
    const falloutTimeMap = new Map(missileTypes.map(mt => [mt.name, mt.fallout]));

    // Find and delete expired missiles
    const expiredMissiles = await prisma.missile.findMany({
      where: { status: 'Hit' },
      select: { id: true, type: true, timeToImpact: true }
    });

    const deletedMissiles = await Promise.all(expiredMissiles.map(async (missile) => {
      const falloutTimeMinutes = falloutTimeMap.get(missile.type) || 1800; // Default to 30 minutes if not found
      const expirationTime = new Date(missile.timeToImpact.getTime() + falloutTimeMinutes * 60 * 1000); // Convert minutes to milliseconds

      if (expirationTime < now) {
        return prisma.missile.delete({ where: { id: missile.id } });
      }
      return null;
    }));

    const deletedCount = deletedMissiles.filter(Boolean).length;
    console.log(`${deletedCount} missiles deleted.`);
  } catch (error) {
    console.error('Failed to delete expired missiles:', error);
  }
};

export const deleteExpiredLandmines = async () => {
  try {
    // Current time
    const now = new Date();

    // Find and delete missiles where status is 'Hit' and fallout time has elapsed
    const result = await prisma.landmine.deleteMany({
      where: {
        Expires: {
          lt: new Date(now.getTime()) // Missiles that impacted more than 5 seconds ago
        }
      }
    });

    console.log(`${result.count} landmines deleted.`);
  } catch (error) {
    console.error('Failed to delete expired landmines:', error);
  }
};

export const deleteExpiredLoot = async () => {
  try {
    // Current time
    const now = new Date();

    // Find and delete missiles where status is 'Hit' and fallout time has elapsed
    const result = await prisma.loot.deleteMany({
      where: {
        Expires: {
          lt: new Date(now.getTime()) // Landmines that expired 
        }
      }
    });

    console.log(`${result.count} loot deleted.`);
  } catch (error) {
    console.error('Failed to delete expired loot:', error);
  }
};

export const deleteExpiredOther = async () => {
  try {
    // Current time
    const now = new Date();

    // Find and delete other
    const result = await prisma.other.deleteMany({
      where: {
        Expires: {
          lt: new Date(now.getTime()) // other that expired
        }
      }
    });

    console.log(`${result.count} other deleted.`);
  } catch (error) {
    console.error('Failed to delete expired other:', error);
  }
};

const haversineDistance = (coords1: { latitude: any; longitude: any; }, coords2: { latitude: any; longitude: any; }, isMiles = false) => {
  function toRad(x: number) {
    return x * Math.PI / 180;
  }

  var lon1 = coords1.longitude;
  var lat1 = coords1.latitude;

  var lon2 = coords2.longitude;
  var lat2 = coords2.latitude;

  var R = 6371; // km
  if (isMiles) R = 3959; // miles

  var x1 = lat2 - lat1;
  var dLat = toRad(x1);
  var x2 = lon2 - lon1;
  var dLon = toRad(x2)
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * 
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  var d = R * c;

  return d;
};


export const addRandomLoot = async () => {
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const userLocations = await prisma.locations.findMany({
    where: {
      updatedAt: { gte: twoDaysAgo },
      // username: {
      //   notIn: (await prisma.users.findMany({
      //     where: { role: "bot" }, // filter for bots
      //     select: { username: true }
      //   })).map(user => user.username)
      // }
    }
  });

  if (userLocations.length === 0) {
    console.log('No active user locations available to place loot.');
    return;
  }

  const randomUserLocation = userLocations[Math.floor(Math.random() * userLocations.length)];
  const baseCoords = { latitude: parseFloat(randomUserLocation.latitude), longitude: parseFloat(randomUserLocation.longitude) };

  const nearbyLoot = await prisma.loot.findMany();
  const lootThreshold = 0.5; // distance in kilometers below which loot is considered "nearby"

  const isLootNearby = nearbyLoot.some(loot => {
    const lootCoords = { latitude: parseFloat(loot.locLat), longitude: parseFloat(loot.locLong) };
    return haversineDistance(baseCoords, lootCoords) < lootThreshold;
  });

  if (isLootNearby) {
    console.log('Loot not added, as there is already loot nearby.');
    return;
  }

  const randomCoordinates = getRandomCoordinates(baseCoords.latitude, baseCoords.longitude, 100);
  const locLat = randomCoordinates.latitude.toFixed(6);
  const locLong = randomCoordinates.longitude.toFixed(6);

  const rarities = ['Common', 'Uncommon', 'Rare'];
  const rarity = rarities[Math.floor(Math.random() * rarities.length)];

  try {
    await prisma.loot.create({
      data: {
        locLat,
        locLong,
        rarity,
        Expires: new Date(Date.now() + 86400000) // Expires in 24 hours
      }
    });
    console.log(`Loot added.`);
  } catch (error) {
    console.error('Failed to add loot:', error);
  }
};

// Constants for distance thresholds in kilometers
const MISSILE_ALERT_DISTANCE = 0.5; // 0.5 km = 500 meters
const LANDMINE_ALERT_DISTANCE = 0.05; // 0.05 km = 50 meters

export const checkPlayerProximity = async () => {
  try {
    const allUsers = await prisma.gameplayUser.findMany({
      where: {
        isAlive: true,
        locActive: true
      },
      include: { Users: true, Locations: true }
    });

    for (const user of allUsers) {
      if (!user.Locations) continue;

      const userCoords = { latitude: parseFloat(user.Locations.latitude), longitude: parseFloat(user.Locations.longitude) };

      // Fetch relevant entities based on friendsOnly setting
      let missiles, landmines;
      if (user.friendsOnly) {
        const mutualFriends = await getMutualFriends(user.Users);
        missiles = await prisma.missile.findMany({ where: { sentBy: { in: mutualFriends } } });
        landmines = await prisma.landmine.findMany({ where: { placedBy: { in: mutualFriends } } });
      } else {
        const nonFriendsOnlyUsers = await prisma.gameplayUser.findMany({
          where: { OR: [{ friendsOnly: false }, { username: { in: await getMutualFriends(user.Users) } }] },
          select: { username: true }
        });
        const relevantUsernames = nonFriendsOnlyUsers.map(u => u.username);
        missiles = await prisma.missile.findMany({ where: { sentBy: { in: relevantUsernames } } });
        landmines = await prisma.landmine.findMany({ where: { placedBy: { in: relevantUsernames } } });
      }

      // Check proximity to missiles
      for (const missile of missiles) {
        const missileCoords = { latitude: parseFloat(missile.destLat), longitude: parseFloat(missile.destLong) };
        const distance = haversineDistance(userCoords, missileCoords); // Already in km
        
        const entityId = `missile-${missile.id}-${user.id}`; // Unique identifier for this missile-user pair
        
        if (!notifiedEntities.has(entityId)) {
          if (missile.status !== 'Hit') {
            if (distance <= missile.radius / 1000 + MISSILE_ALERT_DISTANCE) { // Convert missile.radius from meters to km
              // Calculate ETA
              const currentTime = new Date();
              const timeToImpact = new Date(missile.timeToImpact);
              const etaSeconds = Math.max(0, Math.round((timeToImpact.getTime() - currentTime.getTime()) / 1000));
              const etaHours = Math.floor(etaSeconds / 3600);
              const etaMinutes = Math.floor((etaSeconds % 3600) / 60);
              const remainingSeconds = etaSeconds % 60;

              let etaString = '';
              if (etaHours > 0) {
                etaString = `${etaHours} hour${etaHours > 1 ? 's' : ''}`;
              } else if (etaMinutes > 0) {
                etaString = `${etaMinutes} minute${etaMinutes > 1 ? 's' : ''}`;
              } else {
                etaString = `${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''}`;
              }

              const message = distance <= missile.radius / 1000
                ? `A missile is approaching your location! ETA: ${etaString}. Take cover!`
                : `A missile is approaching nearby! ETA: ${etaString}. Be prepared to take cover.`;
              await sendNotification(user.username, "Missile Alert!", message, "Server");
              notifiedEntities.add(entityId);
            }
          } else { // missile.status === 'Hit'
            if (distance <= missile.radius / 1000 + MISSILE_ALERT_DISTANCE) { // Convert missile.radius from meters to km
              const message = "A missile has impacted nearby! Proceed with caution.";
              await sendNotification(user.username, "Missile Impact Alert!", message, "Server");
              notifiedEntities.add(entityId);
            }
          }
        }
      }

      // Check proximity to landmines
      for (const landmine of landmines) {
        const landmineCoords = { latitude: parseFloat(landmine.locLat), longitude: parseFloat(landmine.locLong) };
        const distance = haversineDistance(userCoords, landmineCoords); // Already in km
        const entityId = `landmine-${landmine.id}-${user.id}`;
        
        if (!notifiedEntities.has(entityId) && distance <= LANDMINE_ALERT_DISTANCE) {
          await sendNotification(user.username, "Landmine Nearby!", `Caution: You're within 50 meters of a landmine!`, "Server");
          notifiedEntities.add(entityId);
        }
      }

    }
  } catch (error) {
    console.error('Error in checkPlayerProximity:', error);
  }
};

// Add this function to clear notifications when appropriate (e.g., when a missile is removed)
function clearNotification(entityType: string, entityId: string) {
  notifiedEntities.forEach((notifiedEntityId) => {
    if (notifiedEntityId.startsWith(`${entityType}-${entityId}-`)) {
      notifiedEntities.delete(notifiedEntityId);
    }
  });
}

export const checkAndCollectLoot = async () => {
  try {
    const allUsers = await prisma.gameplayUser.findMany({
      where: {
        isAlive: true,
        locActive: true
      },
      include: { Users: true, Locations: true }
    });

    for (const user of allUsers) {
      if (!user.Locations) continue;

      const userCoords = { latitude: parseFloat(user.Locations.latitude), longitude: parseFloat(user.Locations.longitude) };
      
      const loot = await prisma.loot.findMany();

      const LOOT_RADIUS = 0.05; // 50 meters = 0.05 km
      const LOOT_NEARBY_DISTANCE = 0.5; // 0.5 km = 500 meters
      let nearbyLootCount = 0;
      let collectedLoot = [];
      let totalCoinsGained = 0; // Initialize to 0
      let totalRankPointsGained = 0;
      let totalHealthGained = 0;

      for (const item of loot) {
        const lootCoords = { latitude: parseFloat(item.locLat), longitude: parseFloat(item.locLong) };
        const distance = haversineDistance(userCoords, lootCoords); // This returns distance in km
        
        const lootNotificationId = `${item.id}-${user.id}`;
        
        if (distance <= LOOT_RADIUS) {
          // Collect the loot
          const randomLoot = getRandomLoot(item.rarity);
          if (randomLoot) {
            if (randomLoot.category === 'Currency' && randomLoot.name === 'Coins') {
              totalCoinsGained += 1000; // Add coins only when collected
            } else {
              // Check if the item already exists in the user's inventory
              const existingItem = await prisma.inventoryItem.findFirst({
                where: {
                  userId: user.id,
                  name: randomLoot.name,
                  category: randomLoot.category
                }
              });

              if (existingItem) {
                // If the item exists, update its quantity
                await prisma.inventoryItem.update({
                  where: { id: existingItem.id },
                  data: { quantity: existingItem.quantity + 1 }
                });
              } else {
                // If the item doesn't exist, create a new entry
                await prisma.inventoryItem.create({
                  data: {
                    userId: user.id,
                    name: randomLoot.name,
                    category: randomLoot.category,
                    quantity: 1
                  }
                });
              }
            }
            collectedLoot.push(randomLoot);

            // Add rank points and health
            totalRankPointsGained += 50;
            totalHealthGained += 40;
            totalCoinsGained += 200; 
          }
          try {
            await prisma.loot.delete({ where: { id: item.id } });
            console.log(`Loot item ${item.id} deleted successfully`);
            notifiedLootItems.delete(lootNotificationId); // Remove from notified set if collected
          } catch (error) {
            console.error(`Failed to delete loot item ${item.id}:`, error);
          }
        } else if (distance <= LOOT_NEARBY_DISTANCE && !notifiedLootItems.has(lootNotificationId)) {
          nearbyLootCount++;
          notifiedLootItems.add(lootNotificationId);
        }
      }

      // Fetch current user health
      const currentUser = await prisma.gameplayUser.findUnique({
        where: { id: user.id },
        select: { health: true }
      });

      if (currentUser) {
        const newHealth = Math.min(currentUser.health + totalHealthGained, 100);
        const actualHealthGained = newHealth - currentUser.health;

        // Update user's rank points, money, and health
        if (totalRankPointsGained > 0 || totalCoinsGained > 0 || actualHealthGained > 0) {
          await prisma.gameplayUser.update({
            where: { id: user.id },
            data: {
              rankPoints: { increment: totalRankPointsGained },
              money: { increment: totalCoinsGained },
              health: newHealth
            }
          });
        }

        // Update the notification message to include all collected items
        if (collectedLoot.length > 0) {
          const lootMessage = collectedLoot.map(item => 
            item.category === 'Currency' && item.name === 'Coins' ? '1000 coins' : `${item.name} (${item.category})`
          ).join(', ');
          const healthMessage = actualHealthGained > 0 
            ? `and ${actualHealthGained} health`
            : '(health already at maximum)';
          await sendNotification(
            user.username, 
            "Loot Collected!", 
            `You've collected: ${lootMessage}. You gained ${totalRankPointsGained} rank points, ${totalCoinsGained} coins, ${healthMessage}!`, 
            "Server"
          );
        }
      }

      // Send a notification for nearby loot
      if (nearbyLootCount > 0) {
        await sendNotification(
          user.username, 
          "Loot Nearby!", 
          `There ${nearbyLootCount === 1 ? 'is' : 'are'} ${nearbyLootCount} loot item${nearbyLootCount === 1 ? '' : 's'} within 500 meters of you!`, 
          "Server"
        );
      }
    }

    // Clean up old notifications
    const currentTime = Date.now();
    notifiedLootItems.forEach(async (id) => {
      const [lootId, userId] = id.split('-');
      const loot = await prisma.loot.findUnique({ where: { id: parseInt(lootId) } });
      if (!loot) {
        notifiedLootItems.delete(id);
      }
    });

  } catch (error) {
    console.error('Failed to check and collect loot:', error);
  }
};