"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const botModel = require("../../models/botSchema");
const shopModel = require("../../models/shopSchema");
const handler = async (client, guild) => {
    try {
        const serverID = guild.id;
        // Step 1: Determine server's language
        const serverLocale = guild.preferredLocale;
        console.log(`Server ${serverID} has locale ${serverLocale}`);
        const personaFilePath = serverLocale.startsWith("ja")
            ? path_1.default.resolve(__dirname, "../../defaults/jaPersona.json")
            : path_1.default.resolve(__dirname, "../../defaults/enPersona.json");
        const defaultData = JSON.parse(fs_1.default.readFileSync(personaFilePath, "utf-8"));
        // Initialize bot entry
        let botEntry = await botModel.findOne({ serverID });
        if (!botEntry) {
            botEntry = await botModel.create({
                serverID,
                conversationExamples: defaultData.conversationExamples,
                botDatabase: defaultData.botDatabase,
                settings: [
                    {
                        key: "prefix",
                        value: "=",
                        description: "Command prefix for the bot",
                    },
                ],
            });
            console.log(`Initialized bot data for server ${serverID}`);
        }
        // Initialize shop entry
        let shopEntry = await shopModel.findOne({ serverID });
        if (!shopEntry) {
            shopEntry = await shopModel.create({
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
            console.log(`Initialized shop data for server ${serverID}`);
        }
    }
    catch (error) {
        console.error(`Error initializing data for server ${guild.id}:`, error);
    }
};
exports.default = handler;
