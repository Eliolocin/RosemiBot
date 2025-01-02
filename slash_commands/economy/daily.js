const { EmbedBuilder } = require("discord.js");
const { localizer } = require("../../utils/textLocalizer");
const userModel = require("../../models/userSchema.js");

module.exports = {
  name: "daily",
  description: "Claim your daily TomoCoins!",

  callback: async (client, interaction, userData) => {
    await interaction.deferReply();
    const locale = userData.language || "en";

    // DAILY COOLDOWN LOGIC
    const now = Date.now();
    const cooldownKey = "daily";
    const dailyCooldownDuration = 12 * 60 * 60 * 1000; // 12 hours in milliseconds

    const userCooldowns = userData.cooldowns || {};

    // Check if the user is within the cooldown period
    if (userCooldowns[cooldownKey] && userCooldowns[cooldownKey] > now) {
      const remaining = Math.ceil(
        (userCooldowns[cooldownKey] - now) / (60 * 60 * 1000)
      ); // Remaining time in hours
      await interaction.editReply({
        content: `⏳ You've already claimed your daily reward. Please come back in ${remaining} hours.`,
        ephemeral: true,
      });
      return;
    }

    // If not on cooldown, claim the daily reward
    const randomNumber = Math.floor(Math.random() * (300 - 100 + 1)) + 100;

    // Update user's coins in the database
    await userModel.findOneAndUpdate(
      { userID: interaction.member.id },
      {
        $inc: { coins: randomNumber },
        $set: { [`cooldowns.${cooldownKey}`]: now + dailyCooldownDuration }, // Set the cooldown to current time + 12 hours
      }
    );

    // Localized strings
    const title = localizer(locale, "economy.daily.title");
    const description = localizer(locale, "economy.daily.claim_success", {
      claimed: randomNumber,
      new_balance: userData.coins + randomNumber,
    });
    const footer =
      randomNumber >= 200
        ? localizer(locale, "economy.daily.footer_lucky")
        : localizer(locale, "economy.daily.footer");

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
