import Expo from "expo-server-sdk";
import { prisma } from "./server";
import { v4 as uuidv4 } from 'uuid';

const expo = new Expo();

export async function sendNotification(username: string, title: string, body: string, sentby: string) {
    const user = await prisma.users.findUnique({
      where: { username },
    });
  
    if (!user || !user.notificationToken) {
      console.log(`No user found or no notification token for username: ${username}`);
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
    } catch (error) {
      console.error('Error sending notification:', error);
    }
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
      const result = await prisma.notifications.deleteMany({
        where: {
          timestamp: {
            lt: oneMonthAgo
          }
        }
      });
      console.log(`Deleted ${result.count} old notifications`);
    } catch (error) {
      console.error('Error cleaning up old notifications:', error);
    }
  }