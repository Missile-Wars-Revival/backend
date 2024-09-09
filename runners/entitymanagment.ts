import { prisma } from "../server";
import * as geolib from 'geolib';
import { getMutualFriends } from "../server-routes/friendsApi";
import { sendNotification } from "./notificationhelper";
import * as turf from '@turf/turf';
import { getRandomLoot } from './lootConfig';

// Define our own Position interface
interface Position extends Array<number> {
  0: number;
  1: number;
}

// Add this at the top of your file or in an appropriate scope
const notifiedEntities = new Set<string>();

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

// Add this helper function at the top of your file
function interpolatePosition(start: {latitude: number, longitude: number}, end: {latitude: number, longitude: number}, fraction: number): {latitude: number, longitude: number} {
  const distance = geolib.getDistance(start, end);
  const bearing = geolib.getRhumbLineBearing(start, end);
  return geolib.computeDestinationPoint(start, distance * fraction, bearing);
}

const HOLDING_PATTERN_DISTANCE = 1; // km from target to start holding pattern
const HOLDING_PATTERN_RADIUS = 0.5; // km radius of the holding pattern circle

export const updateMissilePositions = async () => {
  const batchSize = 100; // Adjust based on your system's capacity
  let processedCount = 0;
  let updatedCount = 0;

  try {
    const currentTime = new Date();

    while (true) {
      const missiles = await prisma.missile.findMany({
        where: { status: 'Incoming' },
        take: batchSize,
        skip: processedCount,
      });

      if (missiles.length === 0) break;

      const updates = missiles.map(async (missile) => {
        const timeToImpact = new Date(missile.timeToImpact);
        const remainingTime = timeToImpact.getTime() - currentTime.getTime();

        if (remainingTime <= 0) {
          updatedCount++;
          return prisma.missile.update({
            where: { id: missile.id },
            data: { 
              currentLat: missile.destLat,
              currentLong: missile.destLong,
              status: 'Hit' 
            }
          });
        }

        const startLong = parseFloat(missile.currentLong);
        const startLat = parseFloat(missile.currentLat);
        const endLong = parseFloat(missile.destLong);
        const endLat = parseFloat(missile.destLat);

        const start = turf.point([startLong, startLat]);
        const end = turf.point([endLong, endLat]);
        const totalDistance = turf.distance(start, end, {units: 'kilometers'});

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
          
          if (distanceToTarget <= HOLDING_PATTERN_DISTANCE && remainingTime > 0) {
            const holdingCenter = turf.destination(end, HOLDING_PATTERN_DISTANCE, 0, {units: 'kilometers'});
            const angleInPattern = (currentTime.getTime() % 10000) / 10000 * 360;
            newPosition = turf.destination(holdingCenter, HOLDING_PATTERN_RADIUS, angleInPattern, {units: 'kilometers'});
          }
        }

        const newLat = newPosition.geometry.coordinates[1].toString();
        const newLong = newPosition.geometry.coordinates[0].toString();

        // Only update if the position has changed significantly
        if (newLat !== missile.currentLat || newLong !== missile.currentLong) {
          updatedCount++;
          return prisma.missile.update({
            where: { id: missile.id },
            data: { 
              currentLat: newLat,
              currentLong: newLong,
              status: fractionCompleted >= 1 ? 'Hit' : 'Incoming'
            }
          });
        }
        return null;
      });

      await Promise.all(updates.filter(Boolean));
      processedCount += missiles.length;
    }

    console.log(`Processed ${processedCount} missiles, updated ${updatedCount}`);

    // Cleanup expired missiles
    const cleanupResult = await prisma.missile.deleteMany({
      where: {
        status: 'Hit',
        timeToImpact: { lt: new Date(currentTime.getTime() - 5 * 60 * 1000) } // Delete missiles that hit more than 5 minutes ago
      }
    });
    console.log(`Cleaned up ${cleanupResult.count} expired missiles`);

  } catch (error) {
    console.error('Failed to update missile positions:', error);
  }
};

// Delete items:
export const deleteExpiredMissiles = async () => {
  try {
    // Current time
    const now = new Date();

    // Find and delete missiles where status is 'Hit' and fallout time has elapsed
    const result = await prisma.missile.deleteMany({
      where: {
        status: 'Hit',
        timeToImpact: {
          lt: new Date(now.getTime() - 300000) // Missiles that impacted more than 30 mins ago
        }
      }
    });

    console.log(`${result.count} missiles deleted.`);
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
          lt: new Date(now.getTime()) // Missiles that impacted more than 5 seconds ago
        }
      }
    });

    console.log(`${result.count} loot deleted.`);
  } catch (error) {
    console.error('Failed to delete expired loot:', error);
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
      username: {
        notIn: (await prisma.users.findMany({
          where: { role: "bot" }, // filter for bots
          select: { username: true }
        })).map(user => user.username)
      }
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

      // Fetch loot (regardless of friendsOnly setting)
      const loot = await prisma.loot.findMany();

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

      const LOOT_RADIUS = 0.02; // 20 meters = 0.02 km
      const LOOT_NEARBY_DISTANCE = 0.5; // 0.5 km = 500 meters
      let nearbyLootCount = 0;
      let collectedLoot = [];
      let totalRankPointsGained = 0;
      let totalCoinsGained = 0;

      for (const item of loot) {
        const lootCoords = { latitude: parseFloat(item.locLat), longitude: parseFloat(item.locLong) };
        const distance = haversineDistance(userCoords, lootCoords); // This returns distance in km
        const entityId = `loot-${item.id}-${user.id}`;
        
        if (!notifiedEntities.has(entityId)) {
          if (distance <= LOOT_RADIUS) {
            // Collect the loot
            const randomLoot = getRandomLoot(item.rarity);
            if (randomLoot) {
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
              collectedLoot.push(randomLoot);

              // Add rank points and coins
              totalRankPointsGained += 50;
              totalCoinsGained += 200;
            }
            await prisma.loot.delete({ where: { id: item.id } });
            notifiedEntities.add(entityId);
          } else if (distance <= LOOT_NEARBY_DISTANCE) {
            nearbyLootCount++;
            notifiedEntities.add(entityId);
          }
        }
      }

      // Update user's rank points and money
      if (totalRankPointsGained > 0 || totalCoinsGained > 0) {
        await prisma.gameplayUser.update({
          where: { id: user.id },
          data: {
            rankPoints: { increment: totalRankPointsGained },
            money: { increment: totalCoinsGained }
          }
        });
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

      // Send a notification for collected loot
      if (collectedLoot.length > 0) {
        const lootMessage = collectedLoot.map(item => `${item.name} (${item.category})`).join(', ');
        await sendNotification(
          user.username, 
          "Loot Collected!", 
          `You've collected: ${lootMessage}. You gained ${totalRankPointsGained} rank points and ${totalCoinsGained} coins!`, 
          "Server"
        );
      }
    }
  } catch (error) {
    console.error('Failed to check player proximity:', error);
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
