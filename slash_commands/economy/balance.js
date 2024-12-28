const { EmbedBuilder } = require("discord.js");

module.exports = {
  name: "balance",
  description: "Check your current balance!",

  callback: async (client, interaction, profileData) => {
    await interaction.deferReply();

    // Create an embed
    const embed = new EmbedBuilder()
      .setColor("#FFFFFF") // White color for the embed
      .setAuthor({
        name: interaction.member.user.username, // Show the user's name
        iconURL: interaction.member.user.displayAvatarURL({ dynamic: true }), // Show user's avatar
      })
      .setTitle("Your Balance")
      .setDescription(
        `💰 **TomoCoins**: ${profileData.coins}\n🏦 **Bank Balance**: ${profileData.bank}`,
      )
      .setFooter({ text: "Keep earning those TomoCoins! (￣▽￣*)ゞ" });

    // Send the embed as a reply
    await interaction.editReply({ embeds: [embed] });
  },
};
