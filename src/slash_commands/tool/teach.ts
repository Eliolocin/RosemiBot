import {
  ApplicationCommandOptionType,
  EmbedBuilder,
  Client,
  ChatInputCommandInteraction,
  TextChannel,
  PermissionsBitField,
} from "discord.js";
import { Command, IUser, IBot } from "../../types";
import { localizer } from "../../utils/textLocalizer";
import { convertMentionsToNicknames } from "../../utils/mentionConverter";
import BotModel from "../../models/botSchema";
import UserModel from "../../models/userSchema";

const command: Command = {
  name: "teach",
  description: "Teach the bot new information or conversation patterns",
  category: "tool",
  options: [
    {
      name: "info",
      description: "Add or remove bot information",
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: "action",
          description: "Choose to add or remove information",
          type: ApplicationCommandOptionType.String,
          required: true,
          choices: [
            { name: "Add Info", value: "add" },
            { name: "Remove Info", value: "remove" },
          ],
        },
      ],
    },
    {
      name: "convo",
      description: "Add or remove conversation examples",
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: "action",
          description: "Choose to add or remove conversation example",
          type: ApplicationCommandOptionType.String,
          required: true,
          choices: [
            { name: "Add Conversation", value: "add" },
            { name: "Remove Conversation", value: "remove" },
          ],
        },
      ],
    },
  ],

  callback: async (
    client: Client,
    interaction: ChatInputCommandInteraction,
    userData: IUser
  ): Promise<void> => {
    const subcommand = interaction.options.getSubcommand();
    const action = interaction.options.getString("action", true);
    const locale = userData.language || "en";

    try {
      const botData = await BotModel.findOne({
        serverID: interaction.guildId,
      });

      if (!botData) {
        throw new Error("Bot data not found");
      }

      if (subcommand === "info") {
        if (action === "add") {
          await handleInfoAdd(interaction, botData, locale);
        } else {
          await handleInfoRemove(interaction, botData, locale);
        }
      } else if (subcommand === "convo") {
        if (action === "add") {
          await handleConvoAdd(interaction, botData, locale);
        } else {
          await handleConvoRemove(interaction, botData, locale);
        }
      }
    } catch (error) {
      console.error("Error in teach command:", error);
      const errorEmbed = new EmbedBuilder()
        .setColor("#E74C3C")
        .setTitle(localizer(locale, "tool.teach.error_title"))
        .setDescription(localizer(locale, "tool.teach.error_description"));

      await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    }
  },
} as const;

async function handleInfoAdd(
  interaction: ChatInputCommandInteraction,
  botData: IBot,
  locale: string
): Promise<void> {
  const promptEmbed = new EmbedBuilder()
    .setColor("#3498DB")
    .setTitle(localizer(locale, "tool.teach.info_prompt_title"))
    .setDescription(localizer(locale, "tool.teach.info_prompt_description"));

  await interaction.reply({ embeds: [promptEmbed] });
  if (!(interaction.channel instanceof TextChannel)) return;

  try {
    const filter = (m: any) => m.author.id === interaction.user.id;
    const collected = await interaction.channel?.awaitMessages({
      filter,
      max: 1,
      time: 30000,
      errors: ["time"],
    });

    if (!collected || !collected.first())
      throw new Error("No message collected");

    const infoText = collected.first()!.content;
    const convertedText = await convertMentionsToNicknames(
      infoText,
      interaction.guild?.id as string
    );

    botData.botDatabase.push(convertedText);
    await botData.save();

    const successEmbed = new EmbedBuilder()
      .setColor("#2ECC71")
      .setTitle(localizer(locale, "tool.teach.info_success_title"))
      .setDescription(
        localizer(locale, "tool.teach.info_success_description", {
          info: convertedText,
        })
      );

    await interaction.followUp({ embeds: [successEmbed], ephemeral: true });
  } catch (error) {
    console.error("Error in handleInfoAdd:", error);
    const errorEmbed = new EmbedBuilder()
      .setColor("#E74C3C")
      .setTitle(localizer(locale, "tool.teach.error_title"))
      .setDescription(localizer(locale, "tool.teach.error_description"));

    await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
  }
}

async function handleInfoRemove(
  interaction: ChatInputCommandInteraction,
  botData: IBot,
  locale: string
): Promise<void> {
  if (botData.botDatabase.length === 0) {
    const emptyEmbed = new EmbedBuilder()
      .setColor("#E74C3C")
      .setTitle(localizer(locale, "tool.teach.info_empty_title"))
      .setDescription(localizer(locale, "tool.teach.info_empty_description"));

    await interaction.reply({ embeds: [emptyEmbed], ephemeral: true });
    return;
  }

  const listEmbed = new EmbedBuilder()
    .setColor("#3498DB")
    .setTitle(localizer(locale, "tool.teach.info_list_title"))
    .setDescription(
      botData.botDatabase
        .map((info, index) => `${index + 1}. ${info}`)
        .join("\n")
    )
    .setFooter({
      text: localizer(locale, "tool.teach.remove_prompt"),
    });

  await interaction.reply({ embeds: [listEmbed] });

  try {
    const filter = (m: any) =>
      m.author.id === interaction.user.id &&
      !isNaN(parseInt(m.content)) &&
      parseInt(m.content) > 0 &&
      parseInt(m.content) <= botData.botDatabase.length;

    if (!(interaction.channel instanceof TextChannel)) return;

    const collected = await interaction.channel?.awaitMessages({
      filter,
      max: 1,
      time: 30000,
      errors: ["time"],
    });

    if (!collected || !collected.first())
      throw new Error("No message collected");

    const index = parseInt(collected.first()!.content) - 1;
    const removedInfo = botData.botDatabase[index];
    botData.botDatabase.splice(index, 1);
    await botData.save();

    const successEmbed = new EmbedBuilder()
      .setColor("#2ECC71")
      .setTitle(localizer(locale, "tool.teach.info_remove_success_title"))
      .setDescription(
        localizer(locale, "tool.teach.info_remove_success_description", {
          info: removedInfo,
        })
      );

    await interaction.followUp({ embeds: [successEmbed], ephemeral: true });
  } catch (error) {
    const errorEmbed = new EmbedBuilder()
      .setColor("#E74C3C")
      .setTitle(localizer(locale, "tool.teach.error_title"))
      .setDescription(localizer(locale, "tool.teach.error_description"));

    await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
  }
}

async function handleConvoAdd(
  interaction: ChatInputCommandInteraction,
  botData: IBot,
  locale: string
): Promise<void> {
  const promptEmbed = new EmbedBuilder()
    .setColor("#3498DB")
    .setTitle(localizer(locale, "tool.teach.convo_prompt_title"))
    .setDescription(localizer(locale, "tool.teach.convo_prompt_description"));

  await interaction.reply({ embeds: [promptEmbed] });

  try {
    if (!(interaction.channel instanceof TextChannel)) return;
    const filter = (m: any) => m.author.id === interaction.user.id;
    const collected = await interaction.channel?.awaitMessages({
      filter,
      max: 1,
      time: 30000,
      errors: ["time"],
    });

    if (!collected || !collected.first())
      throw new Error("No message collected");

    const convoText = collected.first()!.content;
    const convertedText = await convertMentionsToNicknames(
      convoText,
      interaction.guild?.id as string
    );
    const [input, output] = convertedText.split("|").map((text) => text.trim());

    botData.conversationExamples.push({ input, output });
    await botData.save();

    const successEmbed = new EmbedBuilder()
      .setColor("#2ECC71")
      .setTitle(localizer(locale, "tool.teach.convo_success_title"))
      .setDescription(
        localizer(locale, "tool.teach.convo_success_description", {
          convo: convertedText,
        })
      );

    await interaction.followUp({ embeds: [successEmbed], ephemeral: true });
  } catch (error) {
    console.error("Error in handleConvoAdd:", error);
    const errorEmbed = new EmbedBuilder()
      .setColor("#E74C3C")
      .setTitle(localizer(locale, "tool.teach.error_title"))
      .setDescription(localizer(locale, "tool.teach.error_description"));

    await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
  }
}

async function handleConvoRemove(
  interaction: ChatInputCommandInteraction,
  botData: IBot,
  locale: string
): Promise<void> {
  if (botData.conversationExamples.length === 0) {
    const emptyEmbed = new EmbedBuilder()
      .setColor("#E74C3C")
      .setTitle(localizer(locale, "tool.teach.convo_empty_title"))
      .setDescription(localizer(locale, "tool.teach.convo_empty_description"));

    await interaction.reply({ embeds: [emptyEmbed], ephemeral: true });
    return;
  }

  const listEmbed = new EmbedBuilder()
    .setColor("#3498DB")
    .setTitle(localizer(locale, "tool.teach.convo_list_title"))
    .setDescription(
      botData.conversationExamples
        .map(
          (convo, index) =>
            `${index + 1}.\nQ: ${convo.input}\nA: ${convo.output}`
        )
        .join("\n\n")
    )
    .setFooter({
      text: localizer(locale, "tool.teach.remove_prompt"),
    });

  await interaction.reply({ embeds: [listEmbed] });

  try {
    if (!(interaction.channel instanceof TextChannel)) return;
    const filter = (m: any) =>
      m.author.id === interaction.user.id &&
      !isNaN(parseInt(m.content)) &&
      parseInt(m.content) > 0 &&
      parseInt(m.content) <= botData.conversationExamples.length;

    const collected = await interaction.channel?.awaitMessages({
      filter,
      max: 1,
      time: 30000,
      errors: ["time"],
    });

    if (!collected || !collected.first())
      throw new Error("No message collected");

    const index = parseInt(collected.first()!.content) - 1;
    const removedConvo = botData.conversationExamples[index];
    botData.conversationExamples.splice(index, 1);
    await botData.save();

    const successEmbed = new EmbedBuilder()
      .setColor("#2ECC71")
      .setTitle(localizer(locale, "tool.teach.convo_remove_success_title"))
      .setDescription(
        localizer(locale, "tool.teach.convo_remove_success_description", {
          question: removedConvo.input,
          answer: removedConvo.output,
        })
      );

    await interaction.followUp({ embeds: [successEmbed], ephemeral: true });
  } catch (error) {
    const errorEmbed = new EmbedBuilder()
      .setColor("#E74C3C")
      .setTitle(localizer(locale, "tool.teach.error_title"))
      .setDescription(localizer(locale, "tool.teach.error_description"));

    await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
  }
}

export default command;
