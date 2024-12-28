const AI = require("stable-diffusion-cjs");
const { ApplicationCommandOptionType } = require("discord.js");

module.exports = {
  name: "generate",
  description:
    "Quickly generate an image from a prompt using Stable Diffusion!",
  // devOnly: Boolean,
  // testOnly: Boolean,
  // options: Object[],
  // deleted: Boolean,
  options: [
    {
      name: "prompt",
      description: "Please enter the prompt you want to be generated!",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],

  callback: async (client, interaction, profileData) => {
    try {
      await interaction.deferReply();
      const userquery = interaction.options.getString("prompt");

      AI.generate(userquery, async (result) => {
        var uploads = [];
        if (result.error) {
          console.log(result.error);
          return;
        }

        try {
          for (let i = 0; i < result.results.length; i++) {
            let data = result.results[i].split(",")[1];
            const buffer = Buffer.from(data, "base64");
            uploads.push(buffer);
          }
        } catch (e) {
          console.log(e);
        }
        interaction.editReply({
          content:
            "*Here's what I generated for `" + userquery.trim() + "` (b ᵔ▽ᵔ)b*",
          files: uploads,
        });
      });
    } catch (err) {
      console.log("(─‿‿─) I ran into a slash command error: " + err);
    }
  },
};
