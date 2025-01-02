"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const userModel = require("../../models/userSchema");
const handler = async (client, message) => {
    if (message.author.bot)
        return;
    try {
        const serverLocale = message.guild?.preferredLocale;
        console.log(`Server language detected: ${serverLocale}`);
        const userLanguage = serverLocale?.startsWith("ja") ? "ja" : "en";
        let user = await userModel.findOne({ userID: message.author.id });
        if (!user && message.guild) {
            user = await userModel.create({
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
