"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const stable_diffusion_cjs_1 = __importDefault(require("stable-diffusion-cjs"));
const discord_js_1 = require("discord.js");
const textLocalizer_1 = require("../../utils/textLocalizer");
const command = {
    name: "generate",
    description: "Generate images with Stable Diffusion | Stable Diffusionで画像を生成します",
    options: [
        {
            name: "prompt",
            description: "Please enter the prompt you want to be generated!",
            type: discord_js_1.ApplicationCommandOptionType.String,
            required: true,
        },
    ],
    callback: async (client, interaction, userData) => {
        const locale = userData.language || "en";
        try {
            await interaction.deferReply();
            const userPrompt = interaction.options.getString("prompt", true);
            // ...existing embed creation code...
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error("Generation timed out after 30 seconds"));
                }, 30000);
            });
            const generatePromise = new Promise((resolve, reject) => {
                stable_diffusion_cjs_1.default.generate(userPrompt, (result) => {
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
            ]));
            const images = result.results.map((base64Img, idx) => {
                const data = base64Img.split(",")[1];
                return new discord_js_1.AttachmentBuilder(Buffer.from(data, "base64"), {
                    name: `generated_image_${idx + 1}.png`,
                });
            });
            // ...existing result embed creation and reply code...
        }
        catch (err) {
            console.error("Error in generate command:", err);
            const errorEmbed = new discord_js_1.EmbedBuilder()
                .setColor("#E74C3C")
                .setTitle((0, textLocalizer_1.localizer)(locale, "tool.generate.error"))
                .setDescription(err instanceof Error ? err.message : "Unknown error");
            await interaction.editReply({ embeds: [errorEmbed] });
        }
    },
};
exports.default = command;
