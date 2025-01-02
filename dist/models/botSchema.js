"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = require("mongoose");
const botSchema = new mongoose_1.Schema({
    serverID: { type: String, required: true },
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
            value: { type: mongoose_1.Schema.Types.Mixed, required: true },
            description: { type: String, required: true },
        },
    ],
    triggers: {
        type: [String],
        default: ["tomo", "tomobot", "とも"],
    },
    counters: { type: [Number], default: [] },
});
const BotModel = (0, mongoose_1.model)("bots", botSchema);
exports.default = BotModel;
