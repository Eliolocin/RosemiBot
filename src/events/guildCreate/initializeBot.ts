import { Client, Guild } from "discord.js";
import BotModel from "../../models/botSchema";
import ShopModel from "../../models/shopSchema";
import fs from "fs";
import path from "path";
import { IBot, IShop } from "../../types";

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
    let bot = await BotModel.findOne({ serverID });
    if (!bot) {
      bot = await BotModel.create({
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
    let shop = await ShopModel.findOne({ serverID });
    if (!shop) {
      shop = await ShopModel.create({
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
