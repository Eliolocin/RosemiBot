const { EmbedBuilder } = require("discord.js");
const { getTranslation } = require("../../utils/textLocalizer");
const profileModel = require("../../models/profileSchema.js");

module.exports = {
  name: "daily",
  description: "Claim your daily TomoCoins!",

  callback: async (client, interaction, profileData) => {
    await interaction.deferReply();

    const locale = profileData.language || "en";

    // Generate a random amount between 100 and 300
    const randomNumber = Math.floor(Math.random() * (300 - 100 + 1)) + 100;

    // Update user's coins in the database
    await profileModel.findOneAndUpdate(
      { userID: interaction.member.id },
      { $inc: { coins: randomNumber } },
    );

    // Localized strings
    const title = getTranslation(locale, "economy.daily.title");
    const description = getTranslation(locale, "economy.daily.claim_success", {
      claimed: randomNumber,
      new_balance: profileData.coins + randomNumber,
    });
    const footer =
      randomNumber >= 200
        ? getTranslation(locale, "economy.daily.footer_lucky")
        : getTranslation(locale, "economy.daily.footer");

    // Create the embed
    const embed = new EmbedBuilder()
      .setColor("#FFFFFF")
      .setAuthor({
        name: interaction.member.user.username,
        iconURL: interaction.member.user.displayAvatarURL({ dynamic: true }),
      })
      .setTitle(title)
      .setDescription(description)
      .setFooter({ text: footer });

    await interaction.editReply({ embeds: [embed] });
  },
};
