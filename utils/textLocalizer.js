const fs = require("fs");
const path = require("path");

// Load language files
const locales = {
  en: require("../locales/en.json"),
  ja: require("../locales/ja.json"),
};

/**
 * Get a localized string for a specific key.
 * @param {string} locale - The locale code (e.g., 'en', 'ja').
 * @param {string} key - The key path from the JSON files (e.g., 'commands.deposit.success').
 * @param {Object} variables - Key-value pairs to replace placeholders in the localized string.
 * @returns {string} The localized string.
 */
const getTranslation = (locale, key, variables = {}) => {
  const keys = key.split(".");
  let translation = locales[locale];

  for (const k of keys) {
    if (!translation[k]) {
      return key; // Key not found, return the key itself for debugging purposes
    }
    translation = translation[k];
  }

  // Replace placeholders (e.g., {amount}) with actual values
  for (const [placeholder, value] of Object.entries(variables)) {
    translation = translation.replace(`{${placeholder}}`, value);
  }

  return translation;
};

module.exports = { getTranslation };
