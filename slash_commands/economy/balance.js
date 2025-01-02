const { EmbedBuilder } = require("discord.js");
const { localizer } = require("../../utils/textLocalizer");

module.exports = {
  name: "balance",
  description: "Check your current balance!",

  callback: async (client, interaction, userData) => {
    await interaction.deferReply();

    // Get user's preferred language from user data or fallback to English
    const locale = userData.language || "en";

    // Use the `localizer` utility to fetch localized strings
    const title = localizer(locale, "economy.balance.title");
    const description = localizer(locale, "economy.balance.description", {
      coins: userData.coins,
      bank: userData.bank,
    });
    const footer = localizer(locale, "economy.balance.footer");

    // Create an embed with localized content
    const embed = new EmbedBuilder()
      .setColor("#FFFFFF") // White color for the embed
      .setAuthor({
        name: interaction.member.user.username, // Show the user's name
        iconURL: interaction.member.user.displayAvatarURL({ dynamic: true }), // Show user's avatar
      })
      .setTitle(title)
      .setDescription(description)
      .setFooter({ text: footer });

    // Send the embed as a reply
    await interaction.editReply({ embeds: [embed] });
  },
};
