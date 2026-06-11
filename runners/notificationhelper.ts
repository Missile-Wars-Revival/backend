import { prisma } from "../server";
import { NotificationType, sendPushNotification } from "./NotificationService";

// Maps legacy notification titles to canonical types so preference filtering
// in NotificationService keeps working for callers of sendNotification().
// Unmapped titles become "system", which is never filtered out.
const TITLE_TYPE_MAP: { [title: string]: NotificationType } = {
    "Missile Alert!": "incoming_entity",
    "Incoming Missile!": "incoming_entity",
    "Missile Impact Alert!": "incoming_entity",
    "Missile Damage!": "entity_damage",
    "Damage!": "entity_damage",
    "Damaged!": "entity_damage",
    "Loot Nearby!": "loot_drop",
    "Loot Collected!": "loot_drop",
    "Shield Destroyed": "entity_damage",
    "Shield Destroyed!": "entity_damage",
    "Airspace Alert!": "airspace_alert",
    "Grace Period Activated": "entity_damage",
    "Eliminated!": "entity_damage",
    "League Promotion!": "league",
    "League Change": "league",
    "Landmine Nearby!": "airspace_alert",
    "Landmine Damage!": "entity_damage",
    "Friend Request": "friend_request",
    "Friend Accepted": "friend_request",
    "New Message": "message",
    "Test Notification": "test",
};

export function notificationTypeForTitle(title: string): NotificationType {
    return TITLE_TYPE_MAP[title] ?? "system";
}

// Legacy wrapper around sendPushNotification — most game loops still send
// title/body pairs. New code should call sendPushNotification directly.
export async function sendNotification(username: string, title: string, body: string, sentby: string) {
    await sendPushNotification({
        userId: username,
        title,
        body,
        type: notificationTypeForTitle(title),
        data: { fromUserId: sentby },
    });
}

export function startNotificationManager() {
    // Run immediately on start
    cleanupOldNotifications();
    
    // Then run every 24 hours
    setInterval(cleanupOldNotifications, 24 * 60 * 60 * 1000);
}
  
// Friend-request notifications double as the pending-request inbox (accepting
// or declining deletes them), so any that remain are still pending and must
// survive cleanup.
const PENDING_FRIEND_REQUEST_TITLE = "Friend Request";

async function cleanupOldNotifications() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    try {
      // Delete notifications older than 30 days, keeping pending friend requests
      const oldNotificationsResult = await prisma.notifications.deleteMany({
        where: {
          timestamp: {
            lt: thirtyDaysAgo
          },
          title: {
            not: PENDING_FRIEND_REQUEST_TITLE
          }
        }
      });

      // Get all users
      const users = await prisma.users.findMany({
        select: { username: true }
      });

      let totalExcessDeleted = 0;

      // For each user, keep only the 50 most recent notifications
      // (pending friend requests are exempt from the cap too)
      for (const user of users) {
        const excessNotifications = await prisma.notifications.findMany({
          where: {
            userId: user.username,
            title: { not: PENDING_FRIEND_REQUEST_TITLE }
          },
          orderBy: { timestamp: 'desc' },
          skip: 50,
          select: { id: true }
        });

        if (excessNotifications.length > 0) {
          const deleteResult = await prisma.notifications.deleteMany({
            where: {
              id: { in: excessNotifications.map((n: { id: any; }) => n.id) }
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
