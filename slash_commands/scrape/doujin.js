const {
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ComponentType,
} = require("discord.js");
const NanaAPI = require("nana-api");
const { localizer } = require("../../utils/textLocalizer");

const nana = new NanaAPI();

const leftButton = new ButtonBuilder()
  .setLabel("◀ Previous")
  .setStyle(ButtonStyle.Primary)
  .setCustomId("prev-page")
  .setDisabled(true);

const rightButton = new ButtonBuilder()
  .setLabel("Next ▶")
  .setStyle(ButtonStyle.Primary)
  .setCustomId("next-page");

module.exports = {
  name: "doujin",
  description:
    "Get 4 Random Doujins from Nhentai | Nhentaiから4つのランダムな同人誌を取得します",
  options: [
    {
      name: "random",
      description: "Retrieve 4 random doujins from Nhentai.",
      type: 1, // Subcommand
    },
  ],

  callback: async (client, interaction, userData) => {
    const locale = userData.language || "en";

    try {
      await interaction.deferReply();

      const results = [];
      for (let i = 0; i < 4; i++) {
        const randomId = Math.floor(Math.random() * 462120);
        const doujin = await nana.g(randomId);
        results.push(doujin);
      }

      let idx = 0;
      const total = results.length;
      const row = new ActionRowBuilder().addComponents(leftButton, rightButton);

      const setPage = (index) => {
        const doujin = results[index];
        return new EmbedBuilder()
          .setColor("#DE3163")
          .setTitle(
            localizer(locale, "scrape.doujin.embed.title", {
              index: index + 1,
              total,
            })
          )
          .setURL(`https://nhentai.net/g/${doujin.id}/`)
          .setImage(
            `https://t.nhentai.net/galleries/${doujin.media_id}/thumb.jpg`
          )
          .setFooter({
            text: localizer(locale, "scrape.doujin.footer_tags", {
              tags: doujin.tags.map((tag) => tag.name).join(", "),
            }),
          });
      };

      let embed = setPage(idx);

      const reply = await interaction.editReply({
        embeds: [embed],
        components: [row],
      });

      const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 30000,
      });

      collector.on("collect", async (button) => {
        idx += button.customId === "prev-page" ? -1 : 1;
        leftButton.setDisabled(idx === 0);
        rightButton.setDisabled(idx === total - 1);

        const newEmbed = setPage(idx);
        await button.update({ embeds: [newEmbed], components: [row] });
      });

      collector.on("end", async () => {
        leftButton.setDisabled(true);
        rightButton.setDisabled(true);
        await interaction.editReply({ components: [row] });
      });
    } catch (err) {
      console.error("Error in Doujin command:", err);
      const embed = new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle(localizer(locale, "scrape.doujin.error_no_results"))
        .setDescription(err.message);

      await interaction.editReply({ embeds: [embed] });
    }
  },
};
