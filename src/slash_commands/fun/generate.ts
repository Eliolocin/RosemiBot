import AI from "stable-diffusion-cjs";
import {
  EmbedBuilder,
  ApplicationCommandOptionType,
  AttachmentBuilder,
  Client,
  ChatInputCommandInteraction,
} from "discord.js";
import { Command, IUser } from "../../types";
import { localizer } from "../../utils/textLocalizer";

const command: Command = {
  name: "generate",
  description:
    "Generate images with Stable Diffusion | Stable Diffusionで画像を生成します",
  options: [
    {
      name: "prompt",
      description: "Please enter the prompt you want to be generated!",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],

  callback: async (
    client: Client,
    interaction: ChatInputCommandInteraction,
    userData: IUser
  ): Promise<void> => {
    const locale = userData.language || "en";

    try {
      await interaction.deferReply();
      const userPrompt = interaction.options.getString("prompt", true);

      // ...existing embed creation code...

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error("Generation timed out after 30 seconds"));
        }, 30000);
      });

      const generatePromise = new Promise((resolve, reject) => {
        AI.generate(userPrompt, (result) => {
          if (result.error) {
            reject(new Error(result.error));
            return;
          }
          if (!result.results || result.results.length === 0) {
            reject(new Error("No images were generated"));
            return;
          }
          resolve(result);
        });
      });

      const result = (await Promise.race([
        generatePromise,
        timeoutPromise,
      ])) as { results: string[] };

      const images = result.results.map((base64Img, idx) => {
        const data = base64Img.split(",")[1];
        return new AttachmentBuilder(Buffer.from(data, "base64"), {
          name: `generated_image_${idx + 1}.png`,
        });
      });

      // ...existing result embed creation and reply code...
    } catch (err) {
      console.error("Error in generate command:", err);
      const errorEmbed = new EmbedBuilder()
        .setColor("#E74C3C")
        .setTitle(localizer(locale, "tool.generate.error"))
        .setDescription(err instanceof Error ? err.message : "Unknown error");

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  },
} as const;

export default command;
