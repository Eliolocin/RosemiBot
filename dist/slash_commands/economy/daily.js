"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const textLocalizer_1 = require("../../utils/textLocalizer");
const userSchema_1 = __importDefault(require("../../models/userSchema"));
const command = {
    name: "daily",
    description: "Claim your daily TomoCoins!",
    category: "economy",
    callback: async (client, interaction, userData) => {
        await interaction.deferReply();
        const locale = userData.language || "en";
        const now = Date.now();
        const cooldownKey = "daily";
        const dailyCooldownDuration = 12 * 60 * 60 * 1000;
        const userCooldowns = userData.cooldowns || new Map();
        if (userCooldowns.has(cooldownKey) &&
            userCooldowns.get(cooldownKey) > now) {
            const remaining = Math.ceil((userCooldowns.get(cooldownKey) - now) / (60 * 60 * 1000));
            const replyOptions = {
                content: `⏳ You've already claimed your daily reward. Please come back in ${remaining} hours.`,
                ephemeral: true,
            };
            await interaction.editReply(replyOptions);
            return;
        }
        const randomNumber = Math.floor(Math.random() * (300 - 100 + 1)) + 100;
        await userSchema_1.default.updateOne({ userID: interaction.user.id }, {
            $inc: { coins: randomNumber },
            $set: { [`cooldowns.${cooldownKey}`]: now + dailyCooldownDuration },
        });
        const embed = new discord_js_1.EmbedBuilder()
            .setColor("#FFFFFF")
            .setAuthor({
            name: interaction.user.username,
            iconURL: interaction.user.displayAvatarURL({ forceStatic: false }),
        })
            .setTitle((0, textLocalizer_1.localizer)(locale, "economy.daily.title"))
            .setDescription((0, textLocalizer_1.localizer)(locale, "economy.daily.claim_success", {
            claimed: randomNumber,
            new_balance: userData.coins + randomNumber,
        }))
            .setFooter({
            text: (0, textLocalizer_1.localizer)(locale, randomNumber >= 200
                ? "economy.daily.footer_lucky"
                : "economy.daily.footer"),
        });
        await interaction.editReply({ embeds: [embed] });
    },
};
exports.default = command;
