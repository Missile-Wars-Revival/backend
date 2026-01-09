import { prisma } from "../server";
import { haversine } from "./entitymanagment";
import { sendNotification } from "./notificationhelper";

const PROCESS_INTERVAL = 15000; // 15 seconds in milliseconds

export const processShieldBreakers = async () => {
  try {
    const now = new Date();
    //console.log(`[ShieldBreaker] Starting process at ${now.toISOString()}`);

    const shieldBreakerMissiles = await prisma.missile.findMany({
      where: {
        type: 'ShieldBreaker',
        status: 'Hit',
        timeToImpact: { lte: now }
      }
    });

    console.log(`[ShieldBreaker] Found ${shieldBreakerMissiles.length} missiles to process`);

    for (const missile of shieldBreakerMissiles) {
      console.log(`[ShieldBreaker] Processing missile ID: ${missile.id}`);
      const missileCoords = { latitude: parseFloat(missile.destLat), longitude: parseFloat(missile.destLong) };

      // Find all active shields in the area
      const activeShields = await prisma.other.findMany({
        where: {
          type: { in: ['Shield', 'UltraShield'] },
          Expires: { gt: now }
        }
      });

      console.log(`[ShieldBreaker] Found ${activeShields.length} active shields`);

      const shieldsToBreak = activeShields.filter((shield: { locLat: string; locLong: string; }) => {
        const shieldCoords = { latitude: parseFloat(shield.locLat), longitude: parseFloat(shield.locLong) };
        const distance = haversine(
          missileCoords.latitude.toString(),
          missileCoords.longitude.toString(),
          shieldCoords.latitude.toString(),
          shieldCoords.longitude.toString()
        );
        return distance <= missile.radius;
      });

      console.log(`[ShieldBreaker] ${shieldsToBreak.length} shields will be broken`);

      let totalUsersNotified = 0;

      // Break shields and send notifications
      for (const shield of shieldsToBreak) {
        // Find users within the shield's radius
        const usersWithinShield = await prisma.gameplayUser.findMany({
          where: {
            Locations: {
              latitude: {
                gte: (parseFloat(shield.locLat) - shield.radius / 111.32).toString(),
                lte: (parseFloat(shield.locLat) + shield.radius / 111.32).toString(),
              },
              longitude: {
                    gte: (parseFloat(shield.locLong) - shield.radius / (111.32 * Math.cos(parseFloat(shield.locLat) * Math.PI / 180))).toString(),
                lte: (parseFloat(shield.locLong) + shield.radius / (111.32 * Math.cos(parseFloat(shield.locLat) * Math.PI / 180))).toString(),
              },
            },
            isAlive: true,
            locActive: true,
          },
        });

        console.log(`[ShieldBreaker] Shield ID ${shield.id}: ${usersWithinShield.length} users affected`);

        // Delete the shield
        await prisma.other.delete({ where: { id: shield.id } });
        
        // Notify users and count notifications
        totalUsersNotified += usersWithinShield.length;
        for (const user of usersWithinShield) {
          await sendNotification(user.username, "Shield Destroyed!", `A shield protecting you has been destroyed by a Shield Breaker missile from ${missile.sentBy}!`, missile.sentBy);
        }
        
        // Notification for the shield placer
        if (!usersWithinShield.some((user: { username: any; }) => user.username === shield.placedBy)) {
          await sendNotification(shield.placedBy, "Shield Destroyed!", `The shield you placed has been destroyed by a Shield Breaker missile from ${missile.sentBy}!`, missile.sentBy);
          totalUsersNotified++;
        }
      }

      console.log(`[ShieldBreaker] Total users notified: ${totalUsersNotified}`);
      
      console.log(`[ShieldBreaker] Missile ID ${missile.id} processed and updated`);
    }

    console.log(`[ShieldBreaker] Process completed at ${new Date().toISOString()}`);
  } catch (error) {
    console.error('[ShieldBreaker] Failed to process ShieldBreaker missiles:', error);
  }
};

export const startShieldBreakerProcessing = () => {
  setInterval(processShieldBreakers, PROCESS_INTERVAL);
  console.log('ShieldBreaker processing started, running every 15 seconds');
};
