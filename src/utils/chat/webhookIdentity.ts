import type { Client, Guild, Message } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { extractBridgeUserId, stripBridgePrefix } from "@/utils/bridges";
import { normalizeRenderModifierName, resolveRenderModifierSourcePersona } from "@/utils/discord/renderModifierParser";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";
import { getCachedManagedWebhookForChannel } from "@/utils/discord/webhook/webhookCore";

let managedMessageTrust = new WeakMap<Message, boolean>();

/** Threads inherit their parent's managed webhook; a name or avatar never proves provenance. */
export async function verifyMessageWebhook(message: Message): Promise<boolean> {
  if (!message.webhookId || !message.guildId) return false;
  const cached = managedMessageTrust.get(message);
  if (cached !== undefined) return cached;
  const channelId = message.channel.isThread() ? message.channel.parentId : message.channelId;
  if (!channelId) return false;
  try {
    const webhook = getCachedManagedWebhookForChannel(channelId, message.webhookId);
    if (webhook && webhook.guildId === message.guildId && webhook.channelId === channelId) {
      managedMessageTrust.set(message, true);
      return true;
    }
    const row = await serverRepository.loadManagedWebhookByChannelAndWebhookId(channelId, message.webhookId);
    const trusted = Boolean(
      row &&
        row.guild_disc_id === message.guildId &&
        row.channel_disc_id === channelId &&
        row.webhook_disc_id === message.webhookId,
    );
    managedMessageTrust.set(message, trusted);
    return trusted;
  } catch {
    return false;
  }
}

/** Synchronous trigger planning consumes only identity already verified during admission. */
export function isManagedWebhookMessage(message: Message): boolean {
  return Boolean(message.webhookId && managedMessageTrust.get(message));
}

const USER_IMPERSONATION_WEBHOOK_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CachedWebhookRelayKind = "user_impersonation";

type CachedWebhookRelay = {
  userId: string;
  kind: CachedWebhookRelayKind;
  cachedAt: number;
};

const webhookRelayCache = new Map<string, CachedWebhookRelay>();

function cacheWebhookRelay(webhookId: string, userId: string, kind: CachedWebhookRelayKind): void {
  if (!webhookId || !userId) {
    return;
  }

  webhookRelayCache.set(webhookId, {
    userId,
    kind,
    cachedAt: Date.now(),
  });
}

export function cacheUserImpersonationWebhook(webhookId: string, userId: string): void {
  cacheWebhookRelay(webhookId, userId, "user_impersonation");
}

export function clearWebhookIdentityCache(): void {
  webhookRelayCache.clear();
  managedMessageTrust = new WeakMap();
}

export function getWebhookIdentityCacheSize(): number {
  return webhookRelayCache.size;
}

function getCachedWebhookRelay(webhookId: string | null | undefined): CachedWebhookRelay | null {
  if (!webhookId) {
    return null;
  }

  const cached = webhookRelayCache.get(webhookId);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.cachedAt > USER_IMPERSONATION_WEBHOOK_CACHE_TTL_MS) {
    webhookRelayCache.delete(webhookId);
    return null;
  }

  return cached;
}

export function getCachedImpersonatedUserIdForWebhook(webhookId: string | null | undefined): string | null {
  const cachedRelay = getCachedWebhookRelay(webhookId);
  if (!cachedRelay || cachedRelay.kind !== "user_impersonation") {
    return null;
  }

  return cachedRelay.userId;
}

function normalizeIdentityName(value?: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeAvatarUrlForMatch(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    parsed.search = "";
    return parsed.toString();
  } catch {
    const trimmed = value.split("?")[0]?.trim();
    return trimmed || null;
  }
}

function resolvePersonaByWebhookName(
  rawWebhookName: string | null | undefined,
  personaByNickname: Map<string, TomoriState>,
): TomoriState | null {
  if (!rawWebhookName || extractBridgeUserId(rawWebhookName)) {
    return null;
  }

  const webhookName = stripBridgePrefix(rawWebhookName);
  const renderModifierSource = resolveRenderModifierSourcePersona(webhookName, personaByNickname);
  return renderModifierSource?.persona ?? personaByNickname.get(normalizeRenderModifierName(webhookName)) ?? null;
}

export function resolvePersonaForMessage(
  message: Message,
  allPersonas: readonly TomoriState[],
  clientUserId?: string | null,
): TomoriState | null {
  if (!message.webhookId) {
    return clientUserId && message.author.id === clientUserId
      ? (allPersonas.find((persona) => !persona.is_alter) ?? null)
      : null;
  }
  if (!isManagedWebhookMessage(message)) return null;

  const personaByNickname = new Map<string, TomoriState>();
  for (const persona of allPersonas) {
    const nicknameKey = persona.persona_nickname ? normalizeRenderModifierName(persona.persona_nickname) : "";
    if (!nicknameKey || personaByNickname.has(nicknameKey)) continue;
    personaByNickname.set(nicknameKey, persona);
  }

  return resolvePersonaByWebhookName(message.author.username, personaByNickname);
}

function resolveImpersonatedUserIdByWebhookIdentity(
  guild: Guild | null | undefined,
  webhookDisplayName: string,
  webhookAvatarUrl?: string | null,
): string | null {
  if (!guild) {
    return null;
  }

  const normalizedWebhookName = normalizeIdentityName(webhookDisplayName);
  if (!normalizedWebhookName) {
    return null;
  }

  const matchingMembers = Array.from(guild.members.cache.values()).filter((member) => {
    if (member.user.bot) return false;

    const candidateNames = [member.displayName, member.user.displayName, member.user.globalName, member.user.username]
      .map((name) => normalizeIdentityName(name))
      .filter((name) => name.length > 0);

    return candidateNames.includes(normalizedWebhookName);
  });

  if (matchingMembers.length === 1) {
    return matchingMembers[0].id;
  }

  if (matchingMembers.length === 0) {
    return null;
  }

  const normalizedWebhookAvatar = normalizeAvatarUrlForMatch(webhookAvatarUrl);
  if (!normalizedWebhookAvatar) {
    return null;
  }

  const avatarMatches = matchingMembers.filter((member) => {
    const memberAvatarUrl = member.displayAvatarURL({
      size: 1024,
      extension: "png",
      forceStatic: true,
    });
    return normalizeAvatarUrlForMatch(memberAvatarUrl) === normalizedWebhookAvatar;
  });

  return avatarMatches.length === 1 ? avatarMatches[0].id : null;
}

export async function resolveImpersonatedIdentity(
  client: Client,
  guild: Guild | null | undefined,
  userId: string,
  fallbackName?: string | null,
): Promise<{ displayName: string; avatarUrl?: string }> {
  const guildMember = guild
    ? (guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null)))
    : null;
  const discordUser = guildMember?.user || (await client.users.fetch(userId).catch(() => null));

  const displayName =
    guildMember?.displayName ||
    discordUser?.displayName ||
    discordUser?.globalName ||
    discordUser?.username ||
    fallbackName ||
    "User";
  const avatarUrl =
    guildMember?.displayAvatarURL({
      size: 1024,
      extension: "png",
      forceStatic: true,
    }) ||
    discordUser?.displayAvatarURL({
      size: 1024,
      extension: "png",
      forceStatic: true,
    }) ||
    undefined;

  return {
    displayName,
    avatarUrl,
  };
}

export function resolveReferencedWebhookTarget(
  referenceMessage: Message,
  personaByNickname: Map<string, TomoriState>,
  guild: Guild | null | undefined,
): { replyPersona: TomoriState | null; impersonatedUserId: string | null } {
  if (!isManagedWebhookMessage(referenceMessage)) {
    return { replyPersona: null, impersonatedUserId: null };
  }

  const cachedRelay = getCachedWebhookRelay(referenceMessage.webhookId);
  const rawWebhookName = referenceMessage.author.username;
  const matchedPersona = resolvePersonaByWebhookName(rawWebhookName, personaByNickname);
  if (matchedPersona) {
    return { replyPersona: matchedPersona, impersonatedUserId: null };
  }

  if (cachedRelay?.kind === "user_impersonation") {
    return {
      replyPersona: null,
      impersonatedUserId: cachedRelay.userId,
    };
  }

  if (!rawWebhookName || extractBridgeUserId(rawWebhookName)) {
    return { replyPersona: null, impersonatedUserId: null };
  }

  if (!cachedRelay) {
    return { replyPersona: null, impersonatedUserId: null };
  }

  const webhookName = stripBridgePrefix(rawWebhookName);
  const webhookAvatarUrl = referenceMessage.author.displayAvatarURL({
    size: 1024,
    extension: "png",
    forceStatic: true,
  });

  const impersonatedUserId = resolveImpersonatedUserIdByWebhookIdentity(guild, webhookName, webhookAvatarUrl);

  return {
    replyPersona: null,
    impersonatedUserId,
  };
}
