"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const userSchema_1 = __importDefault(require("../../models/userSchema"));
const getLocalCommands_1 = __importDefault(require("../../utils/getLocalCommands"));
const textLocalizer_1 = require("../../utils/textLocalizer");
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
    const userModel = userSchema_1.default;
    const { TESTSRV_ID, DEV_ID } = process.env;
    let userData = await userModel.findOne({ userID: interaction.user.id });
    try {
        const localCommands = (await (0, getLocalCommands_1.default)());
        const commandObject = localCommands.find((cmd) => cmd.name === interaction.commandName);
        if (!commandObject)
            return;
        // Command execution logic with timeout
        const mainLogicPromise = async () => {
            // Initialize userData if it doesn't exist
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
            if (commandObject.devOnly && interaction.user.id !== DEV_ID) {
                try {
                    await interaction.reply({
                        content: (0, textLocalizer_1.localizer)(userData?.language || "en", "general.errors.dev_only"),
                        ephemeral: true,
                    });
                }
                catch (error) {
                    if (error.code === 10062) {
                        // Interaction expired or invalid after bot restart; ignore
                        return;
                    }
                    console.error("Reply error:", error);
                }
                return;
            }
            if (commandObject.testOnly && interaction.guildId !== TESTSRV_ID) {
                try {
                    await interaction.reply({
                        content: (0, textLocalizer_1.localizer)(userData?.language || "en", "general.errors.test_only"),
                        ephemeral: true,
                    });
                }
                catch (error) {
                    if (error.code === 10062) {
                        // Interaction expired or invalid after bot restart; ignore
                        return;
                    }
                    console.error("Reply error:", error);
                }
                return;
            }
            // Permission checks
            if (commandObject.permissionsRequired?.length) {
                for (const permission of commandObject.permissionsRequired) {
                    if (!interaction.memberPermissions?.has(permission)) {
                        try {
                            await interaction.reply({
                                content: (0, textLocalizer_1.localizer)(userData?.language || "en", "general.errors.insufficient_permissions"),
                                ephemeral: true,
                            });
                        }
                        catch (error) {
                            if (error.code === 10062) {
                                // Interaction expired or invalid after bot restart; ignore
                                return;
                            }
                            console.error("Reply error:", error);
                        }
                        return;
                    }
                }
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
                        try {
                            await interaction.reply({
                                content: (0, textLocalizer_1.localizer)(userData?.language || "en", "general.cooldown", { seconds: remaining }),
                                ephemeral: true,
                            });
                        }
                        catch (error) {
                            if (error.code === 10062) {
                                // Interaction expired or invalid after bot restart; ignore
                                return;
                            }
                            console.error("Reply error:", error);
                        }
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
            new Promise((_, reject) => setTimeout(() => reject((0, textLocalizer_1.localizer)(userData?.language || "en", "general.errors.command_timeout")), TIMEOUT_DURATION)),
        ]);
    }
    catch (error) {
        console.error("Error in command execution:", error);
        if (!interaction.replied && !interaction.deferred) {
            try {
                await interaction.reply({
                    content: (0, textLocalizer_1.localizer)(userData?.language || "en", "general.errors.generic_error"),
                    ephemeral: true,
                });
            }
            catch (error) {
                if (error.code === 10062) {
                    // Interaction expired or invalid after bot restart; ignore
                    return;
                }
                console.error("Reply error:", error);
            }
        }
    }
};
exports.default = handler;
//# sourceMappingURL=handleCommands.js.map