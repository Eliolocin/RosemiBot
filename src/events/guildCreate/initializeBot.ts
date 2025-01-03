import { Client, Guild } from "discord.js";
import { Model } from "mongoose";
import fs from "fs";
import path from "path";
import { IBot, IShop } from "../../types";

// Match the working import pattern from registerProfile.ts
const botModel: Model<IBot> = require("../../models/botSchema");
const shopModel: Model<IShop> = require("../../models/shopSchema");

const handler = async (client: Client, guild: Guild): Promise<void> => {
  try {
    const serverID = guild.id;
    const serverLocale = guild.preferredLocale;
    console.log(`Server ${serverID} has locale ${serverLocale}`);

    const personaFilePath = serverLocale.startsWith("ja")
      ? path.resolve(__dirname, "../../defaults/jaPersona.json")
      : path.resolve(__dirname, "../../defaults/enPersona.json");

    const defaultData = JSON.parse(fs.readFileSync(personaFilePath, "utf-8"));

    // Initialize bot entry using the same pattern as registerProfile.ts
    let bot = await botModel.findOne({ serverID });
    if (!bot) {
      bot = await botModel.create({
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
      await bot.save();
      console.log(`Bot data initialized for server ${serverID}`);
    }

    // Initialize shop entry using the same pattern
    let shop = await shopModel.findOne({ serverID });
    if (!shop) {
      shop = await shopModel.create({
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
  } catch (error) {
    console.error("Error initializing data for server:", error);
  }
};

export default handler;
