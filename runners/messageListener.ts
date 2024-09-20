import * as admin from 'firebase-admin';
import { sendNotification } from './notificationhelper';

export function setupMessageListener() {
  const db = admin.database();
  const messagesRef = db.ref('conversations');

  messagesRef.on('child_changed', async (snapshot) => {
    const conversation = snapshot.val();
    const lastMessage = conversation.lastMessage;

    console.log('Last message:', JSON.stringify(lastMessage, null, 2));

    if (lastMessage && !lastMessage.isRead && !lastMessage.isNotified) {
      const senderUsername = lastMessage.senderId;
      const recipientUsername = conversation.participantsArray.find(
        (username: string) => username !== senderUsername
      );

      if (!recipientUsername) {
        console.error('Recipient username not found');
        return;
      }

      console.log('Sender username:', senderUsername);
      console.log('Recipient username:', recipientUsername);

      let notificationTitle = 'New Message';
      let notificationBody = '';

      if (lastMessage.text) {
        notificationBody = `${senderUsername || 'Someone'}: ${lastMessage.text}`;
      }

      if (notificationBody) {
        console.log('Sending notification:', {
          recipientUsername,
          notificationTitle,
          notificationBody,
          senderUsername
        });

        await sendNotification(
          recipientUsername,
          notificationTitle,
          notificationBody,
          senderUsername || ''
        );

        // Mark the message as notified
        await db.ref(`conversations/${snapshot.key}/lastMessage`).update({ isNotified: true });
      }
    }
  });
}