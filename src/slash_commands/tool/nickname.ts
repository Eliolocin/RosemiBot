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
  name: "nickname",
  description:
    "Change what Tomo calls you | トモがあなたを呼ぶ名前を変更します",
  category: "tool",
  options: [
    {
      name: "nickname",
      description: "Your new nickname | 新しいニックネーム",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],

  callback: async (
    client: Client,
    interaction: ChatInputCommandInteraction,
    userData: IUser
  ): Promise<void> => {
    const newNickname = interaction.options.getString("nickname", true);
    const locale = userData.language || "en";

    try {
      await UserModel.updateOne(
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
} as const;

export default command;
