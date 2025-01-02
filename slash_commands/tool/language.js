const { ApplicationCommandOptionType } = require("discord.js");
const { localizer } = require("../../utils/textLocalizer");
const userModel = require("../../models/userSchema.js");
const { EmbedBuilder } = require("discord.js");

module.exports = {
  name: "language",
  description: "Change your preferred language | 言語を変更します",
  options: [
    {
      name: "language",
      description: "Choose your language (en or ja).",
      type: ApplicationCommandOptionType.String,
      required: true,
      choices: [
        { name: "English", value: "en" },
        { name: "日本語 (Japanese)", value: "ja" },
      ],
    },
  ],

  callback: async (client, interaction, userData) => {
    const selectedLanguage = interaction.options.getString("language");
    const currentLocale = userData?.language || "en";

    try {
      await userModel.updateOne(
        { userID: interaction.member.id },
        { $set: { language: selectedLanguage } },
        { upsert: true }
      );

      const languageDisplay = selectedLanguage === "en" ? "English" : "日本語";

      const embed = new EmbedBuilder()
        .setColor("#2ECC71")
        .setTitle(localizer(selectedLanguage, "tool.language.success_title"))
        .setDescription(
          localizer(selectedLanguage, "tool.language.success_description", {
            language: languageDisplay,
          })
        );

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (err) {
      console.error("Error in language command:", err);

      const embed = new EmbedBuilder()
        .setColor("#E74C3C")
        .setTitle(localizer(currentLocale, "tool.language.error_title"))
        .setDescription(
          localizer(currentLocale, "tool.language.error_description")
        );

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
