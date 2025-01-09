"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const nana_api_1 = __importDefault(require("nana-api"));
const textLocalizer_1 = require("../../utils/textLocalizer");
const nana = new nana_api_1.default();
const command = {
    name: "doujin",
    description: "Get 4 Random Doujins from Nhentai | Nhentaiから4つのランダムな同人誌を取得します",
    category: "scrape",
    options: [
        {
            name: "random",
            description: "Retrieve 4 random doujins from Nhentai.",
            type: discord_js_1.ApplicationCommandOptionType.Subcommand,
        },
    ],
    callback: async (client, interaction, userData) => {
        const locale = userData.language || "en";
        try {
            await interaction.deferReply();
            const leftButton = new discord_js_1.ButtonBuilder()
                .setLabel("◀ Previous")
                .setStyle(discord_js_1.ButtonStyle.Primary)
                .setCustomId("prev-page")
                .setDisabled(true);
            const rightButton = new discord_js_1.ButtonBuilder()
                .setLabel("Next ▶")
                .setStyle(discord_js_1.ButtonStyle.Primary)
                .setCustomId("next-page");
            const results = [];
            for (let i = 0; i < 4; i++) {
                try {
                    const randomId = Math.floor(Math.random() * 462120);
                    const doujin = await nana.g(randomId);
                    if (doujin) {
                        results.push(doujin);
                    }
                }
                catch (error) {
                    console.error(`Failed to fetch doujin ${i + 1}:`, error);
                    continue;
                }
            }
            if (results.length === 0) {
                throw new Error("Could not fetch any valid results");
            }
            let idx = 0;
            const total = results.length;
            const row = new discord_js_1.ActionRowBuilder().addComponents(leftButton, rightButton);
            const setPage = (index) => {
                const doujin = results[index];
                return new discord_js_1.EmbedBuilder()
                    .setColor("#DE3163")
                    .setTitle((0, textLocalizer_1.localizer)(locale, "scrape.doujin.embed.title", {
                    title: locale === 'ja' ? doujin.title.japanese || doujin.title.english : doujin.title.english,
                    index: index + 1,
                    total,
                }))
                    .setURL(`https://nhentai.net/g/${doujin.id}/`)
                    .setImage(`https://t.nhentai.net/galleries/${doujin.media_id}/thumb.jpg`)
                    .setFooter({
                    text: (0, textLocalizer_1.localizer)(locale, "scrape.doujin.footer_tags", {
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
                componentType: discord_js_1.ComponentType.Button,
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
        }
        catch (err) {
            console.error("Error in Doujin command:", err);
            const embed = new discord_js_1.EmbedBuilder()
                .setColor("#FF0000")
                .setTitle((0, textLocalizer_1.localizer)(locale, "scrape.doujin.error_no_results"))
                .setDescription(err instanceof Error ? err.message : "Unknown error");
            await interaction.editReply({ embeds: [embed] });
        }
    },
};
exports.default = command;
//# sourceMappingURL=doujin.js.map