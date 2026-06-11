import Expo, { ExpoPushMessage } from "expo-server-sdk";
import { prisma } from "../server";

// Local TypeScript interface matching the Prisma NotificationPreferences model
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

export type NotificationType =
  | "incoming_entity"
  | "entity_damage"
  | "airspace_alert"
  | "elimination_reward"
  | "loot_drop"
  | "friend_request"
  | "league"
  | "message"
  | "system"
  | "test";

// Canonical send shape. `userId` is the recipient's username (usernames are
// the identity across this codebase).
//
// iOS communication notifications (sender PFP) are driven by `data`:
//   data.communication: true, data.senderName, data.senderAvatarUrl,
//   data.communicationThreadId — read by the notification-service extension.
// The large/rich notification image goes in `richContent.image` (handled by
// the Expo push service), NOT in data.
export interface NotificationPayload {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  type: NotificationType;
  richContent?: {
    image?: string;
  };
  silent?: boolean;
  skipStorage?: boolean;
}

const expo = new Expo();

// Which user preference gates each notification type. Unmapped types
// (message/system/test) always send.
const TYPE_PREFERENCE_MAP: Partial<Record<NotificationType, keyof NotificationPreferences>> = {
  incoming_entity: "incomingEntities",
  entity_damage: "entityDamage",
  airspace_alert: "entitiesInAirspace",
  elimination_reward: "eliminationReward",
  loot_drop: "lootDrops",
  friend_request: "friendRequests",
  league: "leagues",
};

function allowedByPreferences(
  type: NotificationType,
  preferences: NotificationPreferences | null,
): boolean {
  if (!preferences) return true;
  const key = TYPE_PREFERENCE_MAP[type];
  return key ? !!preferences[key] : true;
}

export async function sendPushNotification(payload: NotificationPayload): Promise<void> {
  const { userId, title, body, type, data, richContent, silent, skipStorage } = payload;

  const user = await prisma.users.findUnique({
    where: { username: userId },
    include: { notificationPreferences: true },
  });

  if (!user) {
    console.log(`No user found for username: ${userId}`);
    return;
  }

  if (!allowedByPreferences(type, user.notificationPreferences)) {
    console.log(`Notification (${type}) not sent to ${userId} due to preferences.`);
    return;
  }

  // Persist to the in-app notification inbox unless told otherwise. Silent
  // (data-only) pushes never appear in the inbox.
  if (!skipStorage && !silent) {
    await prisma.notifications.create({
      data: {
        userId,
        title,
        body,
        sentby: typeof data?.fromUserId === "string" ? data.fromUserId : "Server",
      },
    });
  }

  if (!user.notificationToken) {
    console.log(`No notification token for username: ${userId}`);
    return;
  }

  if (!Expo.isExpoPushToken(user.notificationToken)) {
    console.error(`Push token ${user.notificationToken} is not a valid Expo push token`);
    await clearNotificationToken(userId);
    return;
  }

  // The iOS notification-service extension only runs when mutable-content is
  // set; it is required for both the communication (PFP) treatment and the
  // legacy rich-image fallback.
  const needsMutation = !!data?.communication || !!richContent?.image;

  const message: ExpoPushMessage = {
    to: user.notificationToken,
    channelId: "default",
    ...(silent
      ? { _contentAvailable: true }
      : { title, body, sound: "default" as const }),
    data: { type, ...data },
    ...(richContent ? { richContent } : {}),
    ...(needsMutation ? { mutableContent: true } : {}),
  };

  try {
    const tickets = await expo.sendPushNotificationsAsync([message]);
    for (const ticket of tickets) {
      if (ticket.status === "error") {
        console.error(
          `Expo push error for ${userId}: ${ticket.message}`,
          ticket.details,
        );
        // The token is dead (app uninstalled / token rotated) — drop it so
        // the client's next registerAndSyncPushToken() repairs it.
        if (ticket.details?.error === "DeviceNotRegistered") {
          await clearNotificationToken(userId);
        }
      }
    }
  } catch (error) {
    console.error("Error sending notification:", error);
  }
}

async function clearNotificationToken(username: string): Promise<void> {
  try {
    await prisma.users.update({
      where: { username },
      data: { notificationToken: "" },
    });
  } catch (error) {
    console.error(`Failed to clear notification token for ${username}:`, error);
  }
}
