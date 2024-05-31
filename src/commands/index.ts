import { Client } from "discord.js";
import * as ping from "./ping";

// Assuming `client` is defined elsewhere, ensure it's imported or accessible
export const client = new Client({
    intents: ["Guilds", "GuildMembers", "DirectMessages"]
});

export const commands = {
  ping,
};

