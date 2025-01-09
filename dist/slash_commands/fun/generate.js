"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stable_diffusion_cjs_1 = require("stable-diffusion-cjs");
const discord_js_1 = require("discord.js");
const textLocalizer_1 = require("../../utils/textLocalizer");
const command = {
    name: "generate",
    description: "Generate images with Stable Diffusion | Stable Diffusionで画像を生成します",
    category: "fun",
    options: [
        {
            name: "prompt",
            description: "Generation Prompt | 生成プロンプト",
            type: discord_js_1.ApplicationCommandOptionType.String,
            required: true,
        },
    ],
    callback: async (client, interaction, userData) => {
        const locale = userData.language || "en";
        try {
            await interaction.deferReply();
            const userPrompt = interaction.options.getString("prompt", true);
            const progressEmbed = new discord_js_1.EmbedBuilder()
                .setColor("#FFD700")
                .setTitle((0, textLocalizer_1.localizer)(locale, "fun.generate.progress", { prompt: userPrompt }))
                .setTimestamp();
            await interaction.editReply({ embeds: [progressEmbed] });
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error("Generation timed out after 30 seconds"));
                }, 30000);
            });
            const imageBuffer = await Promise.race([
                (0, stable_diffusion_cjs_1.generate)(userPrompt),
                timeoutPromise,
            ]);
            const attachment = new discord_js_1.AttachmentBuilder(imageBuffer, {
                name: "generated_image.png",
            });
            const resultEmbed = new discord_js_1.EmbedBuilder()
                .setColor("#00FF00")
                .setTitle((0, textLocalizer_1.localizer)(locale, "fun.generate.result", { prompt: userPrompt }))
                .setTimestamp();
            await interaction.editReply({
                embeds: [resultEmbed],
                files: [attachment],
            });
        }
        catch (err) {
            console.error("Error in generate command:", err);
            const errorEmbed = new discord_js_1.EmbedBuilder()
                .setColor("#E74C3C")
                .setTitle((0, textLocalizer_1.localizer)(locale, "fun.generate.error"))
                .setDescription(err instanceof Error ? err.message : "Unknown error");
            await interaction.editReply({ embeds: [errorEmbed] });
        }
    },
};
exports.default = command;
//# sourceMappingURL=generate.js.map