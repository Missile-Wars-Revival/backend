import { Request, Response } from "express";
import * as jwt from "jsonwebtoken";
import { prisma } from "../server";
import { JwtPayload } from "jsonwebtoken";
import { Prisma } from '@prisma/client';

export function setupNotificationApi(app: any) {

  app.delete("/api/deleteNotificationToken", async (req: Request, res: Response) => {
    const { token } = req.body;
  
    try {
      // Verify the token
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as { username: string };
      if (!decoded.username) {
        return res.status(401).json({ message: "Invalid token" });
      }
  
      // Update the user, setting notificationToken to null or an empty string
      await prisma.users.update({
        where: { username: decoded.username },
        data: { notificationToken: "" } // Using an empty string instead of null
      });
  
      res.status(200).json({ message: "Notification token deleted successfully" });
    } catch (error) {
      console.error("Error deleting notification token:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  
  app.get("/api/notifications", async (req: Request, res: Response) => {
    const token = req.query.token as string;
  
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as { username: string };
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
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as { username: string };
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
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as { username: string };
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

  app.delete("/api/deleteMessageNotifications", async (req: Request, res: Response) => {
    const { token } = req.body;
  
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as { username: string };
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

  interface NotificationPreferences {
    id: number;
    userId: number;
    incomingEntities: boolean;
    entityDamage: boolean;
    entitiesInAirspace: boolean;
    eliminationReward: boolean;
    lootDrops: boolean;
    friendRequests: boolean;
    leagues: boolean;
  }

  app.get("/api/notificationPreferences", async (req: Request, res: Response) => {
    const token = req.query.token as string;

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as { username: string };
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
  app.patch("/api/notificationPreferences", async (req: Request, res: Response) => {
    const { token, preferences } = req.body;

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as { username: string };
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

      let updatedPreferences;

      if (user.notificationPreferences) {
        updatedPreferences = await prisma.notificationPreferences.update({
          where: { userId: user.id },
          data: preferencesData
        });
      } else {
        updatedPreferences = await prisma.notificationPreferences.create({
          data: preferencesData
        });
      }

      res.status(200).json({ message: "Preferences updated successfully", preferences: updatedPreferences });
    } catch (error) {
      console.error("Error updating notification preferences:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

}