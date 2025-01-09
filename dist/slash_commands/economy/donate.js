"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const textLocalizer_1 = require("../../utils/textLocalizer");
const userSchema_1 = __importDefault(require("../../models/userSchema"));
const command = {
    name: "donate",
    description: "Donate TomoCoins to another user's bank | 他のユーザーの銀行にTomoCoinsを寄付します",
    category: "economy",
    options: [
        {
            name: "recipient",
            description: "User you want to donate to | 寄付したいユーザー",
            type: discord_js_1.ApplicationCommandOptionType.User,
            required: true,
        },
        {
            name: "amount",
            description: "Amount to be donated | 寄付する金額",
            type: discord_js_1.ApplicationCommandOptionType.Integer,
            required: true,
        },
    ],
    callback: async (client, interaction, userData) => {
        await interaction.deferReply();
        const locale = userData.language || "en";
        const recipient = interaction.options.getUser("recipient", true);
        const donationAmount = interaction.options.getInteger("amount", true);
        if (donationAmount <= 0) {
            const embed = new discord_js_1.EmbedBuilder()
                .setColor("#FF0000")
                .setTitle((0, textLocalizer_1.localizer)(locale, "economy.donate.invalid_amount_title"))
                .setDescription((0, textLocalizer_1.localizer)(locale, "economy.donate.invalid_amount_description"))
                .setFooter({
                text: (0, textLocalizer_1.localizer)(locale, "economy.donate.invalid_amount_footer"),
            });
            await interaction.editReply({ embeds: [embed] });
            return;
        }
        if (donationAmount > userData.coins) {
            const embed = new discord_js_1.EmbedBuilder()
                .setColor("#FF0000")
                .setTitle((0, textLocalizer_1.localizer)(locale, "economy.donate.insufficient_funds_title"))
                .setDescription((0, textLocalizer_1.localizer)(locale, "economy.donate.insufficient_funds_description", {
                wallet_balance: userData.coins,
                attempted: donationAmount,
            }))
                .setFooter({
                text: (0, textLocalizer_1.localizer)(locale, "economy.donate.insufficient_funds_footer"),
            });
            await interaction.editReply({ embeds: [embed] });
            return;
        }
        let recipientUser = await userSchema_1.default.findOne({
            userID: recipient.id,
            serverID: interaction.guildId,
        });
        if (!recipientUser) {
            recipientUser = await userSchema_1.default.create({
                userID: recipient.id,
                serverID: interaction.guildId,
                nickname: recipient.username,
                coins: 0,
                bank: 0,
            });
        }
        await userSchema_1.default.bulkWrite([
            {
                updateOne: {
                    filter: { userID: interaction.user.id },
                    update: { $inc: { coins: -donationAmount } },
                },
            },
            {
                updateOne: {
                    filter: { userID: recipient.id },
                    update: { $inc: { bank: donationAmount } },
                },
            },
        ]);
        const embed = new discord_js_1.EmbedBuilder()
            .setColor("#00FF00")
            .setAuthor({
            name: interaction.user.username,
            iconURL: interaction.user.displayAvatarURL({ forceStatic: false }),
        })
            .setTitle((0, textLocalizer_1.localizer)(locale, "economy.donate.success_title"))
            .setDescription((0, textLocalizer_1.localizer)(locale, "economy.donate.success_description", {
            amount: donationAmount,
            recipient: recipient.username,
            wallet_balance: userData.coins - donationAmount,
        }))
            .setFooter({ text: (0, textLocalizer_1.localizer)(locale, "economy.donate.success_footer") });
        await interaction.editReply({ embeds: [embed] });
    },
};
exports.default = command;
//# sourceMappingURL=donate.js.map