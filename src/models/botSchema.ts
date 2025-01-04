import mongoose, { model, Schema } from "mongoose";
import { IBot } from "../types";

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
  settings: [
    {
      key: { type: String, required: true },
      value: { type: Schema.Types.Mixed, required: true },
      description: { type: String, required: true },
    },
  ],
  triggers: {
    type: [String],
    default: ["tomo", "tomobot", "とも"],
  },
  counters: { type: [Number], default: [] },
});

// Ensure model doesn't get registered multiple times
const BotModel = mongoose.models.bots || model<IBot>("bots", botSchema);
export default BotModel;
