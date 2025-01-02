const { ApplicationCommandOptionType } = require("discord.js");
const { EmbedBuilder } = require("discord.js");
const { localizer } = require("../../utils/textLocalizer");
const userModel = require("../../models/userSchema");

module.exports = {
  name: "nickname",
  description:
    "Set your nickname in the database | データベース内のニックネームを設定します",
  options: [
    {
      name: "nickname",
      description: "Your new nickname",
      type: ApplicationCommandOptionType.String,
      required: true,
      min_length: 1,
      max_length: 32,
    },
  ],

  callback: async (client, interaction, userData) => {
    const newNickname = interaction.options.getString("nickname");
    const locale = userData?.language || "en";

    try {
      await userModel.updateOne(
        { userID: interaction.user.id },
        { $set: { nickname: newNickname } },
        { upsert: true }
      );

      const embed = new EmbedBuilder()
        .setColor("#2ECC71")
        .setTitle(localizer(locale, "tool.nickname.success_title"))
        .setDescription(
          localizer(locale, "tool.nickname.success_description", {
            nickname: newNickname,
          })
        );

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (err) {
      console.error("Error in nickname command:", err);

      const embed = new EmbedBuilder()
        .setColor("#E74C3C")
        .setTitle(localizer(locale, "tool.nickname.error_title"))
        .setDescription(localizer(locale, "tool.nickname.error_description"));

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
