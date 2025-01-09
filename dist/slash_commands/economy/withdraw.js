"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const textLocalizer_1 = require("../../utils/textLocalizer");
const userSchema_1 = __importDefault(require("../../models/userSchema"));
const command = {
    name: "withdraw",
    description: "Withdraw TomoCoins from your bank to your wallet.",
    category: "economy",
    options: [
        {
            name: "amount",
            description: "The amount of TomoCoins you wish to withdraw",
            type: discord_js_1.ApplicationCommandOptionType.Integer,
            required: true,
        },
    ],
    callback: async (client, interaction, userData) => {
        await interaction.deferReply();
        const locale = userData.language || "en";
        const withdrawAmount = interaction.options.getInteger("amount", true);
        if (withdrawAmount <= 0) {
            const embed = new discord_js_1.EmbedBuilder()
                .setColor("#FF0000")
                .setTitle((0, textLocalizer_1.localizer)(locale, "economy.withdraw.invalid_amount_title"))
                .setDescription((0, textLocalizer_1.localizer)(locale, "economy.withdraw.invalid_amount_description"))
                .setFooter({
                text: (0, textLocalizer_1.localizer)(locale, "economy.withdraw.invalid_amount_footer"),
            });
            await interaction.editReply({ embeds: [embed] });
            return;
        }
        if (withdrawAmount > userData.bank) {
            const embed = new discord_js_1.EmbedBuilder()
                .setColor("#FF0000")
                .setTitle((0, textLocalizer_1.localizer)(locale, "economy.withdraw.insufficient_balance_title"))
                .setDescription((0, textLocalizer_1.localizer)(locale, "economy.withdraw.insufficient_balance_description", {
                bank_balance: userData.bank,
                attempted: withdrawAmount,
            }))
                .setFooter({
                text: (0, textLocalizer_1.localizer)(locale, "economy.withdraw.insufficient_balance_footer"),
            });
            await interaction.editReply({ embeds: [embed] });
            return;
        }
        // Update user's balance
        await userSchema_1.default.updateOne({ userID: interaction.user.id }, {
            $inc: {
                coins: withdrawAmount,
                bank: -withdrawAmount,
            },
        });
        // Success embed
        const embed = new discord_js_1.EmbedBuilder()
            .setColor("#00FF00")
            .setAuthor({
            name: interaction.user.username,
            iconURL: interaction.user.displayAvatarURL({ forceStatic: false }),
        })
            .setTitle((0, textLocalizer_1.localizer)(locale, "economy.withdraw.success_title"))
            .setDescription((0, textLocalizer_1.localizer)(locale, "economy.withdraw.success_description", {
            amount: withdrawAmount,
            wallet_balance: userData.coins + withdrawAmount,
            bank_balance: userData.bank - withdrawAmount,
        }))
            .setFooter({
            text: (0, textLocalizer_1.localizer)(locale, "economy.withdraw.success_footer"),
        });
        await interaction.editReply({ embeds: [embed] });
    },
};
exports.default = command;
//# sourceMappingURL=withdraw.js.map