import { isManagedWebhookMessage } from "@/utils/chat/webhookIdentity";
import type { Message } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { isMatrixBridgeWebhookUsername } from "@/utils/bridges";
import { normalizeRenderModifierName, resolveRenderModifierSourcePersona } from "@/utils/discord/renderModifierParser";

export interface PersonaTurnBlockResult {
  blockMessages: Message[];
  resolvedPersona: TomoriState | null;
  targetPersonaKey: string | null;
}

/**
 * Walks chronological channel history from newest to oldest and finds the last
 * contiguous message block sent by a known Tomori persona.
 */
export function findLastPersonaTurnBlock(options: {
  messages: Message[];
  allPersonas: TomoriState[];
  clientUserId?: string;
  targetPersonaId?: number;
}): PersonaTurnBlockResult {
  const { messages, allPersonas, clientUserId, targetPersonaId } = options;
  const personaByNickname = new Map<string, TomoriState>(
    allPersonas.map((persona) => [normalizeRenderModifierName(persona.persona_nickname), persona]),
  );
  const mainPersona = allPersonas.find((persona) => !persona.is_alter) ?? null;
  const requestedPersona = targetPersonaId
    ? (allPersonas.find((persona) => persona.persona_id === targetPersonaId) ?? null)
    : null;

  let targetPersonaKey = requestedPersona ? normalizeRenderModifierName(requestedPersona.persona_nickname) : null;
  let resolvedPersona = requestedPersona;
  const blockMessages: Message[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;

    if (!msg.webhookId) {
      if (clientUserId && msg.author.id === clientUserId && !msg.content.trim() && msg.embeds.length > 0) {
        if (blockMessages.length > 0) {
          blockMessages.push(msg);
        }
        continue;
      }

      if (clientUserId && msg.author.id === clientUserId && mainPersona) {
        const mainKey = normalizeRenderModifierName(mainPersona.persona_nickname);
        if (targetPersonaKey === null) {
          targetPersonaKey = mainKey;
          resolvedPersona = mainPersona;
          blockMessages.push(msg);
          continue;
        }

        if (targetPersonaKey === mainKey) {
          blockMessages.push(msg);
          continue;
        }
      }

      if (blockMessages.length > 0) break;
      continue;
    }

    if (!isManagedWebhookMessage(msg) || isMatrixBridgeWebhookUsername(msg.author.username)) {
      if (blockMessages.length > 0) break;
      continue;
    }

    const renderModifierSource = resolveRenderModifierSourcePersona(msg.author.username, personaByNickname);
    const lookupKey = renderModifierSource
      ? normalizeRenderModifierName(renderModifierSource.persona.persona_nickname)
      : normalizeRenderModifierName(msg.author.username);
    const matchedPersona = renderModifierSource?.persona ?? personaByNickname.get(lookupKey);

    if (!matchedPersona) {
      if (blockMessages.length > 0) break;
      continue;
    }

    if (targetPersonaKey === null) {
      targetPersonaKey = lookupKey;
      resolvedPersona = matchedPersona;
      blockMessages.push(msg);
    } else if (lookupKey === targetPersonaKey) {
      blockMessages.push(msg);
    } else if (blockMessages.length > 0) {
      break;
    }
  }

  return {
    blockMessages,
    resolvedPersona,
    targetPersonaKey,
  };
}

export function findLastActivePersona(options: {
  messages: Message[];
  allPersonas: TomoriState[];
  clientUserId?: string;
}): TomoriState | null {
  return findLastPersonaTurnBlock(options).resolvedPersona;
}
