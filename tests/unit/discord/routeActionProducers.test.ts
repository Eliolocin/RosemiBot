import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { CONFIG_ROUTE_CODECS } from "@/utils/discord/configPanelCatalog";
import { MEMORIES_ROUTE_CODECS } from "@/utils/discord/memoriesPanelCatalog";
import { PERSONAL_CONFIG_ROUTE_CODECS } from "@/utils/discord/personalConfigPanelCatalog";
import { PERSONAL_MEMORIES_ROUTE_CODECS } from "@/utils/discord/personalMemoriesPanelCatalog";
import { PROVIDERS_ROUTE_CODECS } from "@/utils/discord/providersPanelCatalog";

interface CatalogCase {
  name: string;
  actions: readonly string[];
  module: string;
  retained: Readonly<Record<string, string>>;
}

const LEGACY_MESSAGE = "a panel message sent before this action was retired can still send it";

// Moderation is left out because it builds its actions through lookup maps this literal scan cannot read.
const CATALOGS: readonly CatalogCase[] = [
  {
    name: "config",
    actions: Object.keys(CONFIG_ROUTE_CODECS),
    module: "configPanelCatalog",
    retained: {
      "voice-provider-clear":
        "configVoicePanel builds it through its clearActions list, which the literal scan cannot read",
    },
  },
  {
    name: "memories",
    actions: Object.keys(MEMORIES_ROUTE_CODECS),
    module: "memoriesPanelCatalog",
    retained: {},
  },
  {
    name: "personal-config",
    actions: Object.keys(PERSONAL_CONFIG_ROUTE_CODECS),
    module: "personalConfigPanelCatalog",
    retained: {
      "crossserver-toggle": LEGACY_MESSAGE,
      "randomizer-toggle": LEGACY_MESSAGE,
    },
  },
  {
    name: "personal-memories",
    actions: Object.keys(PERSONAL_MEMORIES_ROUTE_CODECS),
    module: "personalMemoriesPanelCatalog",
    retained: {},
  },
  {
    name: "providers",
    actions: Object.keys(PROVIDERS_ROUTE_CODECS),
    module: "providersPanelCatalog",
    retained: {
      "range-open": LEGACY_MESSAGE,
      "range-page": LEGACY_MESSAGE,
      "range-cancel": LEGACY_MESSAGE,
      "model-open": LEGACY_MESSAGE,
      "model-close": LEGACY_MESSAGE,
    },
  },
];

function collectSources(directory: string): Array<{ path: string; text: string }> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "locales" ? [] : collectSources(path);
    return entry.name.endsWith(".ts") ? [{ path, text: readFileSync(path, "utf8") }] : [];
  });
}

const SOURCES = collectSources(join(import.meta.dir, "../../../src"));

// A value followed by `;` or `|` is a type declaration rather than a producer, so the terminator excludes it.
function producedActions(module: string): { literals: Set<string>; prefixes: string[] } {
  const literals = new Set<string>();
  const prefixes: string[] = [];
  const files = SOURCES.filter(
    (file) => file.path.endsWith(`${module}.ts`) || file.text.includes(`@/utils/discord/${module}"`),
  );
  for (const file of files) {
    for (const match of file.text.matchAll(/\baction:\s*([^,;|}\n]+?)\s*[,}\n]/g)) {
      const expression = match[1] ?? "";
      for (const literal of expression.matchAll(/"([a-z0-9-]+)"/g)) literals.add(literal[1] ?? "");
      const template = expression.match(/^`([a-z0-9-]+)\$\{/);
      if (template?.[1]) prefixes.push(template[1]);
    }
  }
  return { literals, prefixes };
}

describe("route action producers", () => {
  it("gives every declared action a producer or a reasoned retention entry", () => {
    const failures: string[] = [];
    for (const catalog of CATALOGS) {
      const { literals, prefixes } = producedActions(catalog.module);
      for (const action of catalog.actions) {
        const produced = literals.has(action) || prefixes.some((prefix) => action.startsWith(prefix));
        const retained = action in catalog.retained;
        if (!produced && !retained) failures.push(`${catalog.name}: ${action} has no producer`);
        if (produced && retained) failures.push(`${catalog.name}: ${action} is produced, so drop its retention entry`);
      }
      for (const action of Object.keys(catalog.retained)) {
        if (!catalog.actions.includes(action)) failures.push(`${catalog.name}: retained ${action} is not declared`);
      }
    }
    expect(failures).toEqual([]);
  });
});
