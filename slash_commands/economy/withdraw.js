const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const { getTranslation } = require("../../utils/textLocalizer");
const profileModel = require("../../models/profileSchema.js");

module.exports = {
  name: "withdraw",
  description: "Withdraw TomoCoins from your bank to your wallet.",
  options: [
    {
      name: "amount",
      description: "The amount of TomoCoins you wish to withdraw",
      type: ApplicationCommandOptionType.Integer,
      required: true,
    },
  ],

  callback: async (client, interaction, profileData) => {
    await interaction.deferReply();
    const locale = profileData.language || "en";
    const withdrawAmount = interaction.options.getInteger("amount");

    if (withdrawAmount <= 0) {
      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle(
          getTranslation(locale, "economy.withdraw.invalid_amount_title"),
        )
        .setDescription(
          getTranslation(locale, "economy.withdraw.invalid_amount_description"),
        )
        .setFooter({
          text: getTranslation(
            locale,
            "economy.withdraw.invalid_amount_footer",
          ),
        });

      return await interaction.editReply({ embeds: [embed] });
    }

    if (withdrawAmount > profileData.bank) {
      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle(
          getTranslation(locale, "economy.withdraw.insufficient_balance_title"),
        )
        .setDescription(
          getTranslation(
            locale,
            "economy.withdraw.insufficient_balance_description",
            {
              bank_balance: profileData.bank,
              attempted: withdrawAmount,
            },
          ),
        )
        .setFooter({
          text: getTranslation(
            locale,
            "economy.withdraw.insufficient_balance_footer",
          ),
        });

      return await interaction.editReply({ embeds: [embed] });
    }

    profileData.bank -= withdrawAmount;
    profileData.coins += withdrawAmount;

    await profileModel.updateOne(
      { userID: interaction.member.id },
      { $set: { coins: profileData.coins, bank: profileData.bank } },
    );

    const embed = new EmbedBuilder()
      .setColor("#00FF00")
      .setAuthor({
        name: interaction.member.user.username,
        iconURL: interaction.member.user.displayAvatarURL({ dynamic: true }),
      })
      .setTitle(getTranslation(locale, "economy.withdraw.success_title"))
      .setDescription(
        getTranslation(locale, "economy.withdraw.success_description", {
          amount: withdrawAmount,
          wallet_balance: profileData.coins,
          bank_balance: profileData.bank,
        }),
      )
      .setFooter({
        text: getTranslation(locale, "economy.withdraw.success_footer"),
      });

    await interaction.editReply({ embeds: [embed] });
  },
};
