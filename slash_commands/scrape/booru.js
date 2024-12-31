const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const Booru = require("booru");
const { Eiyuu } = require("eiyuu");
const { getTranslation } = require("../../utils/textLocalizer");

const resolve = new Eiyuu();
const postfiltering = " score:>=3 -nude -rating:explicit -nipples -pubic_hair";

module.exports = {
  name: "booru",
  description:
    "Quickly get up to 4 random SFW high-quality results for your query from Gelbooru!",
  options: [
    {
      name: "tags",
      description:
        "Enter tags separated by spaces (for example: cat cute smile)",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],

  callback: async (client, interaction, profileData) => {
    const locale = profileData.language || "en";

    try {
      await interaction.deferReply();
      const userquery = interaction.options.getString("tags");
      const tags = userquery.split(" ");
      const queries = [];
      let finalquery = "";

      // Resolve tags with Eiyuu for more accurate results
      for (const tag of tags) {
        const resolvedTags = await resolve.gelbooru(tag.replace(/\s/g, "_"));
        finalquery += ` ${resolvedTags[0]}`;
      }

      const filteredQuery = `${finalquery} ${postfiltering}`;
      const gelbooru = Booru.forSite("gelbooru");
      const posts = await gelbooru.search(filteredQuery, {
        limit: 4,
        random: true,
      });

      if (!posts.length) {
        const embed = new EmbedBuilder()
          .setColor("#FF0000")
          .setTitle(getTranslation(locale, "scrape.booru.error_no_results"))
          .setDescription(
            getTranslation(locale, "scrape.booru.error_no_results", {
              query: userquery,
            }),
          );

        return await interaction.editReply({ embeds: [embed] });
      }

      const embeds = posts.map((post, index) => {
        return new EmbedBuilder()
          .setColor("#00FF00")
          .setTitle(
            getTranslation(locale, "scrape.booru.result_title", {
              index: index + 1,
            }),
          )
          .setURL(post.fileUrl)
          .setImage(post.fileUrl)
          .setFooter({
            text: getTranslation(locale, "scrape.booru.result_footer", {
              tags: userquery,
            }),
          });
      });

      await interaction.editReply({
        content: getTranslation(locale, "scrape.booru.progress_message"),
        embeds,
      });
    } catch (err) {
      console.error("Error in Booru command:", err);
      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle(getTranslation(locale, "scrape.booru.error_message"))
        .setDescription(err.message);

      await interaction.editReply({ embeds: [embed] });
    }
  },
};
