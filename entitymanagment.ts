import { prisma } from "./server";
import * as geolib from 'geolib';

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
interface Coordinates {
  latitude: number;
  longitude: number;
}

function interpolatePosition(start: Coordinates, end: Coordinates, fraction: number): Coordinates {
  const distance = geolib.getDistance(start, end);
  const bearing = geolib.getRhumbLineBearing(start, end);
  return geolib.computeDestinationPoint(start, distance * fraction, bearing);
}

export const updateMissilePositions = async () => {
  try {
    const missiles = await prisma.missile.findMany({ where: { status: 'Incoming' } });
    const currentTime = new Date();

    const updates = missiles.map(async (missile) => {
      const startPosition = { latitude: parseFloat(missile.currentLat), longitude: parseFloat(missile.currentLong) };
      const destinationPosition = { latitude: parseFloat(missile.destLat), longitude: parseFloat(missile.destLong) };
      const timeLaunched = new Date(missile.sentAt);
      const impactTime = new Date(missile.timeToImpact);

      if (isNaN(timeLaunched.getTime()) || isNaN(impactTime.getTime())) {
        console.error('Invalid date found for missile ID:', missile.id);
        return;
      }

      const totalFlightTime = impactTime.getTime() - timeLaunched.getTime();
      const elapsedTime = currentTime.getTime() - timeLaunched.getTime();
      const remainingTime = impactTime.getTime() - currentTime.getTime();

      // If the missile has reached its destination
      if (remainingTime <= 0) {
        return prisma.missile.update({
          where: { id: missile.id },
          data: { 
            currentLat: missile.destLat, 
            currentLong: missile.destLong, 
            status: 'Hit' 
          }
        });
      }

      // Calculate the fraction of the journey completed
      const fractionCompleted = elapsedTime / totalFlightTime;

      // Use our custom interpolation function
      const newPosition = interpolatePosition(startPosition, destinationPosition, fractionCompleted);

      return prisma.missile.update({
        where: { id: missile.id },
        data: { 
          currentLat: newPosition.latitude.toFixed(6), 
          currentLong: newPosition.longitude.toFixed(6)
        }
      });
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
    where: { updatedAt: { gte: twoDaysAgo } }
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
