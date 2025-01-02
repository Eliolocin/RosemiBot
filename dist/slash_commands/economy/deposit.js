"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const textLocalizer_1 = require("../../utils/textLocalizer");
const userSchema_1 = __importDefault(require("../../models/userSchema"));
const command = {
    name: "deposit",
    description: "Deposit your TomoCoins into your bank.",
    category: "economy",
    options: [
        {
            name: "amount",
            description: "The amount of TomoCoins you wish to deposit",
            type: discord_js_1.ApplicationCommandOptionType.Integer,
            required: true,
        },
    ],
    callback: async (client, interaction, userData) => {
        await interaction.deferReply();
        const locale = userData.language || "en";
        const depositAmount = interaction.options.getInteger("amount", true);
        if (depositAmount <= 0) {
            const embed = new discord_js_1.EmbedBuilder()
                .setColor("#FF0000")
                .setTitle((0, textLocalizer_1.localizer)(locale, "economy.deposit.invalid_amount_title"))
                .setDescription((0, textLocalizer_1.localizer)(locale, "economy.deposit.invalid_amount_description"))
                .setFooter({
                text: (0, textLocalizer_1.localizer)(locale, "economy.deposit.invalid_amount_footer"),
            });
            await interaction.editReply({ embeds: [embed] });
            return;
        }
        if (depositAmount > userData.coins) {
            const embed = new discord_js_1.EmbedBuilder()
                .setColor("#FF0000")
                .setTitle((0, textLocalizer_1.localizer)(locale, "economy.deposit.insufficient_funds_title"))
                .setDescription((0, textLocalizer_1.localizer)(locale, "economy.deposit.insufficient_funds_description", {
                wallet_balance: userData.coins,
                attempted: depositAmount,
            }))
                .setFooter({
                text: (0, textLocalizer_1.localizer)(locale, "economy.deposit.insufficient_funds_footer"),
            });
            await interaction.editReply({ embeds: [embed] });
            return;
        }
        await userSchema_1.default.updateOne({ userID: interaction.user.id }, {
            $inc: {
                coins: -depositAmount,
                bank: depositAmount,
            },
        });
        const embed = new discord_js_1.EmbedBuilder()
            .setColor("#00FF00")
            .setAuthor({
            name: interaction.user.username,
            iconURL: interaction.user.displayAvatarURL({ forceStatic: false }),
        })
            .setTitle((0, textLocalizer_1.localizer)(locale, "economy.deposit.success_title"))
            .setDescription((0, textLocalizer_1.localizer)(locale, "economy.deposit.success_description", {
            amount: depositAmount,
            wallet_balance: userData.coins - depositAmount,
            bank_balance: userData.bank + depositAmount,
        }))
            .setFooter({ text: (0, textLocalizer_1.localizer)(locale, "economy.deposit.success_footer") });
        await interaction.editReply({ embeds: [embed] });
    },
};
exports.default = command;
