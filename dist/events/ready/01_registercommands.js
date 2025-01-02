"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const getApplicationCommands_1 = __importDefault(require("../../utils/getApplicationCommands"));
const getLocalCommands_1 = __importDefault(require("../../utils/getLocalCommands"));
const areCommandsDifferent_1 = __importDefault(require("../../utils/areCommandsDifferent"));
const handler = async (client) => {
    const testServer = process.env.JACKO_ID;
    try {
        const localCommands = (await (0, getLocalCommands_1.default)());
        const applicationCommandManager = await (0, getApplicationCommands_1.default)(client, testServer);
        for (const localCommand of localCommands) {
            const { name, description, options } = localCommand;
            const existingCommand = applicationCommandManager.find((cmd) => cmd.name === name);
            if (existingCommand) {
                if (localCommand.deleted) {
                    await applicationCommandManager.delete(existingCommand.id);
                    console.log(`(Deleted command "${name}")`);
                    continue;
                }
                if ((0, areCommandsDifferent_1.default)(existingCommand, localCommand)) {
                    const commandData = {
                        name,
                        description,
                        options: options,
                    };
                    await client.application?.commands.edit(existingCommand.id, commandData);
                }
            }
            else {
                if (localCommand.deleted) {
                    console.log(`(Skipping registering command "${name}" as it's set to be deleted)`);
                    continue;
                }
                const commandData = {
                    name,
                    description,
                    options: options,
                };
                await client.application?.commands.create(commandData);
                console.log(`(Registered command "${name}")`);
            }
        }
    }
    catch (error) {
        console.log(`(─‿‿─) There was a slash command registration error: ${error instanceof Error ? error.message : String(error)}`);
    }
};
exports.default = handler;
