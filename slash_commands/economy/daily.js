const { EmbedBuilder } = require("discord.js");
const profileModel = require("../../models/profileSchema.js");

module.exports = {
  name: "daily",
  description: "Claim your daily TomoCoins!",

  callback: async (client, interaction, profileData) => {
    await interaction.deferReply();

    // Generate a random amount between 100 and 300
    const randomNumber = Math.floor(Math.random() * (300 - 100 + 1)) + 100;

    // Update user's coins in the database
    await profileModel.findOneAndUpdate(
      { userID: interaction.member.id }, // Match by user's ID
      { $inc: { coins: randomNumber } }, // Update their coins in the database
    );

    // Build the embed
    const embed = new EmbedBuilder()
      .setColor("#FFFFFF") // White color for the embed
      .setAuthor({
        name: interaction.member.user.username, // Show the user's name
        iconURL: interaction.member.user.displayAvatarURL({ dynamic: true }), // Show user's avatar
      })
      .setTitle("New Balance:")
      .setDescription(
        `🎉 You claimed **${randomNumber}** TomoCoins!\n💰 **New Balance:** ${profileData.coins + randomNumber}`,
      );

    // Add a rare congratulatory footer for high rolls (200–300)
    if (randomNumber >= 200) {
      embed.setFooter({ text: "Congratulations! That was a lucky claim! 🎉" });
    } else {
      embed.setFooter({ text: "Keep earning those TomoCoins! (￣▽￣*)ゞ" });
    }

    // Send the embed as a reply
    await interaction.editReply({ embeds: [embed] });
  },
};
