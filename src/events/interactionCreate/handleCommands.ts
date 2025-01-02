import { Client, Interaction, ChatInputCommandInteraction } from "discord.js";
import { Model } from "mongoose";
import { IUser } from "../../types";
import getLocalCommands from "../../utils/getLocalCommands";

interface ExtendedCommand {
  name: string;
  description: string;
  devOnly?: boolean;
  testOnly?: boolean;
  deleted?: boolean;
  permissionsRequired?: bigint[];
  botPermissions?: bigint[];
  category?: string;
  callback: (
    client: Client,
    interaction: ChatInputCommandInteraction,
    userData: IUser
  ) => Promise<void>;
}

const TIMEOUT_DURATION = 30000;
const cooldownDurations = new Map<string, number>([
  ["economy", 2000],
  ["scrape", 10000],
  ["tool", 10000],
  ["fun", 2000],
]);

const handler = async (
  client: Client,
  interaction: Interaction
): Promise<void> => {
  if (!interaction.isChatInputCommand()) return;

  // Import and type the model properly
  const userModel = (await import("../../models/userSchema"))
    .default as Model<IUser>;
  const { JACKO_ID, DEV_ID } = process.env;

  try {
    const localCommands = (await getLocalCommands()) as ExtendedCommand[];
    const commandObject = localCommands.find(
      (cmd) => cmd.name === interaction.commandName
    );

    if (!commandObject) return;

    // Command execution logic with timeout
    const mainLogicPromise = async () => {
      if (commandObject.devOnly && interaction.user.id !== DEV_ID) {
        await interaction.reply({
          content: "Sorry, only developers are allowed to run this command!",
          ephemeral: true,
        });
        return;
      }

      if (commandObject.testOnly && interaction.guildId !== JACKO_ID) {
        await interaction.reply({
          content: "Sorry, this is a test command!",
          ephemeral: true,
        });
        return;
      }

      // Permission checks
      if (commandObject.permissionsRequired?.length) {
        for (const permission of commandObject.permissionsRequired) {
          if (!interaction.memberPermissions?.has(permission)) {
            await interaction.reply({
              content: "Not enough permissions!",
              ephemeral: true,
            });
            return;
          }
        }
      }

      // Get or create user data
      let userData = await userModel.findOne({ userID: interaction.user.id });
      if (!userData && interaction.guild) {
        const serverLocale = interaction.guild.preferredLocale;
        const userLanguage = serverLocale.startsWith("ja") ? "ja" : "en";

        userData = await userModel.create({
          userID: interaction.user.id,
          serverID: interaction.guildId,
          nickname: interaction.user.displayName,
          language: userLanguage,
        });
        await userData.save();
      }

      // Cooldown check
      if (userData && commandObject.category) {
        const cooldownDuration = cooldownDurations.get(commandObject.category);
        if (cooldownDuration) {
          const now = Date.now();
          const userCooldowns = userData.cooldowns || new Map<string, number>();

          if (
            userCooldowns.has(commandObject.category) &&
            userCooldowns.get(commandObject.category)! > now
          ) {
            const remaining = Math.ceil(
              (userCooldowns.get(commandObject.category)! - now) / 1000
            );
            await interaction.reply({
              content: `⏳ You need to wait ${remaining} seconds before using this command again.`,
              ephemeral: true,
            });
            return;
          }

          userCooldowns.set(commandObject.category, now + cooldownDuration);
          userData.cooldowns = userCooldowns;
          await userData.save();
        }
      }

      await commandObject.callback(client, interaction, userData!);
    };

    await Promise.race([
      mainLogicPromise(),
      new Promise((_, reject) =>
        setTimeout(() => reject("Command timed out"), TIMEOUT_DURATION)
      ),
    ]);
  } catch (error) {
    console.error("Error in command execution:", error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "There was an error executing this command!",
        ephemeral: true,
      });
    }
  }
};

export default handler;
