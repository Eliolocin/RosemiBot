const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const profileModel = require("../../models/profileSchema.js");

module.exports = {
  name: "gamba",
  description:
    "Gamble your TomoCoins with a 50/50 chance to double or lose it all!",
  options: [
    {
      name: "amount",
      description: "The number of TomoCoins you wish to gamble",
      type: ApplicationCommandOptionType.Integer,
      required: true,
    },
  ],

  callback: async (client, interaction, profileData) => {
    await interaction.deferReply();

    // Get the user's input for the 'amount' parameter
    const gambleAmount = interaction.options.getInteger("amount");

    // Check if the user has enough coins to gamble
    if (gambleAmount > profileData.coins) {
      const embed = new EmbedBuilder()
        .setColor("#FF0000") // Red color indicating an error
        .setTitle("Insufficient Funds")
        .setDescription(
          `💸 You don't have enough TomoCoins to gamble that amount!\n\n💰 **Your Balance:** ${profileData.coins}\n🎲 **Attempted Gamble:** ${gambleAmount}`,
        )
        .setFooter({ text: "Try a smaller amount! Good luck!" });

      return await interaction.editReply({ embeds: [embed] });
    }

    // Proceed with the gamble: remove the gamble amount from the balance
    profileData.coins -= gambleAmount;

    // Perform the 50/50 gamble
    const isWin = Math.random() < 0.5; // 50% chance

    const winnings = isWin ? gambleAmount * 2 : 0;

    // If won, add the winnings back
    if (isWin) {
      profileData.coins += winnings;
    }

    // Update the database
    await profileModel.updateOne(
      { userID: interaction.member.id },
      { $set: { coins: profileData.coins } },
    );

    // Build the embed response
    const embed = new EmbedBuilder()
      .setColor(isWin ? "#00FF00" : "#FF0000") // Green for win, red for lose
      .setAuthor({
        name: interaction.member.user.username,
        iconURL: interaction.member.user.displayAvatarURL({ dynamic: true }),
      })
      .setTitle(isWin ? "You Win!" : "You Lost!")
      .setDescription(
        isWin
          ? `🎉 Congratulations! You doubled your gamble and won **${winnings}** TomoCoins!\n\n💰 **New Balance:** ${profileData.coins}`
          : `💔 Better luck next time! You lost **${gambleAmount}** TomoCoins.\n\n💰 **New Balance:** ${profileData.coins}`,
      )
      .setFooter({
        text: isWin ? "Big win! Feeling lucky?" : "Ouch! Gambling is risky!",
      });

    // Send the response
    await interaction.editReply({ embeds: [embed] });
  },
};
