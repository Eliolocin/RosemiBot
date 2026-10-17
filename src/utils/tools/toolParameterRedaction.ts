export function redactToolParametersForStorage(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName === "generate_voice_message") {
    return {
      script_characters: typeof args.script === "string" ? args.script.length : 0,
      instruction_characters: typeof args.voice_instructions === "string" ? args.voice_instructions.length : 0,
    };
  }
  if (toolName !== "update_user_info") return args;

  // Derive submitted value fields by exclusion so future user-info fields cannot leak into diagnostic storage.
  const { target_user: targetUser, clear, ...values } = args;
  const changedFields = Object.keys(values);
  const clearedFields = Array.isArray(clear) ? clear.filter((field): field is string => typeof field === "string") : [];

  return {
    ...(typeof targetUser === "string" ? { target_user: targetUser } : {}),
    ...(changedFields.length > 0 ? { changed_fields: changedFields } : {}),
    ...(clearedFields.length > 0 ? { cleared_fields: clearedFields } : {}),
  };
}
