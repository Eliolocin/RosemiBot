const { EmbedBuilder, PermissionsBitField } = require("discord.js");
const { localizer } = require("../../utils/textLocalizer");

module.exports = {
  name: "ping",
  description: "Pong! | ポン！",
  permissionsRequired: [PermissionsBitField.Flags.KickMembers],

  callback: async (client, interaction, userData) => {
    const locale = userData.language || "en";
    await interaction.deferReply();

    const reply = await interaction.fetchReply();
    const responseTime = reply.createdTimestamp - interaction.createdTimestamp;
    const discordPing = client.ws.ping;

    const isLaggy = responseTime > 250;
    const responseEmbed = new EmbedBuilder()
      .setColor(isLaggy ? "#E74C3C" : "#2ECC71")
      .setTitle(localizer(locale, "tool.ping.description"))
      .setDescription(
        isLaggy
          ? localizer(locale, "tool.ping.response_slow", {
              response_time: responseTime,
              discord_response: discordPing,
            })
          : localizer(locale, "tool.ping.response_fast", {
              response_time: responseTime,
              discord_response: discordPing,
            })
      );

    await interaction.editReply({ embeds: [responseEmbed] });
  },
};
