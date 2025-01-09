"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const botSchema_1 = __importDefault(require("../../models/botSchema"));
const shopSchema_1 = __importDefault(require("../../models/shopSchema"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const handler = async (client, guild) => {
    try {
        const serverID = guild.id;
        const serverLocale = guild.preferredLocale;
        console.log(`Server ${serverID} has locale ${serverLocale}`);
        const personaFilePath = serverLocale.startsWith("ja")
            ? path_1.default.resolve(__dirname, "../../defaults/jaPersona.json")
            : path_1.default.resolve(__dirname, "../../defaults/enPersona.json");
        const defaultData = JSON.parse(fs_1.default.readFileSync(personaFilePath, "utf-8"));
        // Ensure the required data exists and is an array
        const generalInfo = Array.isArray(defaultData.generalInfo) ? defaultData.generalInfo : [];
        const defaultBotDatabase = Array.isArray(defaultData.default?.botDatabase)
            ? defaultData.default.botDatabase
            : [];
        // Initialize bot entry using the same pattern as registerProfile.ts
        let bot = await botSchema_1.default.findOne({ serverID });
        if (!bot) {
            bot = await botSchema_1.default.create({
                serverID,
                conversationExamples: defaultData.default?.conversationExamples || [],
                botDatabase: [...generalInfo, ...defaultBotDatabase],
            });
            await bot.save();
            console.log(`Bot data initialized for server ${serverID}`);
        }
        // Initialize shop entry using the same pattern
        let shop = await shopSchema_1.default.findOne({ serverID });
        if (!shop) {
            shop = await shopSchema_1.default.create({
                serverID,
                shopName: "Server Shop",
                currency: "TomoCoins",
                items: [
                    {
                        itemID: "example-item-1",
                        name: "Example Item",
                        price: 100,
                        quantityAvailable: 10,
                        description: "This is a sample item.",
                        attributes: [
                            { key: "rarity", value: "common" },
                            { key: "effect", value: "none" },
                        ],
                    },
                ],
            });
            await shop.save();
            console.log(`Shop data initialized for server ${serverID}`);
        }
    }
    catch (error) {
        console.error("Error initializing data for server:", error);
    }
};
exports.default = handler;
//# sourceMappingURL=initializeBot.js.map