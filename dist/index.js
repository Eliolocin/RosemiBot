"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
const discord_js_1 = require("discord.js");
const mongoose_1 = __importDefault(require("mongoose"));
const eventHandler_1 = __importDefault(require("./handlers/eventHandler"));
(0, dotenv_1.config)();
const client = new discord_js_1.Client({
    intents: [
        // Intents required by the Discord Bot
        discord_js_1.GatewayIntentBits.Guilds,
        discord_js_1.GatewayIntentBits.GuildMembers,
        discord_js_1.GatewayIntentBits.GuildMessages,
        discord_js_1.GatewayIntentBits.GuildPresences,
        discord_js_1.GatewayIntentBits.MessageContent,
        discord_js_1.GatewayIntentBits.GuildVoiceStates,
        discord_js_1.GatewayIntentBits.DirectMessages,
        discord_js_1.GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [discord_js_1.Partials.Channel, discord_js_1.Partials.Message],
});
// First register event han// Activate Command Handler
(0, eventHandler_1.default)(client);
// Connect to MongoDB
const mongoUri = process.env.MONGODB_SRV;
if (!mongoUri) {
    throw new Error("MongoDB connection string is not defined in environment variables");
}
mongoose_1.default
    .connect(mongoUri)
    .then(() => {
    console.log("Connected to MongoDB!");
})
    .catch((err) => {
    console.error("MongoDB connection error:", err);
});
// Login Bot using Discord Token
client.login(process.env.DISCORD_TOKEN);
//# sourceMappingURL=index.js.map