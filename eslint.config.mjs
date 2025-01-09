import globals from "globals";
import pluginJs from "@eslint/js";
import pluginTs from "@typescript-eslint/eslint-plugin";
import parserTs from "@typescript-eslint/parser";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    files: ["**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.node,  // Add Node.js globals
        process: true     // Explicitly allow process
      }
    }
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: parserTs,
      sourceType: "module",
      globals: {
        ...globals.node,  // Add Node.js globals
        process: true     // Explicitly allow process
      }
    },
    plugins: {
      "@typescript-eslint": pluginTs
    },
    rules: {
      ...pluginTs.configs.recommended.rules
    }
  },
  pluginJs.configs.recommended
];