import { config } from "dotenv";
import {
  Client,
  IntentsBitField,
  Partials,
  GatewayIntentBits,
} from "discord.js";
import mongoose from "mongoose";
import eventHandler from "./handlers/eventHandler";

config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// Activate Command Handler
eventHandler(client);

// Connect to MongoDB
const mongoUri = process.env.MONGODB_SRV;
if (!mongoUri) {
  throw new Error(
    "MongoDB connection string is not defined in environment variables"
  );
}
mongoose
  .connect(mongoUri)
  .then(() => {
    console.log("Connected to MongoDB!");
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
  });

// Login Bot using Discord Token
client.login(process.env.DISCORD_TOKEN);
