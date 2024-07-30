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

export const updateMissilePositions = async () => {
  try {
    const missiles = await prisma.missile.findMany({ where: { status: 'Incoming' } });

    const updates = missiles.map(async (missile) => {
      const timeNow = new Date();
      const timeLaunched = new Date(missile.sentAt); // assuming missile.sentAt is a valid DateTime string
      const impactTime = new Date(missile.timeToImpact); // assuming it's a valid DateTime string

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

      if (distanceTraveled >= totalDistance) {
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
          lt: new Date(now.getTime() - 300000) // Missiles that impacted more than 5 seconds ago
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