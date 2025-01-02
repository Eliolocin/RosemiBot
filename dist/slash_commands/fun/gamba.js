"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const textLocalizer_1 = require("../../utils/textLocalizer");
const userSchema_1 = __importDefault(require("../../models/userSchema"));
const command = {
    name: "gamba",
    description: "Gamble your TomoCoins with a 50/50 chance to double or lose it all!",
    category: "economy",
    options: [
        {
            name: "amount",
            description: "The number of TomoCoins you wish to gamble",
            type: discord_js_1.ApplicationCommandOptionType.Integer,
            required: true,
        },
    ],
    callback: async (client, interaction, userData) => {
        await interaction.deferReply();
        const locale = userData.language || "en";
        const gambleAmount = interaction.options.getInteger("amount", true);
        if (gambleAmount > userData.coins) {
            const embed = new discord_js_1.EmbedBuilder()
                .setColor("#FF0000")
                .setTitle((0, textLocalizer_1.localizer)(locale, "economy.gamba.insufficient_funds_title"))
                .setDescription((0, textLocalizer_1.localizer)(locale, "economy.gamba.insufficient_funds_description", {
                balance: userData.coins,
                attempted: gambleAmount,
            }))
                .setFooter({
                text: (0, textLocalizer_1.localizer)(locale, "economy.gamba.insufficient_funds_footer"),
            });
            await interaction.editReply({ embeds: [embed] });
            return;
        }
        const isWin = Math.random() < 0.5;
        const winnings = isWin ? gambleAmount * 2 : 0;
        const finalAmount = isWin ? winnings - gambleAmount : -gambleAmount;
        await userSchema_1.default.updateOne({ userID: interaction.user.id }, { $inc: { coins: finalAmount } });
        const embed = new discord_js_1.EmbedBuilder()
            .setColor(isWin ? "#00FF00" : "#FF0000")
            .setAuthor({
            name: interaction.user.username,
            iconURL: interaction.user.displayAvatarURL({ forceStatic: false }),
        })
            .setTitle((0, textLocalizer_1.localizer)(locale, isWin ? "economy.gamba.win_title" : "economy.gamba.lose_title"))
            .setDescription((0, textLocalizer_1.localizer)(locale, isWin
            ? "economy.gamba.win_description"
            : "economy.gamba.lose_description", {
            winnings: isWin ? winnings : "",
            amount_lost: !isWin ? gambleAmount : "",
            new_balance: userData.coins + finalAmount,
        }))
            .setFooter({
            text: (0, textLocalizer_1.localizer)(locale, isWin ? "economy.gamba.win_footer" : "economy.gamba.lose_footer"),
        });
        await interaction.editReply({ embeds: [embed] });
    },
};
exports.default = command;
