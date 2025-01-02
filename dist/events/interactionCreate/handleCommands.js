"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const getLocalCommands_1 = __importDefault(require("../../utils/getLocalCommands"));
const TIMEOUT_DURATION = 30000;
const cooldownDurations = new Map([
    ["economy", 2000],
    ["scrape", 10000],
    ["tool", 10000],
    ["fun", 2000],
]);
const handler = async (client, interaction) => {
    if (!interaction.isChatInputCommand())
        return;
    // Import and type the model properly
    const userModel = (await Promise.resolve().then(() => __importStar(require("../../models/userSchema"))))
        .default;
    const { JACKO_ID, DEV_ID } = process.env;
    try {
        const localCommands = (await (0, getLocalCommands_1.default)());
        const commandObject = localCommands.find((cmd) => cmd.name === interaction.commandName);
        if (!commandObject)
            return;
        // Command execution logic with timeout
        const mainLogicPromise = async () => {
            if (commandObject.devOnly && interaction.user.id !== DEV_ID) {
                await interaction.reply({
                    content: "Sorry, only developers are allowed to run this command!",
                    ephemeral: true,
                });
                return;
            }
            if (commandObject.testOnly && interaction.guildId !== JACKO_ID) {
                await interaction.reply({
                    content: "Sorry, this is a test command!",
                    ephemeral: true,
                });
                return;
            }
            // Permission checks
            if (commandObject.permissionsRequired?.length) {
                for (const permission of commandObject.permissionsRequired) {
                    if (!interaction.memberPermissions?.has(permission)) {
                        await interaction.reply({
                            content: "Not enough permissions!",
                            ephemeral: true,
                        });
                        return;
                    }
                }
            }
            // Get or create user data
            let userData = await userModel.findOne({ userID: interaction.user.id });
            if (!userData && interaction.guild) {
                const serverLocale = interaction.guild.preferredLocale;
                const userLanguage = serverLocale.startsWith("ja") ? "ja" : "en";
                userData = await userModel.create({
                    userID: interaction.user.id,
                    serverID: interaction.guildId,
                    nickname: interaction.user.displayName,
                    language: userLanguage,
                });
                await userData.save();
            }
            // Cooldown check
            if (userData && commandObject.category) {
                const cooldownDuration = cooldownDurations.get(commandObject.category);
                if (cooldownDuration) {
                    const now = Date.now();
                    const userCooldowns = userData.cooldowns || new Map();
                    if (userCooldowns.has(commandObject.category) &&
                        userCooldowns.get(commandObject.category) > now) {
                        const remaining = Math.ceil((userCooldowns.get(commandObject.category) - now) / 1000);
                        await interaction.reply({
                            content: `⏳ You need to wait ${remaining} seconds before using this command again.`,
                            ephemeral: true,
                        });
                        return;
                    }
                    userCooldowns.set(commandObject.category, now + cooldownDuration);
                    userData.cooldowns = userCooldowns;
                    await userData.save();
                }
            }
            await commandObject.callback(client, interaction, userData);
        };
        await Promise.race([
            mainLogicPromise(),
            new Promise((_, reject) => setTimeout(() => reject("Command timed out"), TIMEOUT_DURATION)),
        ]);
    }
    catch (error) {
        console.error("Error in command execution:", error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: "There was an error executing this command!",
                ephemeral: true,
            });
        }
    }
};
exports.default = handler;
