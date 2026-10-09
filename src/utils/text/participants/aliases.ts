import type { UserRow } from "@/types/db/schema";
import { revealGroupBreakName } from "@/utils/text/groupBreakName";
import { dedupeTriggerWords, normalizeTriggerWord } from "@/utils/text/triggerWords";
import {
  serializeParticipantKey,
  type ParticipantAlias,
  type ParticipantAliasPurpose,
  type ParticipantAliasSource,
  type ParticipantKey,
} from "./identity";

const ALL_DISCORD_USER_OUTPUT_PURPOSES: readonly ParticipantAliasPurpose[] = [
  "output_mention",
  "tool_target",
  "copied_identity",
];

export interface DiscordAliasIdentity {
  displayName?: string | null;
  nickname?: string | null;
  globalName?: string | null;
  username?: string | null;
}

export interface AliasCollision {
  normalized: string;
  aliases: readonly ParticipantAlias[];
  owners: readonly ParticipantKey[];
}

export interface PersonaAliasCatalog {
  aliases: readonly ParticipantAlias[];
  canonicalTrigger: string | null;
}

export function normalizeParticipantAlias(value: string): string {
  return revealGroupBreakName(value).trim().replace(/^@+/u, "").trim().toLowerCase().replace(/\s+/gu, " ");
}

export function createParticipantAlias(params: {
  owner: ParticipantKey;
  value?: string | null;
  source: ParticipantAliasSource;
  purposes: Iterable<ParticipantAliasPurpose>;
  exposure: "visible" | "lookup_only";
  priority: number;
  canonicalValue?: string;
}): ParticipantAlias | null {
  const value = params.value?.trim();
  if (!value) return null;

  const normalized = normalizeParticipantAlias(value);
  if (!normalized) return null;

  return {
    owner: params.owner,
    value,
    normalized,
    source: params.source,
    purposes: new Set(params.purposes),
    exposure: params.exposure,
    priority: params.priority,
    ...(params.canonicalValue && { canonicalValue: params.canonicalValue }),
  };
}

function appendAlias(aliases: ParticipantAlias[], params: Parameters<typeof createParticipantAlias>[0]): void {
  const alias = createParticipantAlias(params);
  if (alias) aliases.push(alias);
}

export function buildDiscordUserAliases(params: {
  owner: Extract<ParticipantKey, { kind: "discord_user" }>;
  userRow: Pick<UserRow, "user_nickname">;
  identity: DiscordAliasIdentity;
  exposeSavedNickname: boolean;
  impersonatedIdentityName?: string | null;
}): ParticipantAlias[] {
  const aliases: ParticipantAlias[] = [];
  const visibleSavedPurposes = params.exposeSavedNickname ? ALL_DISCORD_USER_OUTPUT_PURPOSES : [];

  appendAlias(aliases, {
    owner: params.owner,
    value: params.impersonatedIdentityName,
    source: "impersonated_identity",
    purposes: ALL_DISCORD_USER_OUTPUT_PURPOSES,
    exposure: "visible",
    priority: 0,
  });
  appendAlias(aliases, {
    owner: params.owner,
    value: params.userRow.user_nickname,
    source: "saved_nickname",
    purposes: ["input_reference", ...visibleSavedPurposes],
    exposure: params.exposeSavedNickname ? "visible" : "lookup_only",
    priority: 10,
  });
  appendAlias(aliases, {
    owner: params.owner,
    value: params.identity.displayName,
    source: "guild_display_name",
    purposes: ["input_reference"],
    exposure: "lookup_only",
    priority: 15,
  });
  for (const [value, source, priority] of [
    [params.identity.nickname, "guild_nickname", 20],
    [params.identity.globalName, "global_name", 30],
    [params.identity.username, "username", 40],
  ] as const) {
    appendAlias(aliases, {
      owner: params.owner,
      value,
      source,
      purposes: ["input_reference", ...ALL_DISCORD_USER_OUTPUT_PURPOSES],
      exposure: "visible",
      priority,
    });
  }

  if (!aliases.some((alias) => ALL_DISCORD_USER_OUTPUT_PURPOSES.some((purpose) => alias.purposes.has(purpose)))) {
    appendAlias(aliases, {
      owner: params.owner,
      value: params.owner.discordId,
      source: "discord_id_fallback",
      purposes: ALL_DISCORD_USER_OUTPUT_PURPOSES,
      exposure: "visible",
      priority: 50,
    });
  }

  return aliases;
}

function isDiscordMentionTrigger(value: string): boolean {
  return normalizeTriggerWord(value, { lowercase: false }).startsWith("<@");
}

export function buildPersonaAliases(params: {
  owner: Extract<ParticipantKey, { kind: "persona" }>;
  nickname?: string | null;
  triggerWords?: readonly string[] | null;
}): PersonaAliasCatalog {
  const aliases: ParticipantAlias[] = [];
  const triggers = dedupeTriggerWords(params.triggerWords ?? [], { lowercase: false }).filter(
    (trigger) => !isDiscordMentionTrigger(trigger),
  );
  const nickname = normalizeTriggerWord(params.nickname ?? "", { lowercase: false }).trim();
  const nicknameKey = normalizeParticipantAlias(nickname);
  const canonicalTrigger =
    (triggers.find((trigger) => normalizeParticipantAlias(trigger) === nicknameKey) ?? triggers[0] ?? nickname) || null;

  appendAlias(aliases, {
    owner: params.owner,
    value: nickname,
    source: "persona_nickname",
    purposes: ["output_mention", "tool_target", "copied_identity"],
    exposure: "visible",
    priority: 10,
    ...(canonicalTrigger && { canonicalValue: canonicalTrigger }),
  });
  triggers.forEach((trigger, index) => {
    appendAlias(aliases, {
      owner: params.owner,
      value: trigger,
      source: "persona_trigger",
      purposes: ["output_mention", "persona_trigger"],
      exposure: "visible",
      priority: 20 + index,
      canonicalValue: trigger,
    });
  });

  return { aliases, canonicalTrigger };
}

export function buildBridgeUserAliases(params: {
  owner: Extract<ParticipantKey, { kind: "matrix_user" }>;
  displayName: string;
}): ParticipantAlias[] {
  const alias = createParticipantAlias({
    owner: params.owner,
    value: params.displayName,
    source: "bridge_display_name",
    purposes: ["output_mention", "tool_target"],
    exposure: "lookup_only",
    priority: 10,
  });
  return alias ? [alias] : [];
}

export function buildWebhookAliases(params: {
  owner: Extract<ParticipantKey, { kind: "webhook" }>;
  displayName: string;
}): ParticipantAlias[] {
  const alias = createParticipantAlias({
    owner: params.owner,
    value: params.displayName,
    source: "webhook_display_name",
    purposes: [],
    exposure: "lookup_only",
    priority: 10,
  });
  return alias ? [alias] : [];
}

export function aliasesForPurpose(
  aliases: readonly ParticipantAlias[],
  purpose: ParticipantAliasPurpose,
): ParticipantAlias[] {
  const selected: ParticipantAlias[] = [];
  const seen = new Set<string>();
  for (const alias of [...aliases].sort((left, right) => left.priority - right.priority)) {
    const ownerKey = serializeParticipantKey(alias.owner);
    const dedupeKey = `${ownerKey}\0${alias.normalized}`;
    if (!alias.purposes.has(purpose) || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    selected.push(alias);
  }
  return selected;
}

export function buildAliasCollisionIndex(
  aliases: readonly ParticipantAlias[],
  purpose: ParticipantAliasPurpose,
): Map<string, AliasCollision> {
  const aliasesByNormalized = new Map<string, ParticipantAlias[]>();
  for (const alias of aliasesForPurpose(aliases, purpose)) {
    const matches = aliasesByNormalized.get(alias.normalized) ?? [];
    matches.push(alias);
    aliasesByNormalized.set(alias.normalized, matches);
  }

  return new Map(
    [...aliasesByNormalized].map(([normalized, matches]) => {
      const owners = new Map(matches.map((alias) => [serializeParticipantKey(alias.owner), alias.owner]));
      return [normalized, { normalized, aliases: matches, owners: [...owners.values()] }];
    }),
  );
}
