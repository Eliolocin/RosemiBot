import type { TomoriState } from "@/types/db/schema";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { StreamConfig, StreamContext } from "@/types/stream/interfaces";
import { getVisibleDeliveryMode, type TextProcessingConfig } from "@/types/stream/types";
import { normalizeParticipantAlias } from "@/utils/text/participants/aliases";
import {
  buildPurposeCollisionIndex,
  collectParticipantTargetIndex,
  targetAliasesForPurpose,
} from "@/utils/text/participants/targetIndex";

export function createStreamTextProcessingConfig(config: StreamConfig, context: StreamContext): TextProcessingConfig {
  const { mentionMap, mentionIdSet, personaMentionMap } = buildMentionLookup(context.contextItems);
  applyForcedMentions(mentionMap, mentionIdSet, context.forcedMentions);
  const botName = context.prefixStrippingName ?? context.personaUsername ?? context.tomoriState.persona_nickname;

  return {
    humanizerDegree: config.humanizerDegree,
    visibleDeliveryMode: getVisibleDeliveryMode(config.humanizerDegree),
    emojiUsageEnabled: config.emojiUsageEnabled,
    emojiStrings: context.emojiStrings || [],
    mentionMap,
    mentionIdSet,
    personaMentionMap,
    botName,
    botNameAliases: collectPersonaNameAliases(context.tomoriState, botName, context.impersonatedSpeakerLabel),
    registeredSpeakerNamesLower: collectRegisteredSpeakerNames(context.contextItems, botName),
    maxMessageLength: config.maxMessageLength,
    uncensorUnicodeSpacesEnabled: context.tomoriState.config.uncensor_unicode_space_enabled ?? false,
    uncensorSanitizeEnabled: context.tomoriState.config.uncensor_sanitize_enabled ?? false,
  };
}

/**
 * Collects the extra names the active persona answers to beyond its current display name, so the
 * output cleaner can strip a leaked multi-name opening label chain (e.g. "Tomori: Lilya: ...").
 *
 * A bundled persona such as "Shy Tomori (Lilya)" carries its lore/default name ("Tomori") in its
 * description and its configured `trigger_words`, while its webhook nickname is "Lilya". The model
 * then prefixes its turn with *both* labels; only the active name ("Lilya") is otherwise stripped.
 *
 * Sources: the deployment default bot name plus the persona's own trigger words. The active display
 * name (`botName`) is excluded because the cleaner handles it directly. Matching is case-insensitive
 * to avoid emitting a redundant alias.
 *
 * @param botName - The persona's current display name (already handled by the cleaner)
 * @param impersonatedSpeakerLabel - The label a user-impersonation prompt asked the model to open with
 * @returns De-duplicated alias names (excluding the active display name)
 */
export function collectPersonaNameAliases(
  tomoriState: TomoriState,
  botName: string,
  impersonatedSpeakerLabel?: string,
): string[] {
  const botNameLower = botName.trim().toLowerCase();
  const aliases: string[] = [];
  const seen = new Set<string>([botNameLower]);

  const candidates = [
    process.env.DEFAULT_BOTNAME || "Tomori",
    ...(tomoriState.trigger_words ?? []),
    ...(impersonatedSpeakerLabel ? [impersonatedSpeakerLabel] : []),
  ];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    aliases.push(trimmed);
  }

  return aliases;
}

function collectRegisteredSpeakerNames(contextItems: StructuredContextItem[], activeSpeakerName?: string): Set<string> {
  const registeredSpeakerNamesLower = new Set<string>();
  const activeSpeakerNameLower = activeSpeakerName?.trim().toLowerCase();

  for (const item of contextItems) {
    if (item.role !== "user" && item.role !== "model") {
      continue;
    }

    for (const part of item.parts) {
      if (part.type !== "text") {
        continue;
      }

      for (const line of part.text.split("\n")) {
        const match = line.match(/^\s*([^\n:]{1,64}):\s*/);
        const rawName = match?.[1]?.trim();
        if (!rawName || rawName.startsWith("[") || rawName.startsWith("<")) {
          continue;
        }

        const normalizedName = rawName.toLowerCase();
        if (activeSpeakerNameLower && normalizedName === activeSpeakerNameLower) {
          continue;
        }

        registeredSpeakerNamesLower.add(normalizedName);
      }
    }
  }

  return registeredSpeakerNamesLower;
}

function applyForcedMentions(
  mentionMap: Map<string, string[]>,
  mentionIdSet: Set<string>,
  forcedMentions?: Array<{ handle: string; userId: string }>,
): void {
  if (!forcedMentions || forcedMentions.length === 0) return;

  for (const mention of forcedMentions) {
    const handle = mention.handle?.trim();
    const userId = mention.userId?.trim();
    if (!handle || !userId) continue;

    mentionIdSet.add(userId);
    const normalizedHandle = normalizeParticipantAlias(handle);
    const existing = mentionMap.get(normalizedHandle) ?? [];
    if (!existing.includes(userId)) {
      existing.push(userId);
      mentionMap.set(normalizedHandle, existing);
    }
  }
}

/**
 * Builds the static handle→user-ID lookup from `KNOWLEDGE_USERS_IN_CONVERSATION` context items.
 * Shared by the stream text pipeline and message-interaction tools so both resolve @mentions
 * from the same conversation context.
 */
export function buildMentionLookup(contextItems: StructuredContextItem[]): {
  mentionMap: Map<string, string[]>;
  mentionIdSet: Set<string>;
  personaMentionMap: Map<string, string>;
} {
  const mentionMap = new Map<string, string[]>();
  const mentionIdSet = new Set<string>();
  const personaMentionMap = new Map<string, string>();

  const targetIndex = collectParticipantTargetIndex(contextItems);
  const personaAliases = buildPurposeCollisionIndex(targetIndex, "output_mention", (key) => key.kind === "persona");
  for (const [normalized, targets] of personaAliases) {
    if (targets.length !== 1) continue;
    const alias = targetAliasesForPurpose(targets[0], "output_mention").find(
      (candidate) => candidate.normalized === normalized,
    );
    if (alias?.canonicalValue) personaMentionMap.set(normalized, alias.canonicalValue);
  }

  for (const target of targetIndex.targets) {
    if (target.key.kind !== "discord_user" || !target.mentionable || !target.targetId) continue;
    if (!/^\d{17,20}$/.test(target.targetId)) continue;
    mentionIdSet.add(target.targetId);
    for (const alias of targetAliasesForPurpose(target, "output_mention")) {
      const existing = mentionMap.get(alias.normalized) ?? [];
      if (!existing.includes(target.targetId)) existing.push(target.targetId);
      mentionMap.set(alias.normalized, existing);
    }
  }

  for (const item of contextItems) {
    if (item.personaMentionMap) {
      for (const [alias, trigger] of item.personaMentionMap) {
        personaMentionMap.set(alias, trigger);
      }
    }

    if (
      item.participantTargetIndex ||
      item.metadataTag !== ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION ||
      !item.conversationUsers ||
      item.conversationUsers.length === 0
    ) {
      continue;
    }

    for (const conversationUser of item.conversationUsers) {
      if (!conversationUser.mentionable || !/^\d{17,20}$/.test(conversationUser.targetId)) {
        continue;
      }

      mentionIdSet.add(conversationUser.targetId);

      for (const alias of conversationUser.aliases) {
        const normalizedHandle = normalizeParticipantAlias(alias);
        if (!normalizedHandle) {
          continue;
        }

        const existing = mentionMap.get(normalizedHandle) ?? [];
        if (!existing.includes(conversationUser.targetId)) {
          existing.push(conversationUser.targetId);
        }
        mentionMap.set(normalizedHandle, existing);
      }
    }
  }

  return { mentionMap, mentionIdSet, personaMentionMap };
}
