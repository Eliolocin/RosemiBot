const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const Booru = require("booru");
const { Eiyuu } = require("eiyuu");
const { localizer } = require("../../utils/textLocalizer");

const resolve = new Eiyuu();
const postfiltering = " score:>=3";

module.exports = {
  name: "rule34",
  description:
    "Retrieve 4 Search Results from Rule34 | Rule34から検索結果を4つ取得します",
  options: [
    {
      name: "tags",
      description:
        "Enter tags separated by spaces (e.g. dragon furry dragonite)",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],

  callback: async (client, interaction, userData) => {
    const locale = userData.language || "en";

    try {
      await interaction.deferReply();

      if (!interaction.channel.nsfw) {
        const embed = new EmbedBuilder()
          .setColor("#FF0000")
          .setTitle(localizer(locale, "scrape.rule34.error_not_nsfw"))
          .setDescription(
            localizer(locale, "scrape.rule34.error_not_nsfw_description")
          );

        return interaction.editReply({ embeds: [embed] });
      }

      const userquery = interaction.options.getString("tags");
      const tags = userquery.split(" ");
      let finalquery = "";

      // Resolve tags for accuracy
      for (const tag of tags) {
        const resolvedTags = await resolve.rule34(tag.replace(/\s/g, "_"));
        finalquery += ` ${resolvedTags[0]}`;
      }

      const filteredQuery = `${finalquery} ${postfiltering}`;
      const rule34 = Booru.forSite("rule34");
      const posts = await rule34.search(filteredQuery, {
        limit: 4,
        random: true,
      });

      if (!posts.length) {
        const embed = new EmbedBuilder()
          .setColor("#FF0000")
          .setTitle(localizer(locale, "scrape.rule34.error_no_results"))
          .setDescription(
            localizer(locale, "scrape.rule34.error_no_results", {
              query: userquery,
            })
          );

        return await interaction.editReply({ embeds: [embed] });
      }

      const embeds = posts.map((post, index) => {
        return new EmbedBuilder()
          .setColor("#FF69B4")
          .setTitle(
            localizer(locale, "scrape.rule34.result_title", {
              index: index + 1,
            })
          )
          .setURL(post.fileUrl)
          .setImage(post.fileUrl)
          .setFooter({
            text: localizer(locale, "scrape.rule34.result_footer", {
              tags: userquery,
            }),
          });
      });

      await interaction.editReply({
        content: localizer(locale, "scrape.rule34.progress_message"),
        embeds,
      });
    } catch (err) {
      console.error("Error in Rule34 command:", err);
      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle(localizer(locale, "scrape.rule34.error_message"))
        .setDescription(err.message);

      await interaction.editReply({ embeds: [embed] });
    }
  },
};
