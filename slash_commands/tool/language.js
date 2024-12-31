const { ApplicationCommandOptionType } = require("discord.js");
const { getTranslation } = require("../../utils/textLocalizer");
const profileModel = require("../../models/profileSchema.js");

module.exports = {
  name: "language",
  description: "Set your preferred language for the bot.",
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

  callback: async (client, interaction) => {
    const selectedLanguage = interaction.options.getString("language");

    try {
      // Update user's preferred language in the database
      await profileModel.updateOne(
        { userID: interaction.member.id },
        { $set: { language: selectedLanguage } },
        { upsert: true }, // Create the profile if it doesn't exist
      );

      const embed = new EmbedBuilder()
        .setColor("#2ECC71")
        .setTitle(selectedLanguage === "en" ? "Language Set" : "言語変更完了！")
        .setDescription(
          selectedLanguage === "en"
            ? getTranslation(
                selectedLanguage,
                "tool.setlanguage.success_english",
              )
            : getTranslation(
                selectedLanguage,
                "tool.setlanguage.success_japanese",
              ),
        );

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (err) {
      console.error("Error in language command:", err);

      const embed = new EmbedBuilder()
        .setColor("#E74C3C")
        .setTitle("Error")
        .setDescription(
          "There was an error updating your language preference. Please try again!",
        );

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
