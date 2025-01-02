"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const textLocalizer_1 = require("../../utils/textLocalizer");
const command = {
    name: "balance",
    description: "Check your current balance!",
    category: "economy",
    callback: async (client, interaction, userData) => {
        await interaction.deferReply();
        const locale = userData.language || "en";
        const title = (0, textLocalizer_1.localizer)(locale, "economy.balance.title");
        const description = (0, textLocalizer_1.localizer)(locale, "economy.balance.description", {
            coins: userData.coins,
            bank: userData.bank,
        });
        const footer = (0, textLocalizer_1.localizer)(locale, "economy.balance.footer");
        const embed = new discord_js_1.EmbedBuilder()
            .setColor("#FFFFFF")
            .setAuthor({
            name: interaction.user.username,
            iconURL: interaction.user.displayAvatarURL({ forceStatic: false }),
        })
            .setTitle(title)
            .setDescription(description)
            .setFooter({ text: footer });
        await interaction.editReply({ embeds: [embed] });
    },
};
exports.default = command;
