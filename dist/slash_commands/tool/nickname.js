"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const textLocalizer_1 = require("../../utils/textLocalizer");
const userSchema_1 = __importDefault(require("../../models/userSchema"));
const command = {
    name: "nickname",
    description: "Set your nickname in the database | データベース内のニックネームを設定します",
    category: "tool",
    options: [
        {
            name: "nickname",
            description: "Your new nickname",
            type: discord_js_1.ApplicationCommandOptionType.String,
            required: true,
        },
    ],
    callback: async (client, interaction, userData) => {
        const newNickname = interaction.options.getString("nickname", true);
        const locale = userData.language || "en";
        try {
            await userSchema_1.default.updateOne({ userID: interaction.user.id }, { $set: { nickname: newNickname } }, { upsert: true });
            const embed = new discord_js_1.EmbedBuilder()
                .setColor("#2ECC71")
                .setTitle((0, textLocalizer_1.localizer)(locale, "tool.nickname.success_title"))
                .setDescription((0, textLocalizer_1.localizer)(locale, "tool.nickname.success_description", {
                nickname: newNickname,
            }));
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
        catch (err) {
            console.error("Error in nickname command:", err);
            const embed = new discord_js_1.EmbedBuilder()
                .setColor("#E74C3C")
                .setTitle((0, textLocalizer_1.localizer)(locale, "tool.nickname.error_title"))
                .setDescription((0, textLocalizer_1.localizer)(locale, "tool.nickname.error_description"));
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
    },
};
exports.default = command;
