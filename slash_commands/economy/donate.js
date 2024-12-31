const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const { getTranslation } = require("../../utils/textLocalizer");
const profileModel = require("../../models/profileSchema.js");

module.exports = {
  name: "donate",
  description: "Donate TomoCoins from your wallet to another user's bank.",
  options: [
    {
      name: "recipient",
      description: "The user you want to donate to",
      type: ApplicationCommandOptionType.User,
      required: true,
    },
    {
      name: "amount",
      description: "The amount of TomoCoins you want to donate",
      type: ApplicationCommandOptionType.Integer,
      required: true,
    },
  ],

  callback: async (client, interaction, profileData) => {
    await interaction.deferReply();
    const locale = profileData.language || "en";

    const recipient = interaction.options.getUser("recipient");
    const donationAmount = interaction.options.getInteger("amount");

    if (donationAmount <= 0) {
      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle(getTranslation(locale, "economy.donate.invalid_amount_title"))
        .setDescription(
          getTranslation(locale, "economy.donate.invalid_amount_description"),
        )
        .setFooter({
          text: getTranslation(locale, "economy.donate.invalid_amount_footer"),
        });

      return await interaction.editReply({ embeds: [embed] });
    }

    if (donationAmount > profileData.coins) {
      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle(
          getTranslation(locale, "economy.donate.insufficient_funds_title"),
        )
        .setDescription(
          getTranslation(
            locale,
            "economy.donate.insufficient_funds_description",
            {
              wallet_balance: profileData.coins,
              attempted: donationAmount,
            },
          ),
        )
        .setFooter({
          text: getTranslation(
            locale,
            "economy.donate.insufficient_funds_footer",
          ),
        });

      return await interaction.editReply({ embeds: [embed] });
    }

    let recipientProfile = await profileModel.findOne({ userID: recipient.id });

    if (!recipientProfile) {
      recipientProfile = await profileModel.create({
        userID: recipient.id,
        serverID: interaction.guild.id,
        coins: 0,
        bank: 0,
        inventory: [],
      });
    }

    profileData.coins -= donationAmount;
    recipientProfile.bank += donationAmount;

    await profileModel.updateOne(
      { userID: interaction.member.id },
      { $set: { coins: profileData.coins } },
    );

    await profileModel.updateOne(
      { userID: recipient.id },
      { $set: { bank: recipientProfile.bank } },
    );

    const embed = new EmbedBuilder()
      .setColor("#00FF00")
      .setAuthor({
        name: interaction.member.user.username,
        iconURL: interaction.member.user.displayAvatarURL({ dynamic: true }),
      })
      .setTitle(getTranslation(locale, "economy.donate.success_title"))
      .setDescription(
        getTranslation(locale, "economy.donate.success_description", {
          amount: donationAmount,
          recipient: recipient.username,
          wallet_balance: profileData.coins,
        }),
      )
      .setFooter({
        text: getTranslation(locale, "economy.donate.success_footer"),
      });

    await interaction.editReply({ embeds: [embed] });
  },
};
