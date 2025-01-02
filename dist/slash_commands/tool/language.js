"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const textLocalizer_1 = require("../../utils/textLocalizer");
const userSchema_1 = __importDefault(require("../../models/userSchema"));
const command = {
    name: "language",
    description: "Change your preferred language | 言語を変更します",
    category: "tool",
    options: [
        {
            name: "language",
            description: "Choose your language (en or ja).",
            type: discord_js_1.ApplicationCommandOptionType.String,
            required: true,
            choices: [
                { name: "English", value: "en" },
                { name: "日本語 (Japanese)", value: "ja" },
            ],
        },
    ],
    callback: async (client, interaction, userData) => {
        const selectedLanguage = interaction.options.getString("language", true);
        const currentLocale = userData.language || "en";
        try {
            await userSchema_1.default.updateOne({ userID: interaction.user.id }, { $set: { language: selectedLanguage } }, { upsert: true });
            const languageDisplay = selectedLanguage === "en" ? "English" : "日本語";
            const embed = new discord_js_1.EmbedBuilder()
                .setColor("#2ECC71")
                .setTitle((0, textLocalizer_1.localizer)(selectedLanguage, "tool.language.success_title"))
                .setDescription((0, textLocalizer_1.localizer)(selectedLanguage, "tool.language.success_description", {
                language: languageDisplay,
            }));
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
        catch (err) {
            console.error("Error in language command:", err);
            const embed = new discord_js_1.EmbedBuilder()
                .setColor("#E74C3C")
                .setTitle((0, textLocalizer_1.localizer)(currentLocale, "tool.language.error_title"))
                .setDescription((0, textLocalizer_1.localizer)(currentLocale, "tool.language.error_description"));
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
    },
};
exports.default = command;
