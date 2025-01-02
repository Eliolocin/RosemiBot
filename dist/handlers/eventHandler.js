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
const path_1 = __importDefault(require("path"));
const getAllFiles_1 = __importDefault(require("../utils/getAllFiles"));
const handleEvent = (client) => {
    const eventFolders = (0, getAllFiles_1.default)(path_1.default.join(__dirname, "..", "events"), true);
    for (const eventFolder of eventFolders) {
        const eventFiles = (0, getAllFiles_1.default)(eventFolder);
        eventFiles.sort((a, b) => a.localeCompare(b));
        const eventName = eventFolder.replace(/\\/g, "/").split("/").pop();
        if (!eventName)
            continue;
        switch (eventName) {
            case "voiceStateUpdate":
                client.on(eventName, async (oldState, newState) => {
                    for (const eventFile of eventFiles) {
                        const eventModule = await Promise.resolve(`${eventFile}`).then(s => __importStar(require(s)));
                        const eventFunction = eventModule.default;
                        if (typeof eventFunction === "function") {
                            await eventFunction(client, oldState, newState);
                        }
                    }
                });
                break;
            case "presenceUpdate":
                client.on(eventName, async (oldPresence, newPresence) => {
                    for (const eventFile of eventFiles) {
                        const eventModule = await Promise.resolve(`${eventFile}`).then(s => __importStar(require(s)));
                        const eventFunction = eventModule.default;
                        if (typeof eventFunction === "function") {
                            await eventFunction(client, oldPresence, newPresence);
                        }
                    }
                });
                break;
            default:
                client.on(eventName, async (arg) => {
                    for (const eventFile of eventFiles) {
                        try {
                            const eventModule = await Promise.resolve(`${eventFile}`).then(s => __importStar(require(s)));
                            const eventFunction = eventModule.default;
                            if (typeof eventFunction === "function") {
                                await eventFunction(client, arg);
                            }
                            else {
                                console.error(`Event file ${eventFile} does not export a default function`);
                            }
                        }
                        catch (error) {
                            console.error(`Error loading event file ${eventFile}:`, error);
                        }
                    }
                });
        }
    }
};
exports.default = handleEvent;
