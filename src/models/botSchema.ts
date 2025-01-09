import mongoose, { model, Schema } from "mongoose";
import { IBot } from "../types/global";

const botSchema = new Schema<IBot>({
  serverID: { type: String, required: true, unique: true },
  botName: { type: String, required: true, default: "TomoBot" },
  conversationExamples: [
    {
      input: { type: String, required: true },
      output: { type: String, required: true },
    },
  ],
  botDatabase: { type: [String], default: [] },
  settings: {
    type: [
      {
        key: { type: String, required: true },
        value: { type: Schema.Types.Mixed, required: true },
        description: { type: String, required: true },
      },
    ],
    default: [
      { key: "prefix", value: "=", description: "Command prefix for the bot" },
      { key: "automsg", value: "50", description: "Number of messages before auto-response" },
      { key: "teachperms", value: "chmanager", description: "Who can use teaching commands" },
      { key: "inputsanitizer", value: "true", description: "Sanitize input in chat responses" },
    ],
  },
  triggers: {
    type: [String],
    default: ["tomo", "tomobot", "とも", "トモ"],
  },
  counters: { type: [Number], default: [] },
});

// Ensure model doesn't get registered multiple times
const BotModel = mongoose.models.bots || model<IBot>("bots", botSchema);
export default BotModel;
