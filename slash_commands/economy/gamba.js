const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const { getTranslation } = require("../../utils/textLocalizer");
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
    const locale = profileData.language || "en";
    const gambleAmount = interaction.options.getInteger("amount");

    if (gambleAmount > profileData.coins) {
      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle(
          getTranslation(locale, "economy.gamba.insufficient_funds_title"),
        )
        .setDescription(
          getTranslation(
            locale,
            "economy.gamba.insufficient_funds_description",
            {
              balance: profileData.coins,
              attempted: gambleAmount,
            },
          ),
        )
        .setFooter({
          text: getTranslation(
            locale,
            "economy.gamba.insufficient_funds_footer",
          ),
        });

      return await interaction.editReply({ embeds: [embed] });
    }

    profileData.coins -= gambleAmount;

    const isWin = Math.random() < 0.5; // 50% chance
    const winnings = isWin ? gambleAmount * 2 : 0;

    if (isWin) {
      profileData.coins += winnings;
    }

    await profileModel.updateOne(
      { userID: interaction.member.id },
      { $set: { coins: profileData.coins } },
    );

    const embed = new EmbedBuilder()
      .setColor(isWin ? "#00FF00" : "#FF0000")
      .setAuthor({
        name: interaction.member.user.username,
        iconURL: interaction.member.user.displayAvatarURL({ dynamic: true }),
      })
      .setTitle(
        getTranslation(
          locale,
          isWin ? "economy.gamba.win_title" : "economy.gamba.lose_title",
        ),
      )
      .setDescription(
        isWin
          ? getTranslation(locale, "economy.gamba.win_description", {
              winnings,
              new_balance: profileData.coins,
            })
          : getTranslation(locale, "economy.gamba.lose_description", {
              amount_lost: gambleAmount,
              new_balance: profileData.coins,
            }),
      )
      .setFooter({
        text: getTranslation(
          locale,
          isWin ? "economy.gamba.win_footer" : "economy.gamba.lose_footer",
        ),
      });

    await interaction.editReply({ embeds: [embed] });
  },
};
