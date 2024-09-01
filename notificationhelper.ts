const expo = new Expo();
import Expo from "expo-server-sdk";
import { prisma } from "./server";

export async function sendNotification(username: string, title: string, body: string) {
    const user = await prisma.users.findUnique({
      where: { username },
    });
  
    if (!user || !user.notificationToken) return;
  
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
      await expo.sendPushNotificationsAsync([{
        to: message.to,
        sound: "default",
        title: message.title,
        body: message.body,
        data: message.data,
      }]);
      
      // Store the notification in the user's notifications array
      await prisma.users.update({
        where: { username },
        data: {
          notifications: {
            push: JSON.stringify({ title, body, timestamp: new Date() })
          }
        }
      });
    } catch (error) {
      console.error('Error sending notification:', error);
    }
  }