const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const Booru = require("booru");
const { Eiyuu } = require("eiyuu");
const { getTranslation } = require("../../utils/textLocalizer");

const resolve = new Eiyuu();
const postfiltering = " score:>=3";

module.exports = {
  name: "rule34",
  description:
    "Retrieve up to 4 random NSFW results for your query from Rule34!",
  options: [
    {
      name: "tags",
      description:
        "Enter tags separated by spaces (e.g. dragon furry dragonite)",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],

  callback: async (client, interaction, profileData) => {
    const locale = profileData.language || "en";

    try {
      await interaction.deferReply();

      if (!interaction.channel.nsfw) {
        const embed = new EmbedBuilder()
          .setColor("#FF0000")
          .setTitle(getTranslation(locale, "scrape.rule34.error_not_nsfw"))
          .setDescription(
            getTranslation(locale, "scrape.rule34.error_not_nsfw_description"),
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
          .setTitle(getTranslation(locale, "scrape.rule34.error_no_results"))
          .setDescription(
            getTranslation(locale, "scrape.rule34.error_no_results", {
              query: userquery,
            }),
          );

        return await interaction.editReply({ embeds: [embed] });
      }

      const embeds = posts.map((post, index) => {
        return new EmbedBuilder()
          .setColor("#FF69B4")
          .setTitle(
            getTranslation(locale, "scrape.rule34.result_title", {
              index: index + 1,
            }),
          )
          .setURL(post.fileUrl)
          .setImage(post.fileUrl)
          .setFooter({
            text: getTranslation(locale, "scrape.rule34.result_footer", {
              tags: userquery,
            }),
          });
      });

      await interaction.editReply({
        content: getTranslation(locale, "scrape.rule34.progress_message"),
        embeds,
      });
    } catch (err) {
      console.error("Error in Rule34 command:", err);
      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle(getTranslation(locale, "scrape.rule34.error_message"))
        .setDescription(err.message);

      await interaction.editReply({ embeds: [embed] });
    }
  },
};
