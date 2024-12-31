const { EmbedBuilder } = require("discord.js");
const { getTranslation } = require("../../utils/textLocalizer");

module.exports = {
  name: "balance",
  description: "Check your current balance!",

  callback: async (client, interaction, profileData) => {
    await interaction.deferReply();

    // Get user's preferred language from profile data or fallback to English
    const locale = profileData.language || "en";

    // Use the `getTranslation` utility to fetch localized strings
    const title = getTranslation(locale, "economy.balance.title");
    const description = getTranslation(locale, "economy.balance.description", {
      coins: profileData.coins,
      bank: profileData.bank,
    });
    const footer = getTranslation(locale, "economy.balance.footer");

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
