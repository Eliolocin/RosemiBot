const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const { getTranslation } = require("../../utils/textLocalizer");
const profileModel = require("../../models/profileSchema.js");

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

  callback: async (client, interaction, profileData) => {
    await interaction.deferReply();
    const locale = profileData.language || "en";
    const depositAmount = interaction.options.getInteger("amount");

    if (depositAmount <= 0) {
      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle(
          getTranslation(locale, "economy.deposit.invalid_amount_title"),
        )
        .setDescription(
          getTranslation(locale, "economy.deposit.invalid_amount_description"),
        )
        .setFooter({
          text: getTranslation(locale, "economy.deposit.invalid_amount_footer"),
        });

      return await interaction.editReply({ embeds: [embed] });
    }

    if (depositAmount > profileData.coins) {
      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle(
          getTranslation(locale, "economy.deposit.insufficient_funds_title"),
        )
        .setDescription(
          getTranslation(
            locale,
            "economy.deposit.insufficient_funds_description",
            {
              wallet_balance: profileData.coins,
              attempted: depositAmount,
            },
          ),
        )
        .setFooter({
          text: getTranslation(
            locale,
            "economy.deposit.insufficient_funds_footer",
          ),
        });

      return await interaction.editReply({ embeds: [embed] });
    }

    profileData.coins -= depositAmount;
    profileData.bank += depositAmount;

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
      .setTitle(getTranslation(locale, "economy.deposit.success_title"))
      .setDescription(
        getTranslation(locale, "economy.deposit.success_description", {
          amount: depositAmount,
          wallet_balance: profileData.coins,
          bank_balance: profileData.bank,
        }),
      )
      .setFooter({
        text: getTranslation(locale, "economy.deposit.success_footer"),
      });

    await interaction.editReply({ embeds: [embed] });
  },
};
