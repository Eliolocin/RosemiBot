"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const handler = async (client) => {
    console.log(`${client.user?.tag} up and growing!`);
    const status = [
        {
            name: "Kawaii Future Bass music",
            type: discord_js_1.ActivityType.Listening,
        },
        {
            name: "=help",
            type: discord_js_1.ActivityType.Listening,
        },
        // ...existing status entries...
    ];
    setInterval(() => {
        const random = Math.floor(Math.random() * status.length);
        client.user?.setActivity(status[random]);
    }, 600000);
    client.user?.setActivity(status[1]);
};
exports.default = handler;
