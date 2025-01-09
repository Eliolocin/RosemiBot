"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const textLocalizer_1 = require("../../utils/textLocalizer");
const command = {
    name: "ping",
    description: "Check the bot's ping",
    category: "tool",
    permissionsRequired: [
        new discord_js_1.PermissionsBitField(discord_js_1.PermissionsBitField.Flags.KickMembers),
    ],
    callback: async (client, interaction, userData) => {
        const locale = userData.language || "en";
        await interaction.deferReply();
        const reply = await interaction.fetchReply();
        const responseTime = reply.createdTimestamp - interaction.createdTimestamp;
        const discordPing = client.ws.ping;
        const isLaggy = responseTime > 250;
        const responseEmbed = new discord_js_1.EmbedBuilder()
            .setColor(isLaggy ? "#E74C3C" : "#2ECC71")
            .setTitle((0, textLocalizer_1.localizer)(locale, "tool.ping.description"))
            .setDescription(isLaggy
            ? (0, textLocalizer_1.localizer)(locale, "tool.ping.response_slow", {
                response_time: responseTime,
                discord_response: discordPing,
            })
            : (0, textLocalizer_1.localizer)(locale, "tool.ping.response_fast", {
                response_time: responseTime,
                discord_response: discordPing,
            }));
        await interaction.editReply({ embeds: [responseEmbed] });
    },
};
exports.default = command;
//# sourceMappingURL=ping.js.map