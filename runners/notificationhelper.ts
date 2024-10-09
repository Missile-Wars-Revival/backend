import Expo from "expo-server-sdk";
import { prisma } from "../server";
import { NotificationPreferences } from "@prisma/client";

const expo = new Expo();

export async function sendNotification(username: string, title: string, body: string, sentby: string) {
    const user = await prisma.users.findUnique({
      where: { username },
      include: { notificationPreferences: true },
    });
  
    if (!user) {
      console.log(`No user found for username: ${username}`);
      return;
    }

    // Check user notification preferences based on title
    const shouldSendNotification = checkNotificationPreference(title, user.notificationPreferences);
    if (!shouldSendNotification) {
      console.log(`Notification not sent for ${username} due to preferences.`);
      return;
    }

    // Create the notification in the database regardless of the Expo token
    const notification = await prisma.notifications.create({
      data: {
        userId: username,
        title,
        body,
        sentby,
        // The id, timestamp, and isRead fields will be automatically handled by Prisma
      }
    });
    console.log('Notification created:', notification);

    if (!user.notificationToken) {
      console.log(`No notification token for username: ${username}`);
      return;
    }

    if (!Expo.isExpoPushToken(user.notificationToken)) {
      console.error(`Push token ${user.notificationToken} is not a valid Expo push token`);
      return;
    }
  
    const message = {
      to: user.notificationToken,
      sound: 'default',
      title,
      body,
      data: { withSome: 'data' },
    };
  
    try {
      const result = await expo.sendPushNotificationsAsync([{
        to: message.to,
        sound: "default",
        title: message.title,
        body: message.body,
        data: message.data,
      }]);
      console.log('Expo push result:', result);
    } catch (error) {
      console.error('Error sending notification:', error);
    }
}

// Function to check notification preferences based on title
function checkNotificationPreference(title: string, preferences: NotificationPreferences | null): boolean {
    if (!preferences) return false; // No preferences set

    const preferenceMap: { [key: string]: keyof NotificationPreferences } = {
        "Missile Alert!": "incomingEntities",
        "Incoming Missile!": "incomingEntities",
        "Missile Damage!": "entityDamage",
        "Damage!": "entityDamage",
        "Loot Nearby!": "lootDrops",
        "Loot Collected!": "lootDrops",
        "Shield Destroyed": "entityDamage",
        "Airspace Alert!": "entitiesInAirspace",
        "Grace Period Activated": "entityDamage",
        "Eliminated!": "entityDamage",
        "League Promotion!": "leagues",
        "League Change": "leagues",
        "Landmine Nearby!": "entitiesInAirspace",
        "Landmine Damage!": "entityDamage",
        "Friend Request": "friendRequests",
        "Friend Accepted": "friendRequests",
    };

    const preferenceKey = preferenceMap[title];
    // Ensure the returned value is a boolean
    return preferenceKey ? !!preferences[preferenceKey] : true;
}

export function startNotificationManager() {
    // Run immediately on start
    cleanupOldNotifications();
    
    // Then run every 24 hours
    setInterval(cleanupOldNotifications, 24 * 60 * 60 * 1000);
}
  
async function cleanupOldNotifications() {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    try {
      // Delete notifications older than one month
      const oldNotificationsResult = await prisma.notifications.deleteMany({
        where: {
          timestamp: {
            lt: oneMonthAgo
          }
        }
      });

      // Get all users
      const users = await prisma.users.findMany({
        select: { username: true }
      });

      let totalExcessDeleted = 0;

      // For each user, keep only the 50 most recent notifications
      for (const user of users) {
        const excessNotifications = await prisma.notifications.findMany({
          where: { userId: user.username },
          orderBy: { timestamp: 'desc' },
          skip: 50,
          select: { id: true }
        });

        if (excessNotifications.length > 0) {
          const deleteResult = await prisma.notifications.deleteMany({
            where: {
              id: { in: excessNotifications.map(n => n.id) }
            }
          });
          totalExcessDeleted += deleteResult.count;
        }
      }

      console.log(`Deleted ${oldNotificationsResult.count} old notifications and ${totalExcessDeleted} excess notifications`);
    } catch (error) {
      console.error('Error cleaning up notifications:', error);
    }
}