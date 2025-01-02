const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const { localizer } = require("../../utils/textLocalizer");
const userModel = require("../../models/userSchema.js");

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

  callback: async (client, interaction, userData) => {
    await interaction.deferReply();
    const locale = userData.language || "en";

    const recipient = interaction.options.getUser("recipient");
    const donationAmount = interaction.options.getInteger("amount");

    if (donationAmount <= 0) {
      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle(localizer(locale, "economy.donate.invalid_amount_title"))
        .setDescription(
          localizer(locale, "economy.donate.invalid_amount_description")
        )
        .setFooter({
          text: localizer(locale, "economy.donate.invalid_amount_footer"),
        });

      return await interaction.editReply({ embeds: [embed] });
    }

    if (donationAmount > userData.coins) {
      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle(localizer(locale, "economy.donate.insufficient_funds_title"))
        .setDescription(
          localizer(locale, "economy.donate.insufficient_funds_description", {
            wallet_balance: userData.coins,
            attempted: donationAmount,
          })
        )
        .setFooter({
          text: localizer(locale, "economy.donate.insufficient_funds_footer"),
        });

      return await interaction.editReply({ embeds: [embed] });
    }

    let recipientUser = await userModel.findOne({ userID: recipient.id });

    if (!recipientUser) {
      recipientUser = await userModel.create({
        userID: recipient.id,
        serverID: interaction.guild.id,
        coins: 0,
        bank: 0,
        inventory: [],
      });
    }

    userData.coins -= donationAmount;
    recipientUser.bank += donationAmount;

    await userModel.updateOne(
      { userID: interaction.member.id },
      { $set: { coins: userData.coins } }
    );

    await userModel.updateOne(
      { userID: recipient.id },
      { $set: { bank: recipientUser.bank } }
    );

    const embed = new EmbedBuilder()
      .setColor("#00FF00")
      .setAuthor({
        name: interaction.member.user.username,
        iconURL: interaction.member.user.displayAvatarURL({ dynamic: true }),
      })
      .setTitle(localizer(locale, "economy.donate.success_title"))
      .setDescription(
        localizer(locale, "economy.donate.success_description", {
          amount: donationAmount,
          recipient: recipient.username,
          wallet_balance: userData.coins,
        })
      )
      .setFooter({
        text: localizer(locale, "economy.donate.success_footer"),
      });

    await interaction.editReply({ embeds: [embed] });
  },
};
