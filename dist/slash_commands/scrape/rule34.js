"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const booru_1 = __importDefault(require("booru"));
const eiyuu_1 = require("eiyuu");
const textLocalizer_1 = require("../../utils/textLocalizer");
const formatSource_1 = require("../../utils/formatSource");
const resolve = new eiyuu_1.Eiyuu();
const postfiltering = " score:>=3";
const command = {
    name: "rule34",
    description: "Retrieve 4 Search Results from Rule34 | Rule34から検索結果を4つ取得します",
    category: "scrape",
    options: [
        {
            name: "tags",
            description: "Enter tags separated by commas | タグをカンマで区切って入力してください",
            type: discord_js_1.ApplicationCommandOptionType.String,
            required: true,
        },
    ],
    callback: async (client, interaction, userData) => {
        const locale = userData.language || "en";
        try {
            // NSFW Check
            const channel = interaction.channel;
            if (!channel?.isTextBased() ||
                !(channel instanceof discord_js_1.TextChannel) ||
                !channel.nsfw) {
                const embed = new discord_js_1.EmbedBuilder()
                    .setColor("#FF0000")
                    .setTitle((0, textLocalizer_1.localizer)(locale, "scrape.rule34.error_not_nsfw"));
                await interaction.reply({ embeds: [embed], ephemeral: true });
                return;
            }
            await interaction.deferReply();
            const userquery = interaction.options.getString("tags", true); // Mark as required
            const tags = userquery.split(",").map((tag) => tag.trim());
            let finalQuery = "";
            for (const tag of tags) {
                const resolvedTags = await resolve.rule34(tag.replace(/\s+/g, "_"));
                finalQuery += ` ${resolvedTags[0]}`;
            }
            const filteredQuery = `${finalQuery} ${postfiltering}`;
            const queryEmbed = new discord_js_1.EmbedBuilder()
                .setColor("#00FF00")
                .setTitle((0, textLocalizer_1.localizer)(locale, "scrape.booru.query_comparison_title"))
                .setDescription((0, textLocalizer_1.localizer)(locale, "scrape.booru.query_comparison_description", {
                original: userquery,
                filtered: finalQuery.trim(),
            }));
            await interaction.editReply({ embeds: [queryEmbed] });
            const booru = (0, booru_1.default)("rule34");
            const posts = await booru.search(filteredQuery.trim().split(/\s+/), {
                limit: 4,
                random: true,
            });
            const booruPosts = posts.map((post) => ({
                fileUrl: post.fileUrl,
                source: typeof post.source === "string" ? post.source : post.fileUrl,
                id: post.id,
                tags: Array.isArray(post.tags) ? post.tags.join(", ") : post.tags,
                score: post.score,
                rating: post.rating,
                createdAt: post.createdAt ? new Date(post.createdAt) : new Date(),
                postView: post.postView,
            }));
            if (!booruPosts.length) {
                const embed = new discord_js_1.EmbedBuilder()
                    .setColor("#FF0000")
                    .setTitle((0, textLocalizer_1.localizer)(locale, "scrape.booru.error_no_results"))
                    .setDescription((0, textLocalizer_1.localizer)(locale, "scrape.booru.error_no_results", {
                    query: userquery,
                }));
                await interaction.editReply({ embeds: [embed] });
                return;
            }
            const embeds = booruPosts.map((post, index) => new discord_js_1.EmbedBuilder()
                .setColor("#FF69B4")
                .setTitle((0, textLocalizer_1.localizer)(locale, "scrape.rule34.result_title", {
                source: (0, formatSource_1.getFormattedSource)(post.source),
            }))
                .setURL(post.source || post.fileUrl)
                .setImage(post.fileUrl)
                .setFooter({
                text: (0, textLocalizer_1.localizer)(locale, "scrape.rule34.result_footer", {
                    score: post.score,
                    tags: userquery,
                }),
            }));
            await interaction.editReply({
                embeds,
            });
        }
        catch (err) {
            console.error("Error in Booru command:", err);
            const embed = new discord_js_1.EmbedBuilder()
                .setColor("#FF0000")
                .setTitle((0, textLocalizer_1.localizer)(locale, "scrape.booru.error_message"))
                .setDescription(err instanceof Error ? err.message : "Unknown error");
            await interaction.editReply({ embeds: [embed] });
        }
    },
};
exports.default = command;
//# sourceMappingURL=rule34.js.map