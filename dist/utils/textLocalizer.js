"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.localizer = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// Load language files dynamically
const locales = {};
const localesPath = path_1.default.join(__dirname, "../locales");
// Read all JSON files from locales directory
fs_1.default.readdirSync(localesPath)
    .filter((file) => file.endsWith(".json"))
    .forEach((file) => {
    const locale = path_1.default.basename(file, ".json");
    locales[locale] = require(`../locales/${file}`);
});
/**
 * Get a localized string for a specific key.
 * @param locale - The locale code (e.g., 'en', 'ja').
 * @param key - The key path from the JSON files (e.g., 'commands.deposit.success').
 * @param variables - Key-value pairs to replace placeholders in the localized string.
 * @returns The localized string.
 */
const localizer = (locale, key, variables = {}) => {
    const keys = key.split(".");
    let translation = locales[locale];
    for (const k of keys) {
        if (!translation[k]) {
            return key;
        }
        translation = translation[k];
    }
    let result = translation;
    for (const [placeholder, value] of Object.entries(variables)) {
        result = result.replace(`{${placeholder}}`, String(value));
    }
    return result;
};
exports.localizer = localizer;
//# sourceMappingURL=textLocalizer.js.map