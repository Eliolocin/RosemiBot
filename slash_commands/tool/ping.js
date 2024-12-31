const { EmbedBuilder, PermissionsBitField } = require("discord.js");
const { getTranslation } = require("../../utils/textLocalizer");

module.exports = {
  name: "ping",
  description: "Pong!",
  permissionsRequired: [PermissionsBitField.Flags.KickMembers],

  callback: async (client, interaction, profileData) => {
    const locale = profileData.language || "en";
    await interaction.deferReply();

    const reply = await interaction.fetchReply();
    const responseTime = reply.createdTimestamp - interaction.createdTimestamp;
    const discordPing = client.ws.ping;

    const isLaggy = responseTime > 250;
    const responseEmbed = new EmbedBuilder()
      .setColor(isLaggy ? "#E74C3C" : "#2ECC71")
      .setTitle(getTranslation(locale, "tool.ping.description"))
      .setDescription(
        isLaggy
          ? getTranslation(locale, "tool.ping.response_slow", {
              response_time: responseTime,
              discord_response: discordPing,
            })
          : getTranslation(locale, "tool.ping.response_fast", {
              response_time: responseTime,
              discord_response: discordPing,
            }),
      )
      .setFooter({
        text: isLaggy ? "Hang in there! ~_~" : "Lightning fast! ⚡",
      });

    await interaction.editReply({ embeds: [responseEmbed] });
  },
};
