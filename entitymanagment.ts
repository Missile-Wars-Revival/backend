import { prisma } from "./server";
import * as geolib from 'geolib';
const { random } = require('lodash');

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

export const updateMissilePositions = async () => {
  try {
    const missiles = await prisma.missile.findMany({ where: { status: 'Incoming' } });

    const updates = missiles.map(async (missile) => {
      const timeNow = new Date();
      const timeLaunched = missile.sentAt; 
      const impactTime = missile.timeToImpact; 

      if (isNaN(timeLaunched.getTime()) || isNaN(impactTime.getTime())) {
        console.error('Invalid date found for missile ID:', missile.id);
        return;
      }

      const startPosition = { latitude: parseFloat(missile.currentLat), longitude: parseFloat(missile.currentLong) };
      const destinationPosition = { latitude: parseFloat(missile.destLat), longitude: parseFloat(missile.destLong) };

      const totalDistance = geolib.getDistance(startPosition, destinationPosition);
      const totalTime = impactTime.getTime() - timeLaunched.getTime();
      const speed = totalDistance / (totalTime / 1000); // Speed in meters per second

      const timeElapsed = timeNow.getTime() - timeLaunched.getTime();
      const distanceTraveled = speed * (timeElapsed / 1000); // Distance traveled till now

      if (distanceTraveled >= totalDistance && timeNow >= impactTime) {
        return prisma.missile.update({
          where: { id: missile.id },
          data: { currentLat: missile.destLat, currentLong: missile.destLong, status: 'Hit' }
        });
      } else {
        const newLocation = geolib.computeDestinationPoint(startPosition, distanceTraveled, geolib.getGreatCircleBearing(startPosition, destinationPosition));
        //console.log(`Missile ID: ${missile.id}, New Location: Latitude ${newLocation.latitude}, Longitude ${newLocation.longitude}`);

        return prisma.missile.update({
          where: { id: missile.id },
          data: { currentLat: newLocation.latitude.toString(), currentLong: newLocation.longitude.toString() }
        });
      }
    });

    await Promise.all(updates);
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

interface UserLocation {
  username: string;
  latitude: string;
  longitude: string;
  updatedAt: Date;
}

interface Cluster {
  [key: string]: UserLocation[];
}

// Function to generate random coordinates within a certain radius (in meters)
function getRandomCoordinatesLoot(baseLat: number, baseLong: number, radiusInKm: number) {
  const earthRadiusKm = 6371;
  // Convert radius from kilometers to degrees
  const radiusInDegrees = radiusInKm / earthRadiusKm;

  const u = Math.random();
  const v = Math.random();
  const w = radiusInDegrees * Math.sqrt(u);
  const t = 2 * Math.PI * v;
  const x = w * Math.cos(t);
  const y = w * Math.sin(t);

  // Adjust the x-coordinate for the shrinking of the east-west distances
  const new_x = x / Math.cos(baseLat * Math.PI / 180);

  const foundLatitude = baseLat + y;
  const foundLongitude = baseLong + new_x;

  return {
    latitude: foundLatitude,
    longitude: foundLongitude
  };
}

export const addRandomLoot = async () => {
  const twoDaysAgo = new Date(new Date().getTime() - 48 * 60 * 60 * 1000);
  const users = await prisma.locations.findMany({
    where: {
      updatedAt: {
        gte: twoDaysAgo
      }
    }
  });

  for (const user of users) {
    const baseLat = parseFloat(user.latitude);
    const baseLong = parseFloat(user.longitude);

    const nearbyLoot = await prisma.loot.findMany({
      where: {
        AND: [
          {
            locLat: {
              gte: (baseLat - 0.045).toFixed(6),
              lte: (baseLat + 0.045).toFixed(6)
            }
          },
          {
            locLong: {
              gte: (baseLong - 0.045).toFixed(6),
              lte: (baseLong + 0.045).toFixed(6)
            }
          }
        ]
      }
    });

    const neededLoot = Math.max(0, 2 - nearbyLoot.length);

    for (let i = 0; i < neededLoot; i++) {
      let attempts = 0;
      let clash;
      do {
        const randomCoordinates = getRandomCoordinatesLoot(baseLat, baseLong, 0.045); // 5km range
        const randomlocLat = parseFloat(randomCoordinates.latitude.toFixed(6));
        const randomlocLong = parseFloat(randomCoordinates.longitude.toFixed(6));

        // Check for clash within 10 meters
        clash = nearbyLoot.some(loot => {
          // Ensure coordinates from database are treated as numbers
          const lootLat = parseFloat(loot.locLat);
          const lootLong = parseFloat(loot.locLong);

          return Math.abs(lootLat - randomlocLat) < 0.00009 && Math.abs(lootLong - randomlocLong) < 0.00009;
        });

        if (!clash) {
          const rarities = ['Common', 'Uncommon', 'Rare'];
          const rarity = rarities[Math.floor(Math.random() * rarities.length)];

          try {
            await prisma.loot.create({
              data: {
                locLat: randomlocLat.toString(),
                locLong: randomlocLong.toString(),
                rarity,
                Expires: new Date(new Date().getTime() + 86400000) // Expires in 24 hours
              }
            });
            console.log(`Loot added near ${user.username}: ${rarity} at (${randomlocLat}, ${randomlocLong})`);
          } catch (error) {
            console.error('Failed to add loot:', error);
          }
        }
        attempts++;
      } while (clash && attempts < 10); // Try up to 10 times to find a non-clashing location
    }
  }
};