const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const { localizer } = require("../../utils/textLocalizer");
const userModel = require("../../models/userSchema.js");

module.exports = {
  name: "deposit",
  description: "Deposit your TomoCoins into your bank.",
  options: [
    {
      name: "amount",
      description: "The amount of TomoCoins you wish to deposit",
      type: ApplicationCommandOptionType.Integer,
      required: true,
    },
  ],

  callback: async (client, interaction, userData) => {
    await interaction.deferReply();
    const locale = userData.language || "en";
    const depositAmount = interaction.options.getInteger("amount");

    if (depositAmount <= 0) {
      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle(localizer(locale, "economy.deposit.invalid_amount_title"))
        .setDescription(
          localizer(locale, "economy.deposit.invalid_amount_description")
        )
        .setFooter({
          text: localizer(locale, "economy.deposit.invalid_amount_footer"),
        });

      return await interaction.editReply({ embeds: [embed] });
    }

    if (depositAmount > userData.coins) {
      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle(localizer(locale, "economy.deposit.insufficient_funds_title"))
        .setDescription(
          localizer(locale, "economy.deposit.insufficient_funds_description", {
            wallet_balance: userData.coins,
            attempted: depositAmount,
          })
        )
        .setFooter({
          text: localizer(locale, "economy.deposit.insufficient_funds_footer"),
        });

      return await interaction.editReply({ embeds: [embed] });
    }

    userData.coins -= depositAmount;
    userData.bank += depositAmount;

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
      .setTitle(localizer(locale, "economy.deposit.success_title"))
      .setDescription(
        localizer(locale, "economy.deposit.success_description", {
          amount: depositAmount,
          wallet_balance: userData.coins,
          bank_balance: userData.bank,
        })
      )
      .setFooter({
        text: localizer(locale, "economy.deposit.success_footer"),
      });

    await interaction.editReply({ embeds: [embed] });
  },
};
