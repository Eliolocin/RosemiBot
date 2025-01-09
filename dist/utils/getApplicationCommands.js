"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const getApplicationCommands = async (client, guildId) => {
    let applicationCommands;
    applicationCommands = await client.application.commands.fetch();
    // Setting commands for only ONE server (in most cases, the testServer)
    if (guildId) {
        // const guild = await client.guilds.fetch(guildId);
        // applicationCommands = guild.commands;
    }
    else {
        // applicationCommands = await client.application!.commands;
    }
    // await applicationCommands.fetch();
    return applicationCommands;
};
exports.default = getApplicationCommands;
//# sourceMappingURL=getApplicationCommands.js.map