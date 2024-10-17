import { Request, Response } from "express";
import { prisma } from "../server";
import { Prisma } from '@prisma/client';
import { verifyToken } from "../utils/jwt";
import { z } from "zod";
import { handleAsync } from "../utils/router";

export function setupNotificationApi(app: any) {
  const DeleteNotificationTokenSchema = z.object({
    token: z.string()
  })
  app.delete("/api/deleteNotificationToken", handleAsync(async (req: Request, res: Response) => {
    const { token } = await DeleteNotificationTokenSchema.parseAsync(req.body);
  
    // Verify the token
    const claims = await verifyToken(token);

    // Update the user, setting notificationToken to null or an empty string
    await prisma.users.update({
      where: { username: claims.username },
      data: { notificationToken: "" } // Using an empty string instead of null
    });

    res.status(200).json({ message: "Notification token deleted successfully" });
  }));
  
  const GetNotificationsSchema = z.object({
    token: z.string()
  })
  app.get("/api/notifications", handleAsync(async (req: Request, res: Response) => {
    const { token } = await GetNotificationsSchema.parseAsync(req.query);
  
    const claims = await verifyToken(token);

    const notifications = await prisma.notifications.findMany({
      where: { userId: claims.username },
      orderBy: { timestamp: 'desc' }
    });

    res.status(200).json({ notifications });
  }));
  
  const DeleteNotifcationSchema = z.object({
    token: z.string(),
    notificationId: z.string().uuid()
  })
  app.delete("/api/deleteNotification", handleAsync(async (req: Request, res: Response) => {
    const { token, notificationId } = await DeleteNotifcationSchema.parseAsync(req.body);
  
    const claims = await verifyToken(token);

    const deletedNotification = await prisma.notifications.deleteMany({
      where: {
        id: notificationId,
        userId: claims.username
      }
    });

    if (deletedNotification.count === 0) {
      return res.status(404).json({ message: "Notification not found" });
    }

    res.status(200).json({ message: "Notification deleted successfully" });
  }));
  
  const MarkNotificationAsReadSchema = z.object({
    token: z.string(),
    notificationId: z.string().uuid()
  })
  app.patch("/api/markNotificationAsRead", handleAsync(async (req: Request, res: Response) => {
    const { token, notificationId } = await MarkNotificationAsReadSchema.parseAsync(req.body);
  
    const claims = await verifyToken(token);

    const updatedNotification = await prisma.notifications.updateMany({
      where: {
        id: notificationId,
        userId: claims.username
      },
      data: { isRead: true }
    });

    if (updatedNotification.count === 0) {
      return res.status(404).json({ message: "Notification not found" });
    }

    res.status(200).json({ message: "Notification marked as read successfully" });
  }));

  const DeleteMessageNotificationsSchema = z.object({
    token: z.string()
  })
  app.delete("/api/deleteMessageNotifications", handleAsync(async (req: Request, res: Response) => {
    const { token } = await DeleteMessageNotificationsSchema.parseAsync(req.body)

    const claims = await verifyToken(token);

    const deletedNotifications = await prisma.notifications.deleteMany({
      where: {
        userId: claims.username,
        title: "New Message"
      }
    });

    res.status(200).json({ message: `${deletedNotifications.count} notifications deleted successfully` });
  }));

  const NotificationPreferencesSchema = z.object({
    token: z.string()
  })
  app.get("/api/notificationPreferences", async (req: Request, res: Response) => {
    const { token } = await NotificationPreferencesSchema.parseAsync(req.query);

    const claims = await verifyToken(token);

    const user = await prisma.users.findUnique({
      where: { username: claims.username },
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
  });

  const ChangeNotificationPreferencesSchema = z.object({
    token: z.string(),
    preferences: z.object({
      incomingEntities: z.boolean().optional(),
      entityDamage: z.boolean().optional(),
      entitiesInAirspace: z.boolean().optional(),
      eliminationReward: z.boolean().optional(),
      lootDrops: z.boolean().optional(),
      friendRequests: z.boolean().optional(),
      leagues: z.boolean().optional(),
    })
  })
  app.patch("/api/changeNotificationPreferences", handleAsync(async (req: Request, res: Response) => {
    const { token, preferences } = await ChangeNotificationPreferencesSchema.parseAsync(req.body);

    const claims = await verifyToken(token)

    const user = await prisma.users.findUnique({
      where: { username: claims.username },
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
  }));
}