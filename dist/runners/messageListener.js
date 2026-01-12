"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupMessageListener = void 0;
const admin = __importStar(require("firebase-admin"));
const notificationhelper_1 = require("./notificationhelper");
function setupMessageListener() {
    if (!admin.apps.length) {
        console.warn("Firebase not initialized. Skipping message listener setup.");
        return;
    }
    const db = admin.database();
    const messagesRef = db.ref('conversations');
    messagesRef.on('child_changed', async (snapshot) => {
        const conversation = snapshot.val();
        const lastMessage = conversation.lastMessage;
        console.log('Last message:', JSON.stringify(lastMessage, null, 2));
        if (lastMessage && !lastMessage.isRead && !lastMessage.isNotified) {
            const senderUsername = lastMessage.senderId;
            const recipientUsername = conversation.participantsArray.find((username) => username !== senderUsername);
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
                await (0, notificationhelper_1.sendNotification)(recipientUsername, notificationTitle, notificationBody, senderUsername || '');
                // Mark the message as notified
                await db.ref(`conversations/${snapshot.key}/lastMessage`).update({ isNotified: true });
            }
        }
    });
}
exports.setupMessageListener = setupMessageListener;
