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
      // Fetch only 'Incoming' missiles to process
      const missiles = await prisma.missile.findMany({
        where: {
          status: 'Incoming'
        }
      });
  
      for (const missile of missiles) {
        const timeNow = new Date();
        const timeLaunched = new Date(missile.sentAt);
        const impactTime = new Date(missile.timeToImpact);
  
        // Error handling for invalid dates
        if (isNaN(timeLaunched.getTime()) || isNaN(impactTime.getTime())) {
          console.error('Invalid date found:', missile.sentAt, missile.timeToImpact);
          continue; // Skip this missile and continue with the next
        }
  
        // Calculate the total and elapsed time in milliseconds
        const totalTime = impactTime.getTime() - timeLaunched.getTime();
        const timeElapsed = timeNow.getTime() - timeLaunched.getTime();
  
        // Calculate start and destination positions
        const startPosition = { latitude: parseFloat(missile.currentLat), longitude: parseFloat(missile.currentLong) };
        const destinationPosition = { latitude: parseFloat(missile.destLat), longitude: parseFloat(missile.destLong) };
  
        // Determine the fraction of the journey that has elapsed
        const fractionOfTimeElapsed = timeElapsed / totalTime;
  
        if (fractionOfTimeElapsed >= 1) {
          // Update missile status to 'Hit' if the time has elapsed
          await prisma.missile.update({
            where: { id: missile.id },
            data: {
              currentLat: missile.destLat,
              currentLong: missile.destLong,
              status: 'Hit'
            }
          });
        } else {
          // Calculate new position based on the fraction of the journey completed
          const distance = geolib.getDistance(startPosition, destinationPosition);
          const bearing = geolib.getRhumbLineBearing(startPosition, destinationPosition);
          const newLocation = geolib.computeDestinationPoint(startPosition, fractionOfTimeElapsed * distance, bearing);
  
          await prisma.missile.update({
            where: { id: missile.id },
            data: {
              currentLat: newLocation.latitude.toString(),
              currentLong: newLocation.longitude.toString()
            }
          });
        }
      }
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
            lt: new Date(now.getTime() - 5000) // Missiles that impacted more than 5 seconds ago
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