import type { TomoriState } from "@/types/db/schema";
import { normalizeRenderModifierName, resolveRenderModifierSourcePersona } from "@/utils/discord/renderModifierParser";
import { resolveSpriteMessageDisplayName } from "@/utils/discord/spriteMessageLabel";

export interface ResolvedWebhookPersonaAuthor {
  persona: TomoriState;
  displayName: string;
}

/**
 * Resolves the persona and display label represented by one webhook author name.
 *
 * A decorated webhook name already contains the display label reconstructed from its render
 * modifier. A clean webhook name needs the persisted sprite mapping instead, because Discord
 * stores the persona name while the context pipeline needs the label the message rendered with.
 * "Persona (neutral)" consults the mapping too, so a real sprite named "neutral" keeps its label
 * while an alter's base-appearance revert reads back as the plain persona name.
 */
export async function resolveWebhookPersonaAuthor(
  messageId: string,
  webhookName: string,
  personaByNickname: Map<string, TomoriState>,
): Promise<ResolvedWebhookPersonaAuthor | null> {
  const renderModifierSource = resolveRenderModifierSourcePersona(webhookName, personaByNickname);
  const persona = renderModifierSource?.persona ?? personaByNickname.get(normalizeRenderModifierName(webhookName));
  if (!persona) return null;

  const spriteDisplayName =
    renderModifierSource && !renderModifierSource.isNeutralAppearance
      ? null
      : await resolveSpriteMessageDisplayName(messageId, persona.persona_id, persona.persona_nickname);

  return {
    persona,
    displayName: spriteDisplayName ?? renderModifierSource?.displayName ?? persona.persona_nickname,
  };
}
