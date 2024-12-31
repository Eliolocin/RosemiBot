const mongoose = require("mongoose");

const botSchema = new mongoose.Schema({
  serverID: { type: String, require: true },
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
  settings: {
    type: [
      {
        key: { type: String, required: true }, // Setting name (e.g., "prefix", "moderation")
        value: { type: mongoose.Schema.Types.Mixed, required: true }, // Can store any data type (string, boolean, number, object, array, etc.)
        description: { type: String, required: true },
      },
    ],
    default: [], // Default to an empty array of settings
  }, // Flexible list of customizable settings for the bot
  triggers: { type: [String], default: ["tomo", "tomobot", "とも"] }, // Words that trigger the bot
  counters: { type: [Number], default: [] },
});

const model = mongoose.model("bots", botSchema);
module.exports = model;
