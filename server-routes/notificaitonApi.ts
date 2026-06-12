import { Request, Response } from "express";
import { verifyToken } from "../util/auth";
import { prisma } from "../server";
import { Prisma } from '@prisma/client';
import { sendNotification } from "../runners/notificationhelper";

export function setupNotificationApi(app: any) {

  // Push tokens are no longer stored on the shard (Phase 6 cutover): the
  // client writes its Expo token to /notificationTokens/<uid> in Firebase
  // central directly, and delivery resolves the token from there
  // (NotificationService — admin SDK on the owner deployment, coordinator
  // /relay/push everywhere else). The old /api/updateNotificationToken,
  // /api/notificationTokenStatus and /api/deleteNotificationToken endpoints
  // are gone with the Users.notificationToken column.

  // Sends a push notification to the caller so they can verify their token
  // end-to-end. "Test Notification" is not in the preference map, so it is
  // never filtered out by notification preferences. Delivery (or "no token")
  // is resolved by NotificationService against Firebase central.
  app.post("/api/testNotification", async (req: Request, res: Response) => {
    const { token } = req.body;

    try {
      const decoded = verifyToken(token) as { username: string };
      if (!decoded.username) {
        return res.status(401).json({ message: "Invalid token" });
      }

      await sendNotification(
        decoded.username,
        "Test Notification",
        "Push notifications are working! 🚀",
        "Server"
      );

      res.status(200).json({ message: "Test notification sent" });
    } catch (error) {
      console.error("Error sending test notification:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/notifications", async (req: Request, res: Response) => {
    const token = req.query.token as string;
  
    try {
      const decoded = verifyToken(token) as { username: string };
      if (!decoded.username) {
        return res.status(401).json({ message: "Invalid token" });
      }
  
      const notifications = await prisma.notifications.findMany({
        where: { userId: decoded.username },
        orderBy: { timestamp: 'desc' }
      });
  
      res.status(200).json({ notifications });
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  
  app.delete("/api/deleteNotification", async (req: Request, res: Response) => {
    const { token, notificationId } = req.body;
  
    try {
      const decoded = verifyToken(token) as { username: string };
      if (!decoded.username) {
        return res.status(401).json({ message: "Invalid token" });
      }
  
      const deletedNotification = await prisma.notifications.deleteMany({
        where: {
          id: notificationId,
          userId: decoded.username
        }
      });
  
      if (deletedNotification.count === 0) {
        return res.status(404).json({ message: "Notification not found" });
      }
  
      res.status(200).json({ message: "Notification deleted successfully" });
    } catch (error) {
      console.error("Error deleting notification:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  
  app.patch("/api/markNotificationAsRead", async (req: Request, res: Response) => {
    const { token, notificationId } = req.body;
  
    try {
      const decoded = verifyToken(token) as { username: string };
      if (!decoded.username) {
        return res.status(401).json({ message: "Invalid token" });
      }
  
      const updatedNotification = await prisma.notifications.updateMany({
        where: {
          id: notificationId,
          userId: decoded.username
        },
        data: { isRead: true }
      });
  
      if (updatedNotification.count === 0) {
        return res.status(404).json({ message: "Notification not found" });
      }
  
      res.status(200).json({ message: "Notification marked as read successfully" });
    } catch (error) {
      console.error("Error marking notification as read:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/markAllNotificationsAsRead", async (req: Request, res: Response) => {
    const { token } = req.body;

    try {
      const decoded = verifyToken(token) as { username: string };
      if (!decoded.username) {
        return res.status(401).json({ message: "Invalid token" });
      }

      const updatedNotifications = await prisma.notifications.updateMany({
        where: {
          userId: decoded.username,
          isRead: false
        },
        data: { isRead: true }
      });

      res.status(200).json({ message: `${updatedNotifications.count} notifications marked as read` });
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/deleteMessageNotifications", async (req: Request, res: Response) => {
    const { token } = req.body;
  
    try {
      const decoded = verifyToken(token) as { username: string };
      if (!decoded.username) {
        return res.status(401).json({ message: "Invalid token" });
      }
  
      const deletedNotifications = await prisma.notifications.deleteMany({
        where: {
          userId: decoded.username,
          title: "New Message"
        }
      });
  
      res.status(200).json({ message: `${deletedNotifications.count} notifications deleted successfully` });
    } catch (error) {
      console.error("Error deleting New Message notifications:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/notificationPreferences", async (req: Request, res: Response) => {
    const token = req.query.token as string;

    try {
      const decoded = verifyToken(token) as { username: string };
      if (!decoded.username) {
        return res.status(401).json({ message: "Invalid token" });
      }

      const user = await prisma.users.findUnique({
        where: { username: decoded.username },
        include: { notificationPreferences: true }
      });

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (!user.notificationPreferences) {
        // If preferences don't exist, create default preferences
        const defaultPreferences = await prisma.notificationPreferences.create({
          data: {
            userId: user.id,
            // All preferences default to true
          }
        });
        return res.status(200).json({ preferences: defaultPreferences });
      }

      res.status(200).json({ preferences: user.notificationPreferences });
    } catch (error) {
      console.error("Error fetching notification preferences:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app.patch("/api/changeNotificationPreferences", async (req: Request, res: Response) => {
    const { token, preferences } = req.body;

    try {
      const decoded = verifyToken(token) as { username: string };
      if (!decoded.username) {
        return res.status(401).json({ message: "Invalid token" });
      }

      const user = await prisma.users.findUnique({
        where: { username: decoded.username },
        include: { notificationPreferences: true }
      });

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Create a type-safe update object
      const preferencesData: Prisma.NotificationPreferencesUncheckedCreateInput = {
        userId: user.id,
        incomingEntities: preferences.incomingEntities ?? true,
        entityDamage: preferences.entityDamage ?? true,
        entitiesInAirspace: preferences.entitiesInAirspace ?? true,
        eliminationReward: preferences.eliminationReward ?? true,
        lootDrops: preferences.lootDrops ?? true,
        friendRequests: preferences.friendRequests ?? true,
        leagues: preferences.leagues ?? true,
      };

      // Update all preferences in a single operation
      const updatedPreferences = await prisma.notificationPreferences.upsert({
        where: { userId: user.id },
        update: preferencesData,
        create: preferencesData
      });

      res.status(200).json({ message: "Preferences updated successfully", preferences: updatedPreferences });
    } catch (error) {
      console.error("Error updating notification preferences:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

}
