import { sample } from 'lodash';

// Define a type for AI bots
export interface AIBot {
  username: string;
  latitude: number;
  longitude: number;
  isOnline: boolean;
  lastUpdate: Date;
}

// Global array to store AI bots
export let aiBots: AIBot[] = [];

// Function to generate a random username
function generateRandomUsername(): string {
  const adjectives = ['Happy', 'Sleepy', 'Grumpy', 'Dopey', 'Bashful', 'Sneezy', 'Doc'];
  const nouns = ['Dwarf', 'Elf', 'Hobbit', 'Wizard', 'Ranger', 'Knight', 'Archer'];
  return `${sample(adjectives)}${sample(nouns)}${Math.floor(Math.random() * 1000)}`;
}

// Function to create and manage AI bots
export function manageAIBots() {
  const maxBots = 50; // Adjust this number as needed
  const updateInterval = 60000; // Update every minute

  // Create initial bots if needed
  while (aiBots.length < maxBots) {
    aiBots.push({
      username: generateRandomUsername(),
      latitude: Math.random() * 180 - 90,
      longitude: Math.random() * 360 - 180,
      isOnline: Math.random() > 0.3, // 70% chance of being online
      lastUpdate: new Date()
    });
  }

  // Update bot positions and online status
  setInterval(() => {
    aiBots = aiBots.map(bot => {
      if (Math.random() > 0.9) { // 10% chance of changing online status
        bot.isOnline = !bot.isOnline;
      }

      if (bot.isOnline) {
        // Move the bot slightly
        bot.latitude += (Math.random() - 0.5) * 0.1;
        bot.longitude += (Math.random() - 0.5) * 0.1;
        bot.latitude = Math.max(-90, Math.min(90, bot.latitude));
        bot.longitude = Math.max(-180, Math.min(180, bot.longitude));
      }

      bot.lastUpdate = new Date();
      return bot;
    });
  }, updateInterval);
}