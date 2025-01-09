"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const userSchema_1 = __importDefault(require("../../models/userSchema"));
const handler = async (client, message) => {
    if (message.author.bot)
        return;
    try {
        const serverLocale = message.guild?.preferredLocale;
        console.log(`Server language detected: ${serverLocale}`);
        const userLanguage = serverLocale?.startsWith("ja") ? "ja" : "en";
        let user = await userSchema_1.default.findOne({
            userID: message.author.id,
            serverID: message.guild?.id,
        });
        if (!user && message.guild) {
            user = await userSchema_1.default.create({
                userID: message.author.id,
                serverID: message.guild.id,
                nickname: message.author.displayName,
                language: userLanguage,
            });
            await user.save();
            console.log(`User created with language set to ${userLanguage}`);
        }
    }
    catch (err) {
        console.error("Error handling user creation:", err);
    }
};
exports.default = handler;
//# sourceMappingURL=01_updateProfile.js.map