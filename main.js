require("dotenv").config();

// Discord Bot Initialization
const Discord = require("discord.js");
const mongoose = require("mongoose");
const { Client, IntentsBitField } = require("discord.js");
const client = new Client({
  intents: [
    // Set of permissions the bot needs
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.GuildPresences,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.GuildVoiceStates,
    IntentsBitField.Flags.DirectMessages,
    IntentsBitField.Flags.GuildMessageReactions,
  ],
  partials: [Discord.Partials.Channel, Discord.Partials.Message],
});

// Activate Command Handler
const eventHandler = require("./handlers/eventHandler");
eventHandler(client);

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_SRV, {})
  .then(() => {
    console.log("Connected to MongoDB!");
  })
  .catch((err) => {
    console.log(err);
  });

// Login Bot using Discord Token
client.login(process.env.DISCORD_TOKEN);
