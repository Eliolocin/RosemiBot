import { createHash } from "node:crypto";
import {
  type AnyThreadChannel,
  type APIMessage,
  type BaseGuildTextChannel,
  type TextChannel,
  type Webhook,
  type Message,
  type Guild,
  type MessageCreateOptions,
  type WebhookMessageCreateOptions,
  type WebhookType,
  MessagePayload,
  makeURLSearchParams,
  RateLimitError,
  REST,
  Routes,
} from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import {
  MANAGED_WEBHOOK_KIND_SHARED_CHANNEL,
  MANAGED_WEBHOOK_KINDS,
  type ManagedDiscordWebhookRow,
  type ManagedWebhookKind,
  serverRepository,
} from "@/utils/db/repositories/ServerRepository";
import { personaRepository } from "@/utils/db/repositories/PersonaRepository";
import { log } from "@/utils/misc/logger";
import { safeDownload } from "@/utils/security/safeDownload";
import { PERSONA_LIMITS } from "@/utils/security/rateLimiter";
import { convertToPNG } from "@/utils/image/imageProcessor";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import {
  isLocalPersonaAvatarPath,
  loadStoredPersonaAvatarDataUri,
  resolvePersonaAvatarPublicUrl,
  uploadPersonaAvatarToStorage,
} from "@/utils/storage/avatarStorage";
import {
  runDeferrableWebhookAvatarEdit,
  WebhookAvatarEditDeferredError,
} from "@/utils/discord/webhook/avatarEditRateLimit";

/**
 * In-memory webhook cache: channelId -> Webhook
 * Reduces webhook lookups and creation operations.
 * No TTL - webhooks persist unless manually deleted by users.
 */
const webhookCache = new Map<string, Webhook>();

/**
 * In-memory persona webhook cache: channelId:personaId -> Webhook
 * Retained for legacy persona-webhook compatibility and recovery helpers.
 */
const personaWebhookCache = new Map<string, Webhook>();

/**
 * Channels whose last webhook resolution failed: channelId -> reason and expiry.
 *
 * Without this the failure is retried on every turn, because `webhookCache` stores only successes
 * and several call sites resolve a webhook independently per turn. A 50013 stays true until an
 * admin edits the channel, so each retry spends a database read, a Discord call that cannot
 * succeed, and an error-log insert. Cleared on invalidation as well as on expiry, so granting the
 * permission takes effect at the next turn instead of at the end of the TTL.
 *
 * Distinct from `WEBHOOK_ERROR_COOLDOWN_MS` in `responseEmitter`, which throttles how often the
 * user-facing embed is posted. This one suppresses the API call; that one suppresses the message.
 * The cached `errorReason` is still returned to callers, so suppression here never silences that
 * notice.
 */
const webhookFailureCache = new Map<string, { reason: WebhookCreateErrorReason; expiresAt: number }>();

const WEBHOOK_FAILURE_RETRY_MS = 15 * 60_000;

/**
 * Webhook name used for all multi-persona responses.
 * Consistent naming makes it easier to identify and manage.
 */
const WEBHOOK_NAME = "TomoriBot Multi-Persona";
const PERSONA_WEBHOOK_PREFIX = "TomoriBot Persona";
export const GENERIC_WEBHOOK_AVATAR_URL = "https://cdn.discordapp.com/embed/avatars/0.png";
// Discord caps channels at 15 webhooks, so creation leaves two slots for other integrations.
const DISCORD_WEBHOOK_LIMIT = 15;
const RESERVED_WEBHOOK_SLOTS = 2;
const IS_PRODUCTION = process.env.RUN_ENV === "production";

export type WebhookCreateErrorReason = "missing_permissions" | "max_webhooks" | "unknown";

export type WebhookCreateResult = {
  webhook: Webhook | null;
  errorReason?: WebhookCreateErrorReason;
};

export type ResolvedWebhookIdentity = {
  username?: string;
  avatarUrl?: string;
  avatarDataUri?: string;
};

type WebhookSendPayload = Exclude<Parameters<Webhook["send"]>[0], string>;

const MAX_AVATAR_SIZE_BYTES = PERSONA_LIMITS.MAX_AVATAR_SIZE_MB * 1024 * 1024;
const webhookMutationLocks = new Map<string, Promise<void>>();
const webhookAvatarStateCache = new Map<string, string>();
const persistedManagedWebhookIds = new Set<string>();
let managedWebhookUseSequence = 0;
const managedWebhookSlots = new Map<
  string,
  {
    webhook: Webhook;
    channel: TextChannel | BaseGuildTextChannel;
    kind: ManagedWebhookKind;
    avatarFingerprint: string | null;
    discordAvatarHash: string | null;
    lastUseOrder: number;
  }
>();

/**
 * Returns current sizes of every in-memory map owned by the webhook manager.
 * Used by the cache metrics logger to detect unbounded growth in webhook caches
 * (none of these maps have a TTL: they only shrink on explicit invalidation).
 */
export function getWebhookCacheSizes(): {
  webhookChannel: number;
  webhookPersona: number;
  webhookManagedSlots: number;
  webhookMutationLocks: number;
  webhookAvatarState: number;
  persistedManagedWebhookIds: number;
  webhookFailure: number;
} {
  return {
    webhookChannel: webhookCache.size,
    webhookPersona: personaWebhookCache.size,
    webhookManagedSlots: managedWebhookSlots.size,
    webhookMutationLocks: webhookMutationLocks.size,
    webhookAvatarState: webhookAvatarStateCache.size,
    persistedManagedWebhookIds: persistedManagedWebhookIds.size,
    webhookFailure: webhookFailureCache.size,
  };
}

function toWebhookAvatarData(avatar?: Buffer | string | null): string | null {
  if (!avatar) {
    return null;
  }

  if (typeof avatar === "string") {
    if (avatar.startsWith("data:image/")) {
      return avatar;
    }
    log.warn("[Webhook Manager] Ignoring avatar string that is not a data URI");
    return null;
  }

  if (avatar.length > MAX_AVATAR_SIZE_BYTES) {
    log.warn(`[Webhook Manager] Avatar buffer exceeds max size (${avatar.length} bytes)`);
    return null;
  }

  const base64 = avatar.toString("base64");
  return `data:image/png;base64,${base64}`;
}

function getPersonaWebhookName(personaId: number): string {
  return `${PERSONA_WEBHOOK_PREFIX} ${personaId}`;
}

function getPersonaWebhookCacheKey(channelId: string, personaId: number): string {
  return `${channelId}:${personaId}`;
}

function getWebhookErrorReason(error: unknown): WebhookCreateErrorReason {
  const code = (error as { code?: number | string })?.code;

  if (code === 50013 || code === "50013") {
    return "missing_permissions";
  }

  if (code === 30007 || code === "30007" || code === 30058 || code === "30058") {
    return "max_webhooks";
  }

  return "unknown";
}

function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function sanitizeAvatarUrl(url?: string | null): string | undefined {
  if (!url) {
    return undefined;
  }

  const trimmedUrl = url.trim();
  if (trimmedUrl.length === 0) {
    return undefined;
  }

  if (!isValidHttpUrl(trimmedUrl)) {
    return undefined;
  }

  return trimmedUrl;
}

function isInvalidWebhookError(error: unknown): boolean {
  const code = (error as { code?: number | string })?.code;
  return code === 10015 || code === "10015" || code === 50027 || code === "50027";
}

async function withWebhookMutationLock<T>(
  lockKey: string,
  operation: () => Promise<T>,
  scope: "identity" | "lifecycle" | "avatar" = "identity",
): Promise<T> {
  const coordinationKey = `${scope}:${lockKey}`;
  const queuedAt = performance.now();
  const previous = webhookMutationLocks.get(coordinationKey);
  const waitForPrevious = previous?.catch(() => undefined) ?? Promise.resolve();

  let releaseLock!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  const chained = waitForPrevious.then(() => current);
  webhookMutationLocks.set(coordinationKey, chained);

  await waitForPrevious;
  const metricFields: Record<string, number | string> = { scope, wait_ms: performance.now() - queuedAt };
  metricFields[scope === "avatar" ? "webhook_id" : "channel_id"] = lockKey;
  log.metric("webhook_mutation_lock", metricFields);

  try {
    return await operation();
  } finally {
    releaseLock();
    if (webhookMutationLocks.get(coordinationKey) === chained) {
      webhookMutationLocks.delete(coordinationKey);
    }
  }
}

async function normalizeAvatarToPng(buffer: Buffer, logLabel: string): Promise<Buffer | null> {
  if (buffer.length > MAX_AVATAR_SIZE_BYTES) {
    log.warn(`[Webhook Manager] ${logLabel} exceeds max size (${buffer.length} bytes)`);
    return null;
  }

  try {
    return await convertToPNG(buffer);
  } catch (error) {
    log.warn(`[Webhook Manager] Failed to convert ${logLabel} to PNG`, error);
    return null;
  }
}

async function persistPersonaAvatarReference(
  guildId: string,
  personaId: number,
  avatarReference: string,
): Promise<void> {
  const updated = await personaRepository.setAvatar(personaId, avatarReference);
  if (!updated) {
    throw new Error(`Failed to persist avatar reference for persona ${personaId}`);
  }
  invalidateTomoriStateCache(guildId);
}

async function storeMigratedPersonaAvatar(
  guildId: string,
  personaId: number,
  buffer: Buffer,
  label: string,
): Promise<string | null> {
  const storedReference = await uploadPersonaAvatarToStorage({
    personaId,
    serverDiscId: guildId,
    label,
    buffer,
  });

  if (!storedReference) {
    return null;
  }

  try {
    await persistPersonaAvatarReference(guildId, personaId, storedReference);
  } catch (error) {
    log.warn(`[Webhook Manager] Failed to persist migrated avatar reference for persona ${personaId}`, error);
  }

  return storedReference;
}

/**
 * Attempts to recover persona avatar by scanning guild for surviving webhooks.
 * Used when the stored webhook_avatar_url fails to download (Edge Case 2: last webhook deleted).
 *
 * @returns Avatar data URI and recovered URL, or null if no recovery possible
 */
async function attemptWebhookAvatarRecovery(
  guild: Guild,
  personaId: number,
): Promise<{ buffer: Buffer; url: string } | null> {
  const personaWebhookName = getPersonaWebhookName(personaId);

  log.info(`[Webhook Manager] Attempting avatar recovery for persona ${personaId} by scanning guild ${guild.id}`);

  // Scan all text channels in guild for surviving webhooks
  for (const channel of guild.channels.cache.values()) {
    if (!channel.isTextBased()) {
      continue;
    }

    // Skip channels without webhook support
    if (!("fetchWebhooks" in channel)) {
      continue;
    }

    try {
      const webhooks = await (channel as TextChannel).fetchWebhooks();
      const matching = webhooks.find((wh) => wh.name === personaWebhookName);

      // Found a surviving webhook for this persona!
      if (matching?.avatar) {
        const avatarUrl = matching.avatarURL({ extension: "png", size: 256 });
        if (!avatarUrl) {
          continue;
        }

        log.info(`[Webhook Manager] Found surviving webhook in channel ${channel.id}, attempting to download avatar`);

        // Download avatar from surviving webhook
        const downloadResult = await safeDownload(avatarUrl, {
          maxSizeMB: PERSONA_LIMITS.MAX_AVATAR_SIZE_MB,
        });

        if (!downloadResult.success || !downloadResult.buffer) {
          log.warn(`[Webhook Manager] Failed to download from surviving webhook, continuing scan`);
          continue;
        }

        const buffer = await normalizeAvatarToPng(
          downloadResult.buffer,
          `surviving webhook avatar for persona ${personaId}`,
        );
        if (!buffer) {
          continue;
        }

        log.success(
          `[Webhook Manager] Successfully recovered avatar buffer from surviving webhook in channel ${channel.id}`,
        );
        return {
          buffer,
          url: avatarUrl,
        };
      }
    } catch (error) {
      log.warn(`[Webhook Manager] Error scanning channel ${channel.id} for recovery, continuing`, error);
    }
  }

  log.warn(`[Webhook Manager] Avatar recovery failed: no surviving webhooks found for persona ${personaId}`);
  return null;
}

async function resolveNonProductionPersonaAvatarReference(persona: TomoriState, guild?: Guild): Promise<string | null> {
  const avatarReference = persona.webhook_avatar_url?.trim();
  if (!avatarReference) {
    return null;
  }

  if (
    IS_PRODUCTION ||
    !persona.is_alter ||
    !guild ||
    !persona.persona_id ||
    isLocalPersonaAvatarPath(avatarReference)
  ) {
    return avatarReference;
  }

  let normalizedBuffer: Buffer | null = null;
  const downloadResult = await safeDownload(avatarReference, {
    maxSizeMB: PERSONA_LIMITS.MAX_AVATAR_SIZE_MB,
  });

  if (downloadResult.success && downloadResult.buffer) {
    normalizedBuffer = await normalizeAvatarToPng(
      downloadResult.buffer,
      `legacy avatar for persona ${persona.persona_id}`,
    );
  } else {
    log.warn(
      `[Webhook Manager] Failed to download legacy avatar for persona ${persona.persona_id}: ${downloadResult.error ?? "unknown error"}`,
    );
  }

  if (!normalizedBuffer) {
    log.info(`[Webhook Manager] Attempting legacy webhook recovery for persona ${persona.persona_id}`);
    const recoveredAvatar = await attemptWebhookAvatarRecovery(guild, persona.persona_id);
    if (recoveredAvatar) {
      normalizedBuffer = recoveredAvatar.buffer;
    }
  }

  if (!normalizedBuffer) {
    return avatarReference;
  }

  const storedReference = await storeMigratedPersonaAvatar(
    guild.id,
    persona.persona_id,
    normalizedBuffer,
    "legacy avatar migration",
  );

  return storedReference ?? avatarReference;
}

async function persistSharedChannelWebhook(
  channel: TextChannel | BaseGuildTextChannel,
  webhook: Webhook,
): Promise<boolean> {
  if (persistedManagedWebhookIds.has(webhook.id)) {
    return managedWebhookSlots.get(webhook.id)?.kind === MANAGED_WEBHOOK_KIND_SHARED_CHANNEL;
  }
  if (!channel.guildId || !webhook.token) return false;
  const stored = await serverRepository.upsertManagedWebhook({
    guildDiscId: channel.guildId,
    kind: MANAGED_WEBHOOK_KIND_SHARED_CHANNEL,
    channelDiscId: channel.id,
    webhookDiscId: webhook.id,
    rawToken: webhook.token,
    discordAvatarHash: webhook.avatar,
  });
  if (stored) {
    persistedManagedWebhookIds.add(webhook.id);
    managedWebhookSlots.set(webhook.id, {
      webhook,
      channel,
      kind: MANAGED_WEBHOOK_KIND_SHARED_CHANNEL,
      avatarFingerprint: null,
      discordAvatarHash: webhook.avatar,
      lastUseOrder: 0,
    });
  }
  return stored;
}

async function restoreStoredManagedWebhook(
  channel: TextChannel | BaseGuildTextChannel,
  storedRow: ManagedDiscordWebhookRow,
): Promise<Webhook | null> {
  if (storedRow.guild_disc_id !== channel.guildId || storedRow.channel_disc_id !== channel.id) return null;
  return await withWebhookMutationLock(
    storedRow.webhook_disc_id,
    async () => {
      const forgetStoredSlot = async () => {
        await serverRepository.deleteManagedWebhook(channel.id, storedRow.webhook_disc_id, storedRow.kind);
        invalidateWebhookCache(channel.id, storedRow.webhook_disc_id);
      };
      const decryptedToken = await serverRepository.decryptManagedWebhookToken(storedRow);
      if (!decryptedToken) {
        await forgetStoredSlot();
        return null;
      }
      try {
        const webhook = await channel.client.fetchWebhook(storedRow.webhook_disc_id, decryptedToken);
        if (
          webhook.id !== storedRow.webhook_disc_id ||
          webhook.channelId !== channel.id ||
          webhook.guildId !== channel.guildId ||
          !webhook.token
        ) {
          await forgetStoredSlot();
          return null;
        }
        const avatarFingerprint =
          webhook.avatar === storedRow.discord_avatar_hash ? storedRow.avatar_fingerprint : null;
        if (webhook.avatar !== storedRow.discord_avatar_hash) {
          const stored = await serverRepository.upsertManagedWebhook({
            guildDiscId: channel.guildId,
            channelDiscId: channel.id,
            webhookDiscId: webhook.id,
            kind: storedRow.kind,
            rawToken: webhook.token,
            avatarFingerprint: null,
            discordAvatarHash: webhook.avatar,
          });
          if (!stored) return null;
        }
        managedWebhookSlots.set(webhook.id, {
          webhook,
          channel,
          kind: storedRow.kind,
          avatarFingerprint,
          discordAvatarHash: webhook.avatar,
          lastUseOrder: 0,
        });
        webhookAvatarStateCache.delete(webhook.id);
        if (storedRow.kind === MANAGED_WEBHOOK_KIND_SHARED_CHANNEL) webhookCache.set(channel.id, webhook);
        persistedManagedWebhookIds.add(webhook.id);
        return webhook;
      } catch (error) {
        if (isInvalidWebhookError(error)) await forgetStoredSlot();
        log.warn("[Webhook Manager] Failed to restore stored webhook", {
          channelId: channel.id,
          webhookId: storedRow.webhook_disc_id,
          code: (error as { code?: number | string }).code,
        });
        return null;
      }
    },
    "avatar",
  );
}

async function resolvePersonaAvatarIdentity(persona: TomoriState, guild?: Guild): Promise<ResolvedWebhookIdentity> {
  const identity: ResolvedWebhookIdentity = {
    username: persona.persona_nickname,
  };

  if (!persona.webhook_avatar_url) {
    return identity;
  }

  const avatarReference =
    !IS_PRODUCTION && persona.is_alter
      ? await resolveNonProductionPersonaAvatarReference(persona, guild)
      : persona.webhook_avatar_url;

  if (!avatarReference) {
    return identity;
  }

  const publicAvatarUrl = resolvePersonaAvatarPublicUrl(avatarReference);
  if (publicAvatarUrl) {
    identity.avatarUrl = publicAvatarUrl;
    return identity;
  }

  if (isLocalPersonaAvatarPath(avatarReference)) {
    const avatarDataUri = await loadStoredPersonaAvatarDataUri(avatarReference);
    if (avatarDataUri) {
      identity.avatarDataUri = avatarDataUri;
    }
    return identity;
  }

  const sanitizedAvatarUrl = sanitizeAvatarUrl(avatarReference);
  if (sanitizedAvatarUrl) {
    identity.avatarUrl = sanitizedAvatarUrl;
  }

  return identity;
}

async function resolvePersonaWebhookAvatar(persona: TomoriState, guild?: Guild): Promise<string | undefined> {
  const identity = await resolvePersonaAvatarIdentity(persona, guild);
  if (identity.avatarDataUri) {
    return identity.avatarDataUri;
  }

  if (!identity.avatarUrl) {
    return undefined;
  }

  const downloadResult = await safeDownload(identity.avatarUrl, {
    maxSizeMB: PERSONA_LIMITS.MAX_AVATAR_SIZE_MB,
  });
  if (!downloadResult.success || !downloadResult.buffer) {
    log.warn(
      `[Webhook Manager] Failed to download avatar for persona ${persona.persona_nickname}: ${downloadResult.error ?? "unknown error"}`,
    );
    return undefined;
  }

  const normalizedBuffer = await normalizeAvatarToPng(
    downloadResult.buffer,
    `avatar for persona ${persona.persona_nickname}`,
  );
  if (!normalizedBuffer) {
    return undefined;
  }

  return `data:image/png;base64,${normalizedBuffer.toString("base64")}`;
}

function resolveWebhookParentChannel(channel: unknown): BaseGuildTextChannel | null {
  if (!channel || typeof channel !== "object") return null;
  const candidate = channel as {
    isThread?: () => boolean;
    parent?: unknown;
  };
  const targetChannel = typeof candidate.isThread === "function" && candidate.isThread() ? candidate.parent : channel;

  if (
    !targetChannel ||
    typeof targetChannel !== "object" ||
    !("fetchWebhooks" in targetChannel) ||
    !("createWebhook" in targetChannel)
  ) {
    return null;
  }

  return targetChannel as BaseGuildTextChannel;
}

export async function resolveManagedChannelWebhook(channel: unknown): Promise<Webhook | null> {
  const targetChannel = resolveWebhookParentChannel(channel);
  if (!targetChannel) return null;
  const webhookResult = await getOrCreateWebhook(targetChannel);
  return webhookResult.webhook ?? null;
}

export async function resolveAuthoringWebhook(
  channel: unknown,
  webhookId: string | null,
  suppliedWebhook?: Webhook,
): Promise<Webhook | null> {
  if (!webhookId) return null;
  if (suppliedWebhook?.id === webhookId && suppliedWebhook.token) return suppliedWebhook;
  const parent = resolveWebhookParentChannel(channel) ?? resolveWebhookParentChannel(suppliedWebhook?.channel);
  return parent ? await resolveManagedWebhookForChannel(parent, webhookId) : null;
}

export async function getOrCreateWebhook(channel: TextChannel | BaseGuildTextChannel): Promise<WebhookCreateResult> {
  return await withWebhookMutationLock(channel.id, () => getOrCreateWebhookInternal(channel), "lifecycle");
}

async function getOrCreateWebhookInternal(channel: TextChannel | BaseGuildTextChannel): Promise<WebhookCreateResult> {
  const cachedFailure = webhookFailureCache.get(channel.id);
  if (cachedFailure) {
    if (cachedFailure.expiresAt > Date.now()) {
      return { webhook: null, errorReason: cachedFailure.reason };
    }
    webhookFailureCache.delete(channel.id);
  }

  try {
    const channelId = channel.id;

    const cachedWebhook = webhookCache.get(channelId);
    if (cachedWebhook) {
      // Verify cached webhook still has a valid token (not deleted)
      if (!cachedWebhook.token) {
        log.warn(
          `[Webhook Manager] Cached webhook for channel ${channelId} has no token (likely deleted), invalidating cache`,
        );
        invalidateWebhookCache(channelId, cachedWebhook.id);
        // Continue to fetch/create a new webhook
      } else {
        try {
          // Verify webhook still exists remotely; cached objects may survive manual deletes.
          const liveWebhooks = await channel.fetchWebhooks();
          if (liveWebhooks.has(cachedWebhook.id)) {
            await persistSharedChannelWebhook(channel, cachedWebhook);
            return { webhook: cachedWebhook };
          }
          log.warn(`[Webhook Manager] Cached webhook missing in channel ${channelId}, invalidating cache`);
          await serverRepository.deleteManagedWebhook(channelId, cachedWebhook.id, MANAGED_WEBHOOK_KIND_SHARED_CHANNEL);
          invalidateWebhookCache(channelId, cachedWebhook.id);
        } catch (fetchError) {
          log.warn(
            `[Webhook Manager] Cached webhook fetch failed for channel ${channelId}, invalidating cache`,
            fetchError,
          );
          invalidateWebhookCache(channelId, cachedWebhook.id);
          // Continue to fetch/create a new webhook
        }
      }
    }

    let storedSlots: ManagedDiscordWebhookRow[];
    try {
      storedSlots = await serverRepository.listManagedWebhooksByChannel(channelId);
    } catch {
      return { webhook: null, errorReason: "unknown" };
    }
    const primaryRow = storedSlots.find((row) => row.kind === MANAGED_WEBHOOK_KIND_SHARED_CHANNEL);
    const restoredWebhook = primaryRow ? await restoreStoredManagedWebhook(channel, primaryRow) : null;
    if (restoredWebhook) {
      log.info(`[Webhook Manager] Restored shared webhook for channel ${channelId} from stored credentials`);
      return { webhook: restoredWebhook };
    }

    log.info(`[Webhook Manager] Cache MISS for channel ${channelId}, fetching webhooks`);
    const webhooks = await channel.fetchWebhooks();
    const poolIds = new Set(
      storedSlots.filter((row) => row.kind !== MANAGED_WEBHOOK_KIND_SHARED_CHANNEL).map((row) => row.webhook_disc_id),
    );
    let webhook = webhooks.find(
      (wh) => wh.name === WEBHOOK_NAME && wh.owner?.id === channel.client.user?.id && !poolIds.has(wh.id),
    );

    if (webhook && !webhook.token) {
      log.warn(
        `[Webhook Manager] Found webhook for channel ${channelId} but it has no token (fetched webhook). Deleting and recreating.`,
      );
      await webhook.delete("Recreating webhook to get token");
      webhook = undefined;
    }

    let created = false;
    if (!webhook) {
      log.info(`[Webhook Manager] No webhook found for channel ${channelId}, creating new one`);
      webhook = await channel.createWebhook({
        name: WEBHOOK_NAME,
        reason: "TomoriBot multi-persona support",
      });
      created = true;
      log.success(`[Webhook Manager] Created webhook for channel ${channelId} (${channel.name})`);
    }

    if (!(await persistSharedChannelWebhook(channel, webhook))) {
      if (created) {
        try {
          await webhook.delete("Unused webhook could not be persisted");
        } catch (error) {
          log.warn("[Webhook Manager] Failed to remove unpersisted webhook", {
            webhookId: webhook.id,
            channelId,
            code: (error as { code?: number | string }).code,
          });
        }
      }
      return { webhook: null, errorReason: "unknown" };
    }
    webhookCache.set(channelId, webhook);
    webhookFailureCache.delete(channelId);
    return { webhook };
  } catch (error) {
    const errorReason = getWebhookErrorReason(error);
    webhookFailureCache.set(channel.id, {
      reason: errorReason,
      expiresAt: Date.now() + WEBHOOK_FAILURE_RETRY_MS,
    });

    // A missing permission is a server configuration state rather than a bot fault: it stays true
    // until an admin acts, so recording it at error level buries genuine failures underneath it.
    if (errorReason === "missing_permissions") {
      log.warn(
        `[Webhook Manager] No Manage Webhooks permission in channel ${channel.id} (${channel.name}); persona replies fall back to plain bot messages, and resolution is suppressed for ${WEBHOOK_FAILURE_RETRY_MS / 60_000} minutes`,
      );
      return { webhook: null, errorReason };
    }

    log.error(`[Webhook Manager] Failed to get/create webhook for channel ${channel.id}:`, {
      errorType: "webhook_error",
      metadata: { channelId: channel.id, channelName: channel.name, error },
    });
    return { webhook: null, errorReason };
  }
}

export function getCachedManagedWebhookForChannel(channelId: string, webhookId?: string | null): Webhook | null {
  if (!channelId || !webhookId) {
    return null;
  }

  const cachedSharedWebhook = webhookCache.get(channelId);
  if (cachedSharedWebhook?.id === webhookId && cachedSharedWebhook.token) {
    return cachedSharedWebhook;
  }

  const slot = managedWebhookSlots.get(webhookId);
  if (slot?.webhook.channelId === channelId && slot.webhook.token) return slot.webhook;

  for (const [cacheKey, webhook] of personaWebhookCache.entries()) {
    if (!cacheKey.startsWith(`${channelId}:`)) {
      continue;
    }

    if (webhook.id === webhookId && webhook.token) {
      return webhook;
    }
  }

  return null;
}

export async function resolveManagedWebhookForChannel(
  channel: TextChannel | BaseGuildTextChannel,
  webhookId?: string | null,
): Promise<Webhook | null> {
  if (!channel.id || !webhookId) {
    return null;
  }

  const cached = getCachedManagedWebhookForChannel(channel.id, webhookId);
  if (cached) return cached;
  return await withWebhookMutationLock(
    channel.id,
    async () => {
      const cachedWebhook = getCachedManagedWebhookForChannel(channel.id, webhookId);
      if (cachedWebhook) return cachedWebhook;
      const row = await serverRepository.loadManagedWebhookByChannelAndWebhookId(channel.id, webhookId);
      return row ? await restoreStoredManagedWebhook(channel, row) : null;
    },
    "lifecycle",
  );
}

function buildWebhookSendPayload(payload: WebhookSendPayload, identity?: ResolvedWebhookIdentity): WebhookSendPayload {
  const avatarUrl = sanitizeAvatarUrl(identity?.avatarUrl);

  return {
    ...payload,
    ...(identity?.username ? { username: identity.username } : {}),
    ...(avatarUrl ? { avatarURL: avatarUrl } : {}),
  } as WebhookSendPayload;
}

function shouldResetWebhookAvatar(webhook: Webhook, identity?: ResolvedWebhookIdentity): boolean {
  if (identity?.avatarDataUri || sanitizeAvatarUrl(identity?.avatarUrl)) {
    return false;
  }

  return webhookAvatarStateCache.has(webhook.id) || Boolean(webhook.avatar);
}

async function editWebhookAvatar(
  webhook: Webhook,
  edit: { avatar: string | null; reason: string },
  deferOnRateLimit: boolean,
): Promise<void> {
  // Restoration and avatar PATCHes share a webhook lock so a stale fetch cannot republish an earlier assignment.
  return await withWebhookMutationLock(
    webhook.id,
    async () => {
      try {
        const updated = deferOnRateLimit
          ? await runDeferrableWebhookAvatarEdit(webhook.id, () => webhook.edit(edit))
          : await webhook.edit(edit);
        await persistWebhookAvatarAssignment(updated, edit.avatar);
      } catch (error) {
        if (!(error instanceof WebhookAvatarEditDeferredError)) {
          webhookAvatarStateCache.delete(webhook.id);
          const slot = managedWebhookSlots.get(webhook.id);
          if (slot) slot.avatarFingerprint = null;
        }
        throw error;
      }
    },
    "avatar",
  );
}

async function persistWebhookAvatarAssignment(webhook: Webhook, avatar: string | null): Promise<void> {
  const slot = managedWebhookSlots.get(webhook.id);
  if (!slot) return;
  if (!webhook.guildId || !webhook.channelId || !webhook.token) throw new Error("Managed webhook lost its credentials");
  const avatarFingerprint = avatar ? fingerprintWebhookAvatar(avatar) : null;
  const stored = await serverRepository.upsertManagedWebhook({
    guildDiscId: webhook.guildId,
    channelDiscId: webhook.channelId,
    webhookDiscId: webhook.id,
    kind: slot.kind,
    rawToken: webhook.token,
    avatarFingerprint,
    discordAvatarHash: webhook.avatar,
  });
  if (!stored) {
    invalidateWebhookCache(webhook.channelId, webhook.id);
    throw new Error("Failed to persist managed webhook avatar assignment");
  }
  webhookAvatarStateCache.delete(webhook.id);
  slot.webhook = webhook;
  slot.avatarFingerprint = avatarFingerprint;
  slot.discordAvatarHash = webhook.avatar;
}

async function ensureWebhookAvatarState(
  webhook: Webhook,
  identity: ResolvedWebhookIdentity | undefined,
  deferOnRateLimit: boolean,
): Promise<void> {
  if (identity?.avatarDataUri) {
    const cachedAvatar = webhookAvatarStateCache.get(webhook.id);
    const slot = managedWebhookSlots.get(webhook.id);
    if (slot?.avatarFingerprint === fingerprintWebhookAvatar(identity.avatarDataUri)) {
      webhookAvatarStateCache.set(webhook.id, identity.avatarDataUri);
    } else if (cachedAvatar !== identity.avatarDataUri) {
      await editWebhookAvatar(
        webhook,
        { avatar: identity.avatarDataUri, reason: "TomoriBot persona identity update" },
        deferOnRateLimit,
      );
      webhookAvatarStateCache.set(webhook.id, identity.avatarDataUri);
    }
    return;
  }

  if (shouldResetWebhookAvatar(webhook, identity)) {
    await editWebhookAvatar(webhook, { avatar: null, reason: "TomoriBot persona identity reset" }, deferOnRateLimit);
    webhookAvatarStateCache.delete(webhook.id);
  }
}

/** Pins a specific webhook through a raw REST operation because Discord requires data-URI avatars to be stored on it. */
export async function runWithWebhookIdentity<T>(
  webhook: Webhook,
  identity: ResolvedWebhookIdentity | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const run = async (): Promise<T> => {
    await ensureWebhookAvatarState(webhook, identity, false);
    const result = await operation();
    recordManagedWebhookUse(webhook);
    return result;
  };

  if (!identity?.avatarDataUri && sanitizeAvatarUrl(identity?.avatarUrl)) return await run();
  return await withWebhookMutationLock(webhook.channelId ?? webhook.id, run);
}

export type WebhookIdentitySelection = {
  webhook: Webhook;
  webhookId: string;
  identity: ResolvedWebhookIdentity;
};

export type WebhookIdentityDelivery<T> = WebhookIdentitySelection & { result: T };

function fingerprintWebhookAvatar(avatar: string): string {
  return createHash("sha256")
    .update(Buffer.from(avatar.slice(avatar.indexOf(",") + 1), "base64"))
    .digest("hex");
}

function recordManagedWebhookUse(webhook: Webhook): void {
  const slot = managedWebhookSlots.get(webhook.id);
  if (slot) slot.lastUseOrder = ++managedWebhookUseSequence;
}

async function selectManagedWebhookIdentity(
  initialWebhook: Webhook,
  identity: ResolvedWebhookIdentity,
): Promise<WebhookIdentitySelection> {
  const initialSlot = managedWebhookSlots.get(initialWebhook.id);
  if (!initialSlot) throw new Error("Managed webhook slot is unavailable");
  const { channel } = initialSlot;
  const generic = (webhook: Webhook): WebhookIdentitySelection => {
    log.metric("webhook_avatar_pool", {
      channel_id: channel.id,
      webhook_id: webhook.id,
      outcome: "generic_fallback",
    });
    return {
      webhook,
      webhookId: webhook.id,
      identity: { username: identity.username, avatarUrl: GENERIC_WEBHOOK_AVATAR_URL },
    };
  };
  const avatar = identity.avatarDataUri;
  if (!avatar) {
    return {
      webhook: initialSlot.webhook,
      webhookId: initialWebhook.id,
      identity: {
        username: identity.username,
        avatarUrl: sanitizeAvatarUrl(identity.avatarUrl) ?? GENERIC_WEBHOOK_AVATAR_URL,
      },
    };
  }

  let rows: ManagedDiscordWebhookRow[];
  try {
    rows = await serverRepository.listManagedWebhooksByChannel(channel.id);
  } catch {
    return generic(initialSlot.webhook);
  }
  for (const row of rows) {
    if (!managedWebhookSlots.has(row.webhook_disc_id)) await restoreStoredManagedWebhook(channel, row);
  }
  const slots = [...managedWebhookSlots.values()]
    .filter(
      (slot) => slot.webhook.channelId === channel.id && slot.webhook.guildId === channel.guildId && slot.webhook.token,
    )
    .sort(
      (left, right) =>
        left.lastUseOrder - right.lastUseOrder ||
        rows.findIndex((row) => row.webhook_disc_id === left.webhook.id) -
          rows.findIndex((row) => row.webhook_disc_id === right.webhook.id),
    );
  const fingerprint = fingerprintWebhookAvatar(avatar);
  const exact = slots.find((slot) => slot.avatarFingerprint === fingerprint);
  if (exact) {
    webhookAvatarStateCache.set(exact.webhook.id, avatar);
    log.metric("webhook_avatar_pool", { channel_id: channel.id, webhook_id: exact.webhook.id, outcome: "exact_reuse" });
    return { webhook: exact.webhook, webhookId: exact.webhook.id, identity };
  }
  const oldest = slots[0];
  if (!oldest) throw new Error("No usable managed webhook slot");
  let deferral: WebhookAvatarEditDeferredError | undefined;
  log.metric("webhook_avatar_pool", {
    channel_id: channel.id,
    webhook_id: oldest.webhook.id,
    outcome: "patch_attempt",
  });
  try {
    await ensureWebhookAvatarState(oldest.webhook, identity, true);
    return { webhook: oldest.webhook, webhookId: oldest.webhook.id, identity };
  } catch (error) {
    if (error instanceof WebhookAvatarEditDeferredError) {
      deferral = error;
    } else {
      const code = (error as { code?: number | string })?.code;
      log.metric("webhook_avatar_pool", {
        channel_id: channel.id,
        webhook_id: oldest.webhook.id,
        outcome: "patch_failed",
        code: code ?? "unknown",
      });
      if (isInvalidWebhookError(error)) {
        invalidateWebhookCache(channel.id, oldest.webhook.id);
        const remaining = slots.find((slot) => slot.webhook.id !== oldest.webhook.id);
        if (!remaining) throw error;
        return generic(remaining.webhook);
      }
      return generic(initialSlot.webhook);
    }
  }

  let created: Webhook | undefined;
  const unusedKind = MANAGED_WEBHOOK_KINDS.find(
    (kind) =>
      kind !== MANAGED_WEBHOOK_KIND_SHARED_CHANNEL &&
      !rows.some((row) => row.kind === kind) &&
      !slots.some((slot) => slot.kind === kind),
  );
  let creationOutcome = "pool_full";
  try {
    if (unusedKind && rows.length < MANAGED_WEBHOOK_KINDS.length) {
      creationOutcome = "count_unavailable";
      const liveWebhooks = await channel.fetchWebhooks();
      creationOutcome = "channel_full";
      if (liveWebhooks.size < DISCORD_WEBHOOK_LIMIT - RESERVED_WEBHOOK_SLOTS) {
        creationOutcome = "create_failed";
        created = await channel.createWebhook({
          name: `${WEBHOOK_NAME} Avatar Pool`,
          avatar,
          reason: "TomoriBot local avatar pool",
        });
        if (!created.token || created.channelId !== channel.id || created.guildId !== channel.guildId) {
          throw new Error("Created webhook has invalid credentials or channel");
        }
        const stored = await serverRepository.upsertManagedWebhook({
          guildDiscId: channel.guildId,
          channelDiscId: channel.id,
          webhookDiscId: created.id,
          kind: unusedKind,
          rawToken: created.token,
          avatarFingerprint: fingerprint,
          discordAvatarHash: created.avatar,
        });
        if (!stored) {
          creationOutcome = "persist_failed";
          throw new Error("Failed to persist new avatar pool webhook");
        }
        managedWebhookSlots.set(created.id, {
          webhook: created,
          channel,
          kind: unusedKind,
          avatarFingerprint: fingerprint,
          discordAvatarHash: created.avatar,
          lastUseOrder: 0,
        });
        persistedManagedWebhookIds.add(created.id);
        webhookAvatarStateCache.set(created.id, avatar);
        log.metric("webhook_avatar_pool", { channel_id: channel.id, webhook_id: created.id, outcome: "created" });
        log.metric("webhook_avatar_patch_rate_limited", {
          channel_id: channel.id,
          webhook_id: deferral.webhookId,
          time_to_reset_ms: deferral.timeToResetMs,
          outcome: "pool_created",
        });
        return { webhook: created, webhookId: created.id, identity };
      }
    }
  } catch (error) {
    log.metric("webhook_avatar_pool", {
      channel_id: channel.id,
      webhook_id: created?.id ?? oldest.webhook.id,
      outcome: creationOutcome,
      code: (error as { code?: number | string })?.code ?? "unknown",
    });
    if (created) {
      try {
        await created.delete("Unused avatar pool webhook could not be persisted");
      } catch (cleanupError) {
        log.warn("[Webhook Manager] Failed to remove unused avatar pool webhook", {
          channelId: channel.id,
          webhookId: created.id,
          code: (cleanupError as { code?: number | string })?.code,
        });
      }
    }
  }
  log.metric("webhook_avatar_patch_rate_limited", {
    channel_id: channel.id,
    webhook_id: deferral.webhookId,
    time_to_reset_ms: deferral.timeToResetMs,
    outcome: "generic_fallback",
    reason: creationOutcome,
  });
  return generic(initialSlot.webhook);
}

// Avatar recovery ends before the operation because an uncertain POST outcome must never trigger a second send.
export async function dispatchWebhookWithIdentity<T>(
  webhook: Webhook,
  identity: ResolvedWebhookIdentity | undefined,
  operation: (selection: WebhookIdentitySelection) => Promise<T>,
): Promise<WebhookIdentityDelivery<T>> {
  if (!managedWebhookSlots.has(webhook.id)) {
    try {
      return await runWithWebhookIdentity(webhook, identity, async () => {
        const selection = { webhook, webhookId: webhook.id, identity: identity ?? {} };
        return { ...selection, result: await operation(selection) };
      });
    } catch (error) {
      if (isInvalidWebhookError(error) && webhook.channelId) invalidateWebhookCache(webhook.channelId, webhook.id);
      throw error;
    }
  }
  const run = async () => {
    const selection = await selectManagedWebhookIdentity(webhook, identity ?? {});
    try {
      const result = await operation(selection);
      recordManagedWebhookUse(selection.webhook);
      return { ...selection, result };
    } catch (error) {
      if (isInvalidWebhookError(error)) invalidateWebhookCache(webhook.channelId ?? webhook.id, selection.webhookId);
      throw error;
    }
  };
  return identity?.avatarDataUri ? await withWebhookMutationLock(webhook.channelId ?? webhook.id, run) : await run();
}

export async function sendSelectedWebhookMessage(
  selection: WebhookIdentitySelection,
  payload: WebhookSendPayload,
): Promise<Message> {
  return await selection.webhook.send(buildIdentityPayload(payload, selection.identity));
}

export async function sendWebhookMessageWithIdentityDelivery(
  webhook: Webhook,
  payload: WebhookSendPayload,
  identity?: ResolvedWebhookIdentity,
): Promise<WebhookIdentityDelivery<Message>> {
  return await dispatchWebhookWithIdentity(webhook, identity, (selected) =>
    sendSelectedWebhookMessage(selected, payload),
  );
}

function buildIdentityPayload(payload: WebhookSendPayload, identity?: ResolvedWebhookIdentity): WebhookSendPayload {
  const finalPayload = buildWebhookSendPayload(payload, identity);
  if (identity?.avatarDataUri && "avatarURL" in finalPayload) {
    delete finalPayload.avatarURL;
  }
  return finalPayload;
}

async function sendWebhookMessagesInternal(
  webhook: Webhook,
  payloads: WebhookSendPayload[],
  identity?: ResolvedWebhookIdentity,
): Promise<Message[]> {
  const messages: Message[] = [];
  for (const payload of payloads) {
    messages.push(await webhook.send(buildIdentityPayload(payload, identity)));
  }

  return messages;
}

/**
 * The shared client retries a timed-out, reset, or 5xx request, and webhook execution accepts no
 * nonce, so a retry after a lost response can post a second copy. This client makes one attempt.
 * It also rejects every rate limit instead of sleeping inside the request, so the caller waits and
 * can observe a stop before posting again.
 */
let singleAttemptRest: REST | null = null;
const EXPRESSION_RATE_LIMIT_BUDGET_MS = 30_000;
const EXPRESSION_STOP_CHECK_INTERVAL_MS = 100;

/** All POSTs were refused, so exhausting this budget is a definite non-delivery. */
export class WebhookExpressionRateLimitTimeoutError extends Error {
  constructor() {
    super("Webhook expression rate-limit budget exhausted");
    this.name = "WebhookExpressionRateLimitTimeoutError";
  }
}

export function getSingleAttemptWebhookRest(): REST {
  singleAttemptRest ??= new REST({ retries: 0, rejectOnRateLimit: () => true });
  return singleAttemptRest;
}

/**
 * Executes one webhook message without transport retries, for sends where a duplicate is worse
 * than an unconfirmed outcome. Applies the same identity and avatar handling as
 * {@link sendWebhookMessageWithIdentity}.
 *
 * A rate limit is waited out here and the POST retried, which cannot duplicate: Discord refused the
 * limited request, or the client refused to send it.
 *
 * @param beforePost - Runs after the avatar is settled and immediately before every POST attempt;
 *   throwing from it cancels the send with nothing posted
 * @returns The created message's id and webhook id
 */
export async function sendWebhookMessageOnce(
  webhook: Webhook,
  payload: WebhookMessageCreateOptions,
  identity: ResolvedWebhookIdentity | undefined,
  beforePost: () => void,
): Promise<{ id: string; webhookId: string | null }> {
  const token = webhook.token;
  if (!token) throw new Error(`Webhook ${webhook.id} has no token.`);
  try {
    return await runWithWebhookIdentity(webhook, identity, async () => {
      const finalPayload = buildIdentityPayload(payload, identity) as WebhookMessageCreateOptions;
      // Only an incoming webhook has the token checked above, which is what execution requires.
      const target = webhook as Webhook<WebhookType.Incoming>;
      const { body, files } = await MessagePayload.create(target, finalPayload).resolveBody().resolveFiles();
      const deadline = Date.now() + EXPRESSION_RATE_LIMIT_BUDGET_MS;
      for (;;) {
        beforePost();
        if (Date.now() >= deadline) throw new WebhookExpressionRateLimitTimeoutError();
        try {
          const created = (await getSingleAttemptWebhookRest().post(Routes.webhook(webhook.id, token), {
            body,
            files: files ?? undefined,
            query: makeURLSearchParams({ wait: true, thread_id: finalPayload.threadId }),
            auth: false,
          })) as APIMessage;
          return { id: created.id, webhookId: created.webhook_id ?? null };
        } catch (error) {
          if (!(error instanceof RateLimitError)) throw error;
          // A 429 reports the bucket reset in `timeToReset` and Discord's Retry-After in `retryAfter`.
          beforePost();
          const retryAt = Date.now() + Math.max(error.timeToReset, error.retryAfter);
          if (retryAt >= deadline) throw new WebhookExpressionRateLimitTimeoutError();
          // The phase holds a watchdog exemption, so repeated refusals need their own deadline.
          while (Date.now() < retryAt) {
            beforePost();
            await new Promise((resolve) =>
              setTimeout(resolve, Math.min(EXPRESSION_STOP_CHECK_INTERVAL_MS, retryAt - Date.now())),
            );
          }
        }
      }
    });
  } catch (error) {
    if (isInvalidWebhookError(error) && webhook.channelId) {
      invalidateWebhookCache(webhook.channelId, webhook.id);
    }
    throw error;
  }
}

export async function sendWebhookMessagesWithIdentity(
  webhook: Webhook,
  payloads: WebhookSendPayload[],
  identity?: ResolvedWebhookIdentity,
): Promise<Message[]> {
  const delivery = await dispatchWebhookWithIdentity(webhook, identity, (selected) =>
    sendWebhookMessagesInternal(selected.webhook, payloads, selected.identity),
  );
  return delivery.result;
}

export async function sendWebhookMessageWithIdentity(
  webhook: Webhook,
  payload: WebhookSendPayload,
  identity?: ResolvedWebhookIdentity,
): Promise<Message> {
  return (await sendWebhookMessageWithIdentityDelivery(webhook, payload, identity)).result;
}

/**
 * Gets or creates a webhook for a specific persona in a channel.
 * Legacy compatibility helper used for recovery-oriented persona webhook flows.
 */
export async function getOrCreatePersonaWebhook(
  channel: TextChannel | BaseGuildTextChannel,
  persona: TomoriState,
): Promise<WebhookCreateResult> {
  try {
    if (!persona.persona_id) {
      log.warn(
        `[Webhook Manager] Missing persona_id for persona ${persona.persona_nickname}, cannot create persona webhook.`,
      );
      return { webhook: null, errorReason: "unknown" };
    }

    const channelId = channel.id;
    const cacheKey = getPersonaWebhookCacheKey(channelId, persona.persona_id);

    const cachedWebhook = personaWebhookCache.get(cacheKey);
    if (cachedWebhook) {
      if (!cachedWebhook.token) {
        log.warn(
          `[Webhook Manager] Cached persona webhook for channel ${channelId} has no token (likely deleted), invalidating cache`,
        );
        personaWebhookCache.delete(cacheKey);
      } else {
        try {
          // Verify webhook still exists remotely; cached objects may survive manual deletes.
          const liveWebhooks = await channel.fetchWebhooks();
          if (liveWebhooks.has(cachedWebhook.id)) {
            log.info(`[Webhook Manager] Persona cache HIT for channel ${channelId} (persona ${persona.persona_id})`);
            return { webhook: cachedWebhook };
          }
          log.warn(`[Webhook Manager] Cached persona webhook missing in channel ${channelId}, invalidating cache`);
          personaWebhookCache.delete(cacheKey);
        } catch (fetchError) {
          log.warn(
            `[Webhook Manager] Cached persona webhook fetch failed for channel ${channelId}, invalidating cache`,
            fetchError,
          );
          personaWebhookCache.delete(cacheKey);
        }
      }
    }

    log.info(`[Webhook Manager] Persona cache MISS for channel ${channelId}, fetching webhooks`);
    const webhooks = await channel.fetchWebhooks();
    const personaWebhookName = getPersonaWebhookName(persona.persona_id);
    let webhook = webhooks.find((wh) => wh.name === personaWebhookName);

    if (webhook && !webhook.token) {
      log.warn(
        `[Webhook Manager] Found persona webhook for channel ${channelId} but it has no token (fetched webhook). Deleting and recreating.`,
      );
      await webhook.delete("Recreating webhook to get token");
      webhook = undefined;
    }

    if (!webhook) {
      const avatar = await resolvePersonaWebhookAvatar(persona, channel.guild);
      log.info(`[Webhook Manager] No persona webhook found for channel ${channelId}, creating new one`);
      webhook = await channel.createWebhook({
        name: personaWebhookName,
        avatar,
        reason: "TomoriBot persona avatar support",
      });
      log.success(`[Webhook Manager] Created persona webhook for channel ${channelId} (${channel.name})`);

      // Update stored URL to webhook's permanent avatar URL (replaces temporary Discord CDN attachment URLs)
      // This ensures future webhook recreations use a permanent URL that doesn't expire
      const webhookAvatarUrl = webhook.avatarURL({
        extension: "png",
        size: 256,
      });
      if (webhookAvatarUrl && webhookAvatarUrl !== persona.webhook_avatar_url) {
        try {
          const updated = await personaRepository.setAvatar(persona.persona_id, webhookAvatarUrl);
          if (!updated) {
            throw new Error(`Failed to update stored avatar URL for persona ${persona.persona_id}`);
          }
          // Invalidate cache so updated URL is used immediately
          if (channel.guild) {
            invalidateTomoriStateCache(channel.guild.id);
          }
          log.success(
            `[Webhook Manager] Updated stored avatar URL to permanent webhook URL for persona ${persona.persona_id}`,
          );
        } catch (error) {
          log.warn(`[Webhook Manager] Failed to update stored avatar URL for persona ${persona.persona_id}`, error);
        }
      }
    }

    personaWebhookCache.set(cacheKey, webhook);
    return { webhook };
  } catch (error) {
    const errorReason = getWebhookErrorReason(error);
    log.error(`[Webhook Manager] Failed to get/create persona webhook for channel ${channel.id}:`, {
      errorType: "webhook_error",
      metadata: { channelId: channel.id, channelName: channel.name, error },
    });
    return { webhook: null, errorReason };
  }
}

/**
 * Updates existing persona webhooks across a guild to use the latest avatar.
 * Legacy maintenance helper for surviving persona webhooks in non-production.
 *
 * @param avatar - Avatar data (Buffer or data URI)
 */
export async function updatePersonaWebhooksAvatar(
  guild: Guild,
  personaId: number,
  avatar?: Buffer | string | null,
): Promise<number> {
  if (IS_PRODUCTION) {
    return 0;
  }

  const avatarData = toWebhookAvatarData(avatar);
  if (!avatarData) {
    log.warn(`[Webhook Manager] Skipping persona webhook update for persona ${personaId} due to missing avatar data`);
    return 0;
  }

  const personaWebhookName = getPersonaWebhookName(personaId);
  let updatedCount = 0;

  for (const channel of guild.channels.cache.values()) {
    if (!channel.isTextBased()) {
      continue;
    }

    if (!("fetchWebhooks" in channel)) {
      continue;
    }

    try {
      const webhooks = await (channel as TextChannel).fetchWebhooks();
      const matching = webhooks.filter((wh) => wh.name === personaWebhookName);

      for (const webhook of matching.values()) {
        await webhook.edit({
          avatar: avatarData,
          reason: "TomoriBot persona avatar updated",
        });
        updatedCount++;
        const cacheKey = getPersonaWebhookCacheKey(channel.id, personaId);
        personaWebhookCache.set(cacheKey, webhook);

        // Store permanent webhook avatar URL (first channel only, all webhooks have same avatar)
        if (updatedCount === 1) {
          const webhookAvatarUrl = webhook.avatarURL({
            extension: "png",
            size: 256,
          });
          if (webhookAvatarUrl) {
            try {
              const updated = await personaRepository.setAvatar(personaId, webhookAvatarUrl);
              if (!updated) {
                throw new Error(`Failed to store permanent webhook avatar URL for persona ${personaId}`);
              }
              invalidateTomoriStateCache(guild.id);
              log.info(`[Webhook Manager] Stored permanent webhook avatar URL for persona ${personaId}`);
            } catch (dbError) {
              log.warn(
                `[Webhook Manager] Failed to store permanent webhook avatar URL for persona ${personaId}`,
                dbError,
              );
            }
          }
        }
      }
    } catch (error) {
      log.warn(`[Webhook Manager] Failed to update persona webhook in channel ${channel.id}`, error);
    }
  }

  if (updatedCount > 0) {
    log.info(`[Webhook Manager] Updated ${updatedCount} persona webhook(s) for persona ${personaId}`);
  }

  return updatedCount;
}

export async function resolvePersonaWebhookIdentity(
  persona: TomoriState,
  guild: Guild | null,
): Promise<ResolvedWebhookIdentity> {
  const identity = await resolvePersonaAvatarIdentity(persona, guild ?? undefined);

  if (!persona.is_alter && !identity.avatarUrl && !identity.avatarDataUri) {
    const fallbackAvatarUrl = resolvePersonaAvatarURL(persona, guild);
    if (fallbackAvatarUrl) {
      identity.avatarUrl = fallbackAvatarUrl;
    }
  }

  return identity;
}

/**
 * Sends a message via webhook with persona-specific avatar and username.
 * Used for multi-persona responses to show different avatars per persona.
 *
 * Avatar resolution priority:
 * 1. Alter personas: Use webhook_avatar_url from database
 * 2. Main persona: Use guild avatar or fallback to webhook_avatar_url
 * 3. Fallback: Use bot's global avatar (webhook default)
 *
 * @returns The sent message, or null if failed
 */
export async function sendAsPersona(
  webhook: Webhook,
  persona: TomoriState,
  content: string,
  options?: {
    replyToMessageId?: string;
    avatarURL?: string;
    guild?: Guild;
    files?: MessageCreateOptions["files"];
    embeds?: MessageCreateOptions["embeds"];
    components?: MessageCreateOptions["components"];
  },
): Promise<Message | null> {
  try {
    const resolvedIdentity = options?.guild
      ? await resolvePersonaWebhookIdentity(persona, options.guild)
      : { username: persona.persona_nickname };
    const avatarURL = sanitizeAvatarUrl(options?.avatarURL);
    const identity: ResolvedWebhookIdentity = {
      ...resolvedIdentity,
      ...(avatarURL ? { avatarUrl: avatarURL } : {}),
    };

    const message = await sendWebhookMessageWithIdentity(
      webhook,
      {
        content,
        allowedMentions: {
          parse: ["users", "roles"],
          repliedUser: true,
        },
        ...(options?.replyToMessageId && {
          reply: {
            messageReference: options.replyToMessageId,
            failIfNotExists: false,
          },
        }),
        ...(options?.files && { files: options.files }),
        ...(options?.embeds && { embeds: options.embeds }),
        ...(options?.components && { components: options.components }),
      },
      identity,
    );

    log.info(
      `[Webhook Manager] Sent message as persona ${persona.persona_nickname} (${persona.is_alter ? "alter" : "main"})`,
    );
    return message;
  } catch (error) {
    log.error(`[Webhook Manager] Failed to send message as persona ${persona.persona_nickname}:`, {
      errorType: "webhook_send_error",
      metadata: {
        personaId: persona.persona_id,
        personaName: persona.persona_nickname,
        isAlter: persona.is_alter,
        error,
      },
    });
    return null;
  }
}

/**
 * Sends a voice transcript as a blockquote chat message impersonating the user.
 *
 * Used when `voice_transcript_chat_mode` is enabled. Instead of storing the
 * transcript in an internal TTL cache, it is posted visibly to the channel so:
 *   - Other users can see what was said
 *   - The LLM reads it naturally from chat history (no re-transcription)
 *   - Audio attachments are never sent to the AI
 *
 * The message is prefixed with `> ` (Discord blockquote) to visually distinguish
 * it from a regular typed message.
 *
 * @returns The sent Discord message, or null if posting failed
 */
export async function sendUserTranscriptViaWebhook(
  channel: BaseGuildTextChannel | AnyThreadChannel,
  displayName: string,
  avatarUrl: string,
  transcript: string,
): Promise<Message | null> {
  // Threads cannot own webhooks, so use the parent channel for creation/lookup
  const isThread = channel.isThread();
  const webhookTargetChannel = isThread ? (channel.parent as BaseGuildTextChannel | null) : channel;

  if (
    !webhookTargetChannel ||
    !("fetchWebhooks" in webhookTargetChannel) ||
    !("createWebhook" in webhookTargetChannel)
  ) {
    log.warn(`[Webhook Manager] Channel ${channel.id} does not support webhooks for transcript posting`);
    return null;
  }

  // Reuse the shared TomoriBot Multi-Persona webhook for this channel
  const webhookResult = await getOrCreateWebhook(webhookTargetChannel);
  if (!webhookResult.webhook) {
    log.warn(
      `[Webhook Manager] Could not get webhook for transcript posting in channel ${channel.id}: ${webhookResult.errorReason}`,
    );
    return null;
  }

  const quotedTranscript = `> ${transcript.replace(/\n/g, "\n> ")}`;

  const payload: WebhookSendPayload = {
    content: quotedTranscript,
    allowedMentions: { parse: [] },
    ...(isThread ? { threadId: channel.id } : {}),
  };

  const identity: ResolvedWebhookIdentity = {
    username: displayName,
    avatarUrl,
  };

  try {
    const message = await sendWebhookMessageWithIdentity(webhookResult.webhook, payload, identity);
    log.info(`[Webhook Manager] Sent voice transcript webhook as "${displayName}" in channel ${channel.id}`);
    return message;
  } catch (error) {
    log.warn(`[Webhook Manager] Failed to send transcript webhook in channel ${channel.id}`, error);
    return null;
  }
}

/**
 * Resolves the avatar URL for a given persona and guild.
 * Handles fallback chain: alter avatar -> bot's guild avatar -> default avatar.
 *
 * @returns Avatar URL string, or undefined to use webhook default
 */
export function resolvePersonaAvatarURL(persona: TomoriState, guild: Guild | null | undefined): string | undefined {
  const validateAvatarURL = (avatarReference: string): string | undefined => {
    const resolvedUrl = resolvePersonaAvatarPublicUrl(avatarReference);
    if (!resolvedUrl) {
      return undefined;
    }

    return sanitizeAvatarUrl(resolvedUrl);
  };

  // Alter personas: Use webhook_avatar_url from database
  if (persona.is_alter && persona.webhook_avatar_url) {
    const validatedURL = validateAvatarURL(persona.webhook_avatar_url);
    if (validatedURL) {
      return validatedURL;
    }
  }

  if (!persona.is_alter) {
    const memberAvatar = guild?.members.me?.displayAvatarURL({
      extension: "png",
      size: 256,
      forceStatic: true,
    });
    if (memberAvatar) {
      return memberAvatar;
    }

    // Fallback to webhook_avatar_url if guild has no icon
    if (persona.webhook_avatar_url) {
      const validatedURL = validateAvatarURL(persona.webhook_avatar_url);
      if (validatedURL) {
        return validatedURL;
      }
    }
  }

  // Fallback: undefined = use webhook's default avatar (bot's global avatar)
  return undefined;
}

export function invalidateWebhookCache(channelId: string, webhookId?: string): void {
  const primary = webhookCache.get(channelId);
  if (!webhookId || primary?.id === webhookId) webhookCache.delete(channelId);
  webhookFailureCache.delete(channelId);
  for (const [id, slot] of managedWebhookSlots) {
    if (slot.webhook.channelId === channelId && (!webhookId || id === webhookId)) {
      managedWebhookSlots.delete(id);
      webhookAvatarStateCache.delete(id);
      persistedManagedWebhookIds.delete(id);
    }
  }
  if (primary && (!webhookId || primary.id === webhookId)) {
    webhookAvatarStateCache.delete(primary.id);
    persistedManagedWebhookIds.delete(primary.id);
  }
  if (webhookId) {
    webhookAvatarStateCache.delete(webhookId);
    persistedManagedWebhookIds.delete(webhookId);
    for (const [key, webhook] of personaWebhookCache) {
      if (webhook.channelId === channelId && webhook.id === webhookId) personaWebhookCache.delete(key);
    }
  } else {
    invalidatePersonaWebhookCacheForChannel(channelId);
  }
}

function invalidatePersonaWebhookCacheForChannel(channelId: string): number {
  let removed = 0;
  const prefix = `${channelId}:`;
  for (const key of personaWebhookCache.keys()) {
    if (key.startsWith(prefix)) {
      personaWebhookCache.delete(key);
      removed++;
    }
  }
  return removed;
}

export function invalidatePersonaWebhookCacheForPersona(personaId: number): number {
  let removed = 0;
  const suffix = `:${personaId}`;
  for (const key of personaWebhookCache.keys()) {
    if (key.endsWith(suffix)) {
      personaWebhookCache.delete(key);
      removed++;
    }
  }
  if (removed > 0) {
    log.info(`[Webhook Manager] Invalidated persona webhook cache for persona ${personaId}`);
  }
  return removed;
}

/**
 * Useful for testing or manual refresh operations.
 */
export function clearWebhookCache(): void {
  webhookCache.clear();
  const slotSize = managedWebhookSlots.size;
  managedWebhookSlots.clear();
  managedWebhookUseSequence = 0;
  const personaSize = personaWebhookCache.size;
  personaWebhookCache.clear();
  webhookAvatarStateCache.clear();
  persistedManagedWebhookIds.clear();
  webhookFailureCache.clear();

  log.info(`[Webhook Manager] Cleared entire webhook cache (${slotSize + personaSize} entries)`);
}

/**
 * Gets webhook cache statistics for monitoring.
 *
 */
export function getWebhookCacheStats(): {
  cacheSize: number;
} {
  return {
    cacheSize:
      new Set(
        [...webhookCache.values(), ...[...managedWebhookSlots.values()].map((slot) => slot.webhook)].map(
          (webhook) => webhook.id,
        ),
      ).size + personaWebhookCache.size,
  };
}

/**
 * Deletes persona-specific webhooks across all channels in a guild.
 * Legacy cleanup helper. Normal avatar/storage flows no longer depend on these webhooks.
 *
 */
export async function deletePersonaWebhooks(guild: Guild, personaId: number): Promise<number> {
  const personaWebhookName = getPersonaWebhookName(personaId);
  let deletedCount = 0;

  invalidatePersonaWebhookCacheForPersona(personaId);

  for (const channel of guild.channels.cache.values()) {
    if (!channel.isTextBased()) {
      continue;
    }

    if (!("fetchWebhooks" in channel)) {
      continue;
    }

    try {
      const webhooks = await (channel as TextChannel).fetchWebhooks();
      const matching = webhooks.filter((wh) => wh.name === personaWebhookName);

      for (const webhook of matching.values()) {
        await webhook.delete("Persona removed");
        deletedCount++;
      }

      const cacheKey = getPersonaWebhookCacheKey(channel.id, personaId);
      personaWebhookCache.delete(cacheKey);
    } catch (error) {
      log.warn(`[Webhook Manager] Failed to delete persona webhook in channel ${channel.id}`, error);
    }
  }

  if (deletedCount > 0) {
    log.info(`[Webhook Manager] Deleted ${deletedCount} persona webhook(s) for persona ${personaId}`);
  }

  return deletedCount;
}
