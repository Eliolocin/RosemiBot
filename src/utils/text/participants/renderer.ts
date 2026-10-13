import {
  buildParticipantTargetIndex,
  buildPurposeCollisionIndex,
  projectConversationUserReferences,
  targetAliasesForPurpose,
  type ParticipantTargetIndex,
} from "@/utils/text/participants/targetIndex";
import type { HydratedParticipantProfile, MessageProxyNamespaceNote } from "@/utils/text/participants/hydration";
import { normalizeParticipantAlias } from "@/utils/text/participants/aliases";
import { serializeParticipantKey } from "@/utils/text/participants/identity";

export interface ParticipantPromptRenderParams {
  profiles: readonly HydratedParticipantProfile[];
  personaTaskLines: readonly string[];
  messageProxyNamespaces?: readonly MessageProxyNamespaceNote[];
  isUserImpersonation: boolean;
  botName: string;
  isDMChannel: boolean;
  channelName: string;
  channelId: string;
  currentTime: string;
  timezoneLabel: string;
  timeOfDayPhrase: string;
}

export interface RenderedParticipantPrompt {
  text: string;
  targetIndex: ParticipantTargetIndex;
  conversationUsers: ReturnType<typeof projectConversationUserReferences>;
}

export function renderParticipantPrompt(params: ParticipantPromptRenderParams): RenderedParticipantPrompt {
  const targetIndex = buildParticipantTargetIndex(params.profiles);
  let text = "[System: The following users are having a conversation:\n\n";
  text += params.isUserImpersonation
    ? 'To ping users, prepend an "@" symbol to a unique mention handle shown below (case-insensitive). If there is ambiguity with names, ask for clarification instead of guessing. Use mentions only when the notification matters.\n\n'
    : `If ${params.botName} wants to ping any of these users, prepend an "@" symbol to a unique mention handle shown below (case-insensitive). If there is ambiguity with names, ask for clarification instead of guessing. Use mentions only when the notification matters.\n\n`;
  text += renderProfileEntries(params.profiles, targetIndex, params.isUserImpersonation);
  text += renderMessageProxyNamespaceNotes(params.messageProxyNamespaces ?? []);
  if (params.personaTaskLines.length > 0) text += `${params.personaTaskLines.join("\n")}\n\n`;
  text += renderChannelTimeFooter(params);
  return {
    text: text.trim(),
    targetIndex,
    conversationUsers: projectConversationUserReferences(targetIndex),
  };
}

function renderMessageProxyNamespaceNotes(namespaces: readonly MessageProxyNamespaceNote[]): string {
  if (namespaces.length === 0) return "";
  const entriesByHeading = new Map<string, string[]>();
  for (const namespace of namespaces) {
    const entries = entriesByHeading.get(namespace.sectionHeading) ?? [];
    entries.push(namespace.entry);
    entriesByHeading.set(namespace.sectionHeading, entries);
  }
  return `${[...entriesByHeading.entries()]
    .map(([heading, entries]) => `${heading}\n${entries.join("\n")}`)
    .join("\n\n")}\n\n`;
}

function renderProfileEntries(
  profiles: readonly HydratedParticipantProfile[],
  targetIndex: ParticipantTargetIndex,
  isUserImpersonation: boolean,
): string {
  const outputCollisions = buildPurposeCollisionIndex(targetIndex, "output_mention");
  const formatMentionHandle = (alias: string) => `@{${alias}}`;
  let text = "";

  for (const profile of profiles) {
    if (profile.isBot) {
      text += `${profile.displayName}${isUserImpersonation ? "" : " (This is you!)"}\n`;
    } else {
      const target = targetIndex.targets.find(
        (candidate) => candidate.serializedKey === serializeParticipantKey(profile.key),
      );
      const targetOutputAliases = target
        ? targetAliasesForPurpose(target, "output_mention")
            .filter((alias) => alias.exposure === "visible")
            .map((alias) => alias.value)
        : [];
      const outputAliases = profile.mentionable || profile.primaryAlias ? targetOutputAliases : [];
      const isAliasUnique = (alias: string) => {
        const normalized = normalizeParticipantAlias(alias);
        return normalized ? (outputCollisions.get(normalized)?.length ?? 0) === 1 : false;
      };
      const uniqueAliases = outputAliases.filter(isAliasUnique);
      const primaryVisibleAlias =
        profile.primaryAlias && isAliasUnique(profile.primaryAlias)
          ? profile.primaryAlias
          : (uniqueAliases.find((alias) => alias !== profile.primaryAlias) ?? null);
      const aliasHandles = uniqueAliases
        .filter((alias) => alias !== primaryVisibleAlias)
        .map((alias) => formatMentionHandle(alias));
      const mentionParts: string[] = [];
      if (profile.mentionable && primaryVisibleAlias) {
        mentionParts.push(`Mention: ${formatMentionHandle(primaryVisibleAlias)}`);
      }
      if (aliasHandles.length > 0) mentionParts.push(`Aliases: ${aliasHandles.join(", ")}`);
      if (profile.mentionable && outputAliases.length > 0 && !primaryVisibleAlias) {
        mentionParts.push("Mention requires clarification");
      }
      text += `${profile.displayName}${mentionParts.length > 0 ? ` (${mentionParts.join("; ")})` : ""}\n`;
    }

    for (const profileField of [...profile.fields].sort((left, right) => left.order - right.order)) {
      if (!profileField.visibility.visible) continue;
      for (const line of profileField.lines) text += `${line}\n`;
    }
    text += "\n";
  }

  return text;
}

function renderChannelTimeFooter(params: ParticipantPromptRenderParams): string {
  const conversationContext = params.isDMChannel
    ? "Conversation context: Direct Message."
    : `Conversation context: #${params.channelName}${params.channelId ? ` (ID: ${params.channelId})` : ""}.`;
  return `${conversationContext}\nCurrent time: ${params.currentTime} (${params.timezoneLabel}), ${params.timeOfDayPhrase}.\n]`;
}
