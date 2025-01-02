"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const userModel = require("../../models/userSchema");
const handler = async (client, member) => {
    try {
        // Determine the server's language from preferredLocale
        const serverLocale = member.guild.preferredLocale;
        console.log(`Server language detected: ${serverLocale}`);
        // Default to "en" unless the locale indicates Japanese
        const userLanguage = serverLocale.startsWith("ja") ? "ja" : "en";
        // Check if the user exists
        let user = await userModel.findOne({ userID: member.id });
        if (!user) {
            user = await userModel.create({
                userID: member.id,
                serverID: member.guild.id,
                nickname: member.displayName,
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
