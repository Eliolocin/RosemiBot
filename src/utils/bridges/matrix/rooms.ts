import { type Client, EmbedBuilder } from "discord.js";
import { ColorCode, log } from "@/utils/misc/logger";
import { readBoundedResponse } from "@/utils/security/boundedResponse";
import { localizer } from "@/utils/text/localizer";
import {
  MATRIX_ENCRYPTION_STATE_TYPE,
  MATRIX_LINK_CACHE_TTL_MS,
  channelLinkCache,
  getMatrixBridge,
  getMatrixSettings,
  roomLinkCache,
  unencryptedRoomCache,
} from "./state";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";

// A state lookup answers with one small JSON object; this only bounds a misbehaving homeserver.
const STATE_RESPONSE_MAX_BYTES = 64 * 1024;

/**
 * Only `unencrypted` permits relaying. `unavailable` covers every answer that cannot prove the
 * room lacks encryption, so the bridge never sends plaintext into a room it could not verify.
 */
export type MatrixRoomEncryptionState = "encrypted" | "unencrypted" | "unavailable";

export async function joinMatrixRoom(roomId: string): Promise<void> {
  const bridge = getMatrixBridge();
  if (!bridge) return;

  await bridge.getIntent().join(roomId, getJoinViaServers(roomId));
}

export function getJoinViaServers(roomId: string): string[] | undefined {
  const localServer = process.env.MATRIX_SERVER_NAME?.trim();
  const roomDelimiter = roomId.indexOf(":");
  const roomServer = roomDelimiter === -1 ? undefined : roomId.slice(roomDelimiter + 1).trim();
  const viaServers = new Set<string>();
  if (roomServer) viaServers.add(roomServer);
  if (localServer) viaServers.add(localServer);
  const list = Array.from(viaServers);
  return list.length > 0 ? list : undefined;
}

export async function getLinkedMatrixRoom(channelDiscId: string): Promise<string | null> {
  const now = Date.now();
  const cached = channelLinkCache.get(channelDiscId);
  if (cached && now - cached.cachedAt < MATRIX_LINK_CACHE_TTL_MS) {
    return cached.roomId;
  }

  const roomId = await serverRepository.getExistingMatrixLink(channelDiscId);
  channelLinkCache.set(channelDiscId, { roomId, cachedAt: now });
  return roomId;
}

export async function getDiscordChannelForRoom(matrixRoomId: string): Promise<string | null> {
  const now = Date.now();
  const cached = roomLinkCache.get(matrixRoomId);
  if (cached && now - cached.cachedAt < MATRIX_LINK_CACHE_TTL_MS) {
    return cached.channelDiscId;
  }

  const channelDiscId = await serverRepository.getDiscordChannelForMatrixRoom(matrixRoomId);
  roomLinkCache.set(matrixRoomId, { channelDiscId, cachedAt: now });
  return channelDiscId;
}

/**
 * Reads the room's `m.room.encryption` state. The client-server API reserves 404 for "the room has
 * no state with the given type or key", and the `M_NOT_FOUND` errcode separates that from a proxy's
 * generic 404 page. Authentication failures, other statuses, malformed bodies, and timeouts are
 * `unavailable`.
 */
export async function getRoomEncryptionState(roomId: string): Promise<MatrixRoomEncryptionState> {
  const homeserverUrl = process.env.MATRIX_HOMESERVER_URL;
  const asToken = process.env.MATRIX_ACCESS_TOKEN;
  if (!homeserverUrl || !asToken) return "unavailable";

  try {
    const url = `${homeserverUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${MATRIX_ENCRYPTION_STATE_TYPE}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${asToken}` },
      redirect: "error",
      signal: AbortSignal.timeout(getMatrixSettings().mediaTimeoutMs),
    });
    if (response.status !== 200 && response.status !== 404) {
      await response.body?.cancel();
      log.warn(`Matrix bridge: encryption state for room ${roomId} returned ${response.status}`);
      return "unavailable";
    }

    const body: unknown = JSON.parse((await readBoundedResponse(response, STATE_RESPONSE_MAX_BYTES)).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) return "unavailable";
    if (response.status === 200) return "encrypted";
    return (body as { errcode?: unknown }).errcode === "M_NOT_FOUND" ? "unencrypted" : "unavailable";
  } catch (error) {
    log.warn(`Matrix bridge: failed to check encryption state for room ${roomId}`, error);
    return "unavailable";
  }
}

/**
 * Gates every relay in either direction on a confirmed-unencrypted room. Encryption is permanent,
 * so an encrypted room loses its link; an unverifiable room only pauses until a later check.
 *
 * @param options.refresh Skips the cached confirmation, for when the room's encryption state changed.
 */
export async function ensureRoomRelayable(
  roomId: string,
  discordClient: Client,
  options: { refresh?: boolean } = {},
): Promise<boolean> {
  const confirmedAt = unencryptedRoomCache.get(roomId);
  if (!options.refresh && confirmedAt !== undefined && Date.now() - confirmedAt < MATRIX_LINK_CACHE_TTL_MS) {
    return true;
  }

  const state = await getRoomEncryptionState(roomId);
  if (state === "unencrypted") {
    unencryptedRoomCache.set(roomId, Date.now());
    return true;
  }

  unencryptedRoomCache.delete(roomId);
  if (state === "encrypted") {
    await unlinkEncryptedRoom(roomId, discordClient);
  } else {
    log.warn(`Matrix bridge: paused relay for room ${roomId} because its encryption state could not be confirmed`);
  }
  return false;
}

async function unlinkEncryptedRoom(roomId: string, discordClient: Client): Promise<void> {
  const channelDiscId = await serverRepository.unlinkMatrixRoom(roomId);
  if (!channelDiscId) return;
  invalidateMatrixLinkCache(channelDiscId, roomId);
  log.warn(`Matrix bridge: unlinked channel ${channelDiscId} because room ${roomId} enabled encryption`);

  const channel = await discordClient.channels.fetch(channelDiscId).catch(() => null);
  if (!channel?.isSendable() || channel.isDMBased()) return;
  const locale = channel.guild.preferredLocale;
  await channel
    .send({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "matrix.encryption_unlinked.title"))
          .setDescription(
            localizer(locale, "matrix.encryption_unlinked.description", {
              room_id: roomId,
              link_command: "/matrix link",
            }),
          )
          .setColor(ColorCode.WARN),
      ],
    })
    .catch((error) =>
      log.warn(`Matrix bridge: failed to post the encryption unlink notice in ${channelDiscId}`, error),
    );
}

export function invalidateMatrixLinkCache(channelDiscId: string, matrixRoomId?: string): void {
  channelLinkCache.delete(channelDiscId);
  if (matrixRoomId) {
    roomLinkCache.delete(matrixRoomId);
    unencryptedRoomCache.delete(matrixRoomId);
  }
}
