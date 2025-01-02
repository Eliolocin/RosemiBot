"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = require("mongoose");
// Define the schema for the user
const userSchema = new mongoose_1.Schema({
    userID: { type: String, required: true, unique: true },
    serverID: { type: String, required: true },
    nickname: { type: String, required: true },
    level: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    coins: { type: Number, default: 1000 },
    bank: { type: Number, default: 0 },
    inventory: [
        {
            itemID: { type: String, required: true },
            name: { type: String, required: true },
            quantity: { type: Number, required: true },
            description: { type: String },
        },
    ],
    language: { type: String, default: "en" },
    conversationExamples: [
        {
            input: { type: String, required: true },
            output: { type: String, required: true },
        },
    ],
    botDatabase: { type: [String], default: [] },
    isPersonalized: { type: Boolean, default: false },
    cooldowns: { type: Map, of: mongoose_1.Schema.Types.Mixed, default: {} },
    counters: { type: [Number], default: [] },
});
// Create and export the model
const UserModel = (0, mongoose_1.model)("users", userSchema);
exports.default = UserModel;
