import { Client, ActivityType, Guild, ChannelType } from "discord.js";
import { config } from "./config";
import { commands } from "./commands";
import { TextChannel, DMChannel } from "discord.js";
import { deployCommands } from "./deploy-commands";

const client = new Client({
  intents: ["Guilds", "GuildMessages", "DirectMessages"],
});  
  

client.on('ready', async () => {
    console.log(`Logged in!`);
    if (client.user) {
        client.user.setActivity('Missiles Fly!', { type: ActivityType.Watching });
    } else {
        console.error('The client.user is not available.');
    }

    //Sends a server start messages every time
    const channelId = '1244534188816732171'; 
    const channel = client.channels.cache.get(channelId);

    // Check if channel exists and is a TextChannel or DMChannel before sending a message
    if (channel instanceof TextChannel || channel instanceof DMChannel) {
        channel.send(':white_check_mark: **Backend Server has started!**')
          .catch(console.error);
    } else {
        console.log('The channel was not found or cannot be used to send messages.');
    }

});

client.on("guildCreate", async (guild) => {
    try {
      await deployCommands({ guildId: guild.id });
      console.log(`Commands deployed successfully in guild: ${guild.id}`);
    } catch (error) {
      console.error(`Failed to deploy commands in guild: ${guild.id}`, error);
    }
  });  

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) {
    return;
  }
  const { commandName } = interaction;
  if (commands[commandName as keyof typeof commands]) {
    commands[commandName as keyof typeof commands].execute(interaction);
  }
});

client.login(config.DISCORD_TOKEN);