// Deprecated catalog codenames that DeepSeek serves as deepseek-flash. The llms rows stay so
// existing server configs keep their FK, but the wire name must be current: DeepSeek 400s on
// deepseek-v4-flash-vision (never a first-party ID) and retired deepseek-chat and deepseek-reasoner
// outright. Those two were Flash's non-thinking and thinking modes, which `thinking_level` now selects.
const DEEPSEEK_API_MODEL_ALIASES: Readonly<Record<string, string>> = {
  "deepseek-chat": "deepseek-flash",
  "deepseek-reasoner": "deepseek-flash",
  "deepseek-v4-flash": "deepseek-flash",
  "deepseek-v4-flash-vision": "deepseek-flash",
  "deepseek-v4-flash-vision-exp": "deepseek-flash",
};

/**
 * Maps a DeepSeek catalog codename to the model name the DeepSeek API accepts.
 * @param model - The `llm_codename` stored on the llms row.
 * @returns The current API model name, or the trimmed codename when it has no alias.
 */
export function toDeepseekApiModelName(model: string): string {
  const trimmed = model.trim();
  return DEEPSEEK_API_MODEL_ALIASES[trimmed] ?? trimmed;
}
