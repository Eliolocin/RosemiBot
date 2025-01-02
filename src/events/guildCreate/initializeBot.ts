import { Client, Guild } from "discord.js";
import { Model } from "mongoose";
import fs from "fs";
import path from "path";
import { IBot, IShop } from "../../types";

const botModel: Model<IBot> = require("../../models/botSchema");
const shopModel: Model<IShop> = require("../../models/shopSchema");

const handler = async (client: Client, guild: Guild): Promise<void> => {
  try {
    const serverID = guild.id;

    // Step 1: Determine server's language
    const serverLocale = guild.preferredLocale;
    console.log(`Server ${serverID} has locale ${serverLocale}`);

    const personaFilePath = serverLocale.startsWith("ja")
      ? path.resolve(__dirname, "../../defaults/jaPersona.json")
      : path.resolve(__dirname, "../../defaults/enPersona.json");

    const defaultData = JSON.parse(fs.readFileSync(personaFilePath, "utf-8"));

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
  } catch (error) {
    console.error(`Error initializing data for server ${guild.id}:`, error);
  }
};

export default handler;
