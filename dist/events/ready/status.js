"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const package_json_1 = __importDefault(require("../../../package.json"));
const handler = async (client) => {
    console.log(`${client.user?.tag} is now online!`);
    const status = [
        {
            // Add a “Playing” status with the version from package.json
            name: `v${package_json_1.default.version}`,
            type: discord_js_1.ActivityType.Playing,
        },
        {
            name: "/help",
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
//# sourceMappingURL=status.js.map