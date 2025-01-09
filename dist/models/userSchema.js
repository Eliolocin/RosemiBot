"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importStar(require("mongoose"));
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
// Ensure model doesn't get registered multiple times
const UserModel = mongoose_1.default.models.users || (0, mongoose_1.model)("users", userSchema);
exports.default = UserModel;
//# sourceMappingURL=userSchema.js.map