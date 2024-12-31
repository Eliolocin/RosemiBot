const mongoose = require("mongoose");

const profileSchema = new mongoose.Schema({
  userID: { type: String, require: true, unique: true },
  serverID: { type: String, require: true },
  level: { type: Number, default: 1 },
  xp: { type: Number, default: 0 },
  coins: { type: Number, default: 1000 },
  bank: { type: Number, default: 0 },
  inventory: {
    type: [
      {
        itemID: { type: String, required: true }, // Unique identifier for the item
        name: { type: String, required: true }, // Name of the item
        quantity: { type: Number, default: 1 }, // Quantity of the item
        description: { type: String }, // (Optional) Item description
      },
    ],
    default: [], // Default is an empty array
  },
  language: { type: String, default: "en" },
  conversationExamples: {
    type: [
      {
        input: { type: String, required: true }, // User's message
        output: { type: String, required: true }, // Bot's corresponding response
      },
    ],
    default: [], // Default is an empty array
  },
  botDatabase: { type: [String], default: [] },
  isPersonalized: { type: Boolean, default: false }, // If True, Bot K-Shot prompting excludes server's
  cooldowns: { type: Object, default: {} },
  counters: { type: [Number], default: [] },
});

const model = mongoose.model("profiles", profileSchema);
module.exports = model;
