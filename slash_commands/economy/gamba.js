const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const { localizer } = require("../../utils/textLocalizer");
const userModel = require("../../models/userSchema.js");

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

  callback: async (client, interaction, userData) => {
    await interaction.deferReply();
    const locale = userData.language || "en";
    const gambleAmount = interaction.options.getInteger("amount");

    if (gambleAmount > userData.coins) {
      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle(localizer(locale, "economy.gamba.insufficient_funds_title"))
        .setDescription(
          localizer(locale, "economy.gamba.insufficient_funds_description", {
            balance: userData.coins,
            attempted: gambleAmount,
          })
        )
        .setFooter({
          text: localizer(locale, "economy.gamba.insufficient_funds_footer"),
        });

      return await interaction.editReply({ embeds: [embed] });
    }

    userData.coins -= gambleAmount;

    const isWin = Math.random() < 0.5; // 50% chance
    const winnings = isWin ? gambleAmount * 2 : 0;

    if (isWin) {
      userData.coins += winnings;
    }

    await userModel.updateOne(
      { userID: interaction.member.id },
      { $set: { coins: userData.coins } }
    );

    const embed = new EmbedBuilder()
      .setColor(isWin ? "#00FF00" : "#FF0000")
      .setAuthor({
        name: interaction.member.user.username,
        iconURL: interaction.member.user.displayAvatarURL({ dynamic: true }),
      })
      .setTitle(
        localizer(
          locale,
          isWin ? "economy.gamba.win_title" : "economy.gamba.lose_title"
        )
      )
      .setDescription(
        isWin
          ? localizer(locale, "economy.gamba.win_description", {
              winnings,
              new_balance: userData.coins,
            })
          : localizer(locale, "economy.gamba.lose_description", {
              amount_lost: gambleAmount,
              new_balance: userData.coins,
            })
      )
      .setFooter({
        text: localizer(
          locale,
          isWin ? "economy.gamba.win_footer" : "economy.gamba.lose_footer"
        ),
      });

    await interaction.editReply({ embeds: [embed] });
  },
};
