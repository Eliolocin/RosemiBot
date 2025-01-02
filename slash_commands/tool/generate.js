const AI = require("stable-diffusion-cjs");
const {
  EmbedBuilder,
  ApplicationCommandOptionType,
  AttachmentBuilder,
} = require("discord.js");
const { localizer } = require("../../utils/textLocalizer");

module.exports = {
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

  callback: async (client, interaction, userData) => {
    const locale = userData.language || "en";
    try {
      await interaction.deferReply();

      const userPrompt = interaction.options.getString("prompt");
      const progressEmbed = new EmbedBuilder()
        .setColor("#3498DB")
        .setTitle(localizer(locale, "tool.generate.description"))
        .setDescription(
          localizer(locale, "tool.generate.progress", {
            prompt: userPrompt,
          })
        );

      await interaction.editReply({ embeds: [progressEmbed] });

      AI.generate(userPrompt, async (result) => {
        if (result.error) {
          throw new Error(result.error);
        }

        const images = result.results.map((base64Img, idx) => {
          const data = base64Img.split(",")[1];
          return new AttachmentBuilder(Buffer.from(data, "base64"), {
            name: `generated_image_${idx + 1}.png`,
          });
        });

        const resultEmbed = new EmbedBuilder()
          .setColor("#2ECC71")
          .setTitle(localizer(locale, "tool.generate.result"))
          .setDescription(
            localizer(locale, "tool.generate.result", {
              prompt: userPrompt,
            })
          );

        await interaction.editReply({
          embeds: [resultEmbed],
          files: images,
        });
      });
    } catch (err) {
      console.error("Error in generate command:", err);

      const errorEmbed = new EmbedBuilder()
        .setColor("#E74C3C")
        .setTitle(localizer(locale, "tool.generate.error"))
        .setDescription(err.message);

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  },
};
