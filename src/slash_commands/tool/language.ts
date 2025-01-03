import {
  ApplicationCommandOptionType,
  EmbedBuilder,
  Client,
  ChatInputCommandInteraction,
} from "discord.js";
import { Command, IUser } from "../../types";
import { localizer } from "../../utils/textLocalizer";
import UserModel from "../../models/userSchema";

const command: Command = {
  name: "language",
  description: "Change your preferred language | 言語を変更します",
  category: "tool",
  options: [
    {
      name: "language",
      description: "Choose your language | 言語を選択してください",
      type: ApplicationCommandOptionType.String,
      required: true,
      choices: [
        { name: "English", value: "en" },
        { name: "日本語 (Japanese)", value: "ja" },
      ],
    },
  ],

  callback: async (
    client: Client,
    interaction: ChatInputCommandInteraction,
    userData: IUser
  ): Promise<void> => {
    const selectedLanguage = interaction.options.getString("language", true);
    const currentLocale = userData.language || "en";

    try {
      await UserModel.updateOne(
        { userID: interaction.user.id },
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
} as const;

export default command;
