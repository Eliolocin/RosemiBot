import type { SQL } from "bun";
import { jsonb, str } from "./sql";
import { systemPromptSections } from "./systemPrompts";
import type { SystemPromptInput } from "./types";

const SYSTEM_PROMPT_COLUMNS =
  "system_prompt_preset_name, system_prompt_preset_desc, descriptions, display_names, preset_prompt_text";

const SYSTEM_PROMPT_ON_CONFLICT = `ON CONFLICT (system_prompt_preset_name) DO UPDATE SET
  system_prompt_preset_desc = EXCLUDED.system_prompt_preset_desc,
  descriptions = EXCLUDED.descriptions,
  display_names = EXCLUDED.display_names,
  preset_prompt_text = EXCLUDED.preset_prompt_text,
  updated_at = CURRENT_TIMESTAMP`;

function rowsOf(): SystemPromptInput[] {
  return systemPromptSections.flatMap((section) => section.rows);
}

function renderSystemPromptTuple(preset: SystemPromptInput): string {
  return [
    str(preset.name),
    str(preset.desc),
    jsonb({ "en-US": preset.desc, ...preset.i18n }),
    jsonb({ "en-US": preset.name, ...preset.names }),
    str(preset.promptText),
  ].join(", ");
}

export function validateSystemPrompts(): string[] {
  const errors: string[] = [];
  const seenNames = new Set<string>();

  for (const preset of rowsOf()) {
    if (seenNames.has(preset.name)) {
      errors.push(`system_prompt_presets: duplicate system_prompt_preset_name ${preset.name}`);
    }
    seenNames.add(preset.name);

    if (preset.promptText.length === 0) {
      errors.push(`system_prompt_presets/${preset.name}: preset_prompt_text is empty`);
    }
  }

  return errors;
}

export function buildSystemPromptSeedStatements(): string[] {
  const currentPresets = rowsOf();

  if (currentPresets.length === 0) {
    return ["DELETE FROM system_prompt_presets"];
  }

  const values = currentPresets.map((preset) => `  (${renderSystemPromptTuple(preset)})`).join(",\n");

  const validNames = currentPresets.map((preset) => str(preset.name)).join(", ");

  return [
    `INSERT INTO system_prompt_presets (${SYSTEM_PROMPT_COLUMNS})\nVALUES\n${values}\n${SYSTEM_PROMPT_ON_CONFLICT}`,
    `DELETE FROM system_prompt_presets WHERE system_prompt_preset_name NOT IN (${validNames})`,
  ];
}

export async function seedSystemPromptsFromCatalog(client: SQL): Promise<void> {
  const violations = validateSystemPrompts();
  if (violations.length > 0) {
    throw new Error(`System prompt catalog invariant violations:\n  - ${violations.join("\n  - ")}`);
  }

  for (const statement of buildSystemPromptSeedStatements()) {
    await client.unsafe(statement);
  }
}
