import {
  EmbedBuilder,
  Client,
  ChatInputCommandInteraction,
  TextChannel,
} from "discord.js";
import { Command, IUser } from "../../types/global";
import { localizer } from "../../utils/textLocalizer";

const command: Command = {
  name: "refresh",
  description: "Refresh the AI's conversation memory",
  category: "tool",

  callback: async (
    client: Client,
    interaction: ChatInputCommandInteraction,
    userData: IUser
  ): Promise<void> => {
    const locale = userData.language || "en";
    
    if (interaction.channel instanceof TextChannel) {
      await interaction.channel.send("**=============**");
    }
    
    const embed = new EmbedBuilder()
      .setColor("#2ECC71")
      .setTitle(localizer(locale, "tool.refresh.success_title"))
      .setDescription(localizer(locale, "tool.refresh.success_description"));

    await interaction.reply({ embeds: [embed] });
  },
} as const;

export default command;
