const botModel = require("../../models/botSchema.js");
const shopModel = require("../../models/shopSchema.js");
const fs = require("fs"); // Import File System module
const path = require("path"); // Module to resolve correct file paths

module.exports = async (client, guild) => {
  try {
    const serverID = guild.id;

    // Step 1: Determine server's language
    const serverLocale = guild.preferredLocale;
    console.log(`Server ${serverID} has locale ${serverLocale}`);

    // Decide which defaults file to use based on language
    const personaFilePath = serverLocale.startsWith("ja") // Check if locale starts with "ja" for Japanese
      ? path.resolve(__dirname, "../../defaults/jaPersona.json")
      : path.resolve(__dirname, "../../defaults/enPersona.json"); // Fallback to English

    const defaultData = JSON.parse(fs.readFileSync(personaFilePath, "utf-8"));

    // Step 1: Check if the bot exists in the database for this server
    let botEntry = await botModel.findOne({ serverID });
    if (!botEntry) {
      // Initialize bot entry using data from JSON
      botEntry = await botModel.create({
        serverID: serverID,
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

    // Step 2: Check if the shop exists in the database for this server
    let shopEntry = await shopModel.findOne({ serverID });
    if (!shopEntry) {
      // Initialize shop entry
      shopEntry = await shopModel.create({
        serverID: serverID,
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
