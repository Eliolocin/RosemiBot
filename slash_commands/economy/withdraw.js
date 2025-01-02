const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const { localizer } = require("../../utils/textLocalizer");
const userModel = require("../../models/userSchema.js");

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

  callback: async (client, interaction, userData) => {
    await interaction.deferReply();
    const locale = userData.language || "en";
    const withdrawAmount = interaction.options.getInteger("amount");

    if (withdrawAmount <= 0) {
      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle(localizer(locale, "economy.withdraw.invalid_amount_title"))
        .setDescription(
          localizer(locale, "economy.withdraw.invalid_amount_description")
        )
        .setFooter({
          text: localizer(locale, "economy.withdraw.invalid_amount_footer"),
        });

      return await interaction.editReply({ embeds: [embed] });
    }

    if (withdrawAmount > userData.bank) {
      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle(
          localizer(locale, "economy.withdraw.insufficient_balance_title")
        )
        .setDescription(
          localizer(
            locale,
            "economy.withdraw.insufficient_balance_description",
            {
              bank_balance: userData.bank,
              attempted: withdrawAmount,
            }
          )
        )
        .setFooter({
          text: localizer(
            locale,
            "economy.withdraw.insufficient_balance_footer"
          ),
        });

      return await interaction.editReply({ embeds: [embed] });
    }

    userData.bank -= withdrawAmount;
    userData.coins += withdrawAmount;

    await userModel.updateOne(
      { userID: interaction.member.id },
      { $set: { coins: userData.coins, bank: userData.bank } }
    );

    const embed = new EmbedBuilder()
      .setColor("#00FF00")
      .setAuthor({
        name: interaction.member.user.username,
        iconURL: interaction.member.user.displayAvatarURL({ dynamic: true }),
      })
      .setTitle(localizer(locale, "economy.withdraw.success_title"))
      .setDescription(
        localizer(locale, "economy.withdraw.success_description", {
          amount: withdrawAmount,
          wallet_balance: userData.coins,
          bank_balance: userData.bank,
        })
      )
      .setFooter({
        text: localizer(locale, "economy.withdraw.success_footer"),
      });

    await interaction.editReply({ embeds: [embed] });
  },
};
