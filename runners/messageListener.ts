import * as admin from 'firebase-admin';
import { sendPushNotification } from './NotificationService';
import { resolveProfileImageUrl } from '../server-routes/profileImages';

export function setupMessageListener() {
  if (!admin.apps.length) {
    console.warn("Firebase not initialized. Skipping message listener setup.");
    return;
  }

  const db = admin.database();
  const messagesRef = db.ref('conversations');

  messagesRef.on('child_changed', async (snapshot) => {
    const conversation = snapshot.val();
    const lastMessage = conversation.lastMessage;

    if (lastMessage && !lastMessage.isRead && !lastMessage.isNotified) {
      const senderUsername = lastMessage.senderId;
      const recipientUsername = conversation.participantsArray.find(
        (username: string) => username !== senderUsername
      );

      if (!recipientUsername) {
        console.error('Recipient username not found');
        return;
      }

      if (lastMessage.text) {
        const senderAvatarUrl = senderUsername
          ? await resolveProfileImageUrl(senderUsername)
          : null;

        await sendPushNotification({
          userId: recipientUsername,
          title: 'New Message',
          body: `${senderUsername || 'Someone'}: ${lastMessage.text}`,
          type: 'message',
          data: {
            type: 'message',
            conversationId: snapshot.key,
            fromUserId: senderUsername || '',

            // iOS communication notification: sender name + avatar, grouped
            // per conversation thread.
            communication: true,
            senderName: senderUsername || 'Someone',
            ...(senderAvatarUrl ? { senderAvatarUrl } : {}),
            communicationThreadId: `chat-${snapshot.key}`,
          },
        });

        // Mark the message as notified
        await db.ref(`conversations/${snapshot.key}/lastMessage`).update({ isNotified: true });
      }
    }
  });
}
