import { isIPv6 } from "node:net";
import type { Intent } from "matrix-appservice-bridge";
import { log } from "@/utils/misc/logger";
import { readBoundedResponse, ResponseSizeError } from "@/utils/security/boundedResponse";
import { safeDownload } from "@/utils/security/safeDownload";
import { getMatrixBridge, getMatrixSettings } from "./state";
import { ensurePersonaInRoom, getPersonaIntent } from "./userMapping";
import { trackSentMatrixEvent } from "./stateSync";

const BYTES_PER_MIB = 1024 * 1024;
// Discord accepts avatar uploads up to 10 MB, so a persona avatar never needs more.
const MATRIX_AVATAR_MAX_MB = 10;
const MEDIA_DOWNLOAD_ROUTE = "/_matrix/client/v1/media/download";
// The content repository's traversal guidance allows only these characters in a media ID.
const MEDIA_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SERVER_NAME_PATTERN = /^(\[[0-9A-Fa-f:.]{2,45}\]|[A-Za-z0-9.-]{1,255})(?::(\d{1,5}))?$/;
const DNS_NAME_PATTERN = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/;
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

export interface MxcIdentifier {
  serverName: string;
  mediaId: string;
}

type DownloadedMedia = { buffer: Buffer; mimeType: string };

export async function sendToMatrixRoom(
  roomId: string,
  text: string,
  personaName?: string,
  avatarUrl?: string | null,
  formattedText?: string,
  mentionedUserIds?: string[],
): Promise<void> {
  const bridge = getMatrixBridge();
  if (!bridge) return;

  try {
    const intent = await resolveSendIntent(roomId, personaName, avatarUrl ?? null);
    const messageContent: Record<string, unknown> = {
      msgtype: "m.text",
      body: text,
    };

    if (formattedText) {
      messageContent.formatted_body = formattedText;
      messageContent.format = "org.matrix.custom.html";
    }
    if (mentionedUserIds && mentionedUserIds.length > 0) {
      messageContent["m.mentions"] = { user_ids: mentionedUserIds };
    }

    const response = await intent.sendMessage(roomId, messageContent);
    if (personaName && (response as { event_id?: string })?.event_id) {
      trackSentMatrixEvent((response as { event_id: string }).event_id, personaName, text);
    }
  } catch (error) {
    log.warn(`Matrix bridge: failed to send message to room ${roomId}`, error);
  }
}

export async function sendAttachmentToMatrixRoom(
  roomId: string,
  data: Buffer,
  filename: string,
  mimeType: string,
  size: number,
  personaName?: string,
  avatarUrl?: string | null,
): Promise<void> {
  try {
    const intent = await resolveSendIntent(roomId, personaName, avatarUrl ?? null);
    const mxcUri = await intent.uploadContent(data, {
      type: mimeType,
      name: filename,
    });

    const info = { mimetype: mimeType, size };
    const msgtype = mimeType.startsWith("image/") ? "m.image" : mimeType.startsWith("video/") ? "m.video" : "m.file";
    const mediaResponse = await intent.sendMessage(roomId, {
      msgtype,
      body: filename,
      url: mxcUri,
      info,
    });

    if (personaName && mediaResponse?.event_id) {
      trackSentMatrixEvent(mediaResponse.event_id, personaName);
    }
  } catch (error) {
    log.warn(`Matrix bridge: failed to send attachment to room ${roomId}`, error);
  }
}

export async function downloadAvatar(url: string): Promise<DownloadedMedia | null> {
  const result = await safeDownload(url, {
    maxSizeMB: MATRIX_AVATAR_MAX_MB,
    timeoutMs: getMatrixSettings().mediaTimeoutMs,
  });
  if (!result.success || !result.buffer) {
    log.warn(`Matrix appservice: avatar download refused or failed (${result.error ?? "unknown"})`);
    return null;
  }
  return { buffer: result.buffer, mimeType: result.contentType ?? "image/png" };
}

/**
 * Downloads homeserver media with the appservice token, refusing any identifier that could leave
 * the authenticated download route.
 */
export async function downloadMatrixMedia(
  mxcUrl: string,
  homeserverUrl: string,
  asToken: string,
  knownSize?: number,
): Promise<DownloadedMedia | null> {
  const { maxAttachmentBytes, mediaTimeoutMs } = getMatrixSettings();
  if (knownSize !== undefined && knownSize > maxAttachmentBytes) {
    return null;
  }

  const identifier = parseMxcUri(mxcUrl);
  const downloadUrl = identifier ? buildMediaDownloadUrl(homeserverUrl, identifier) : null;
  if (!downloadUrl) {
    log.warn("Matrix bridge: refused a media identifier outside the authenticated download route");
    return null;
  }

  try {
    const response = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${asToken}` },
      redirect: "manual",
      signal: AbortSignal.timeout(mediaTimeoutMs),
    });

    if (response.status >= 300 && response.status < 400) {
      return await followAnonymousMediaRedirect(response, downloadUrl, maxAttachmentBytes, mediaTimeoutMs);
    }
    if (!response.ok) {
      await response.body?.cancel();
      log.warn(`Matrix bridge: media fetch failed (${response.status})`);
      return null;
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxAttachmentBytes) {
      await response.body?.cancel();
      return null;
    }

    return {
      buffer: await readBoundedResponse(response, maxAttachmentBytes),
      mimeType: response.headers.get("content-type") ?? "application/octet-stream",
    };
  } catch (error) {
    if (error instanceof ResponseSizeError) {
      log.warn(`Matrix bridge: media exceeded ${maxAttachmentBytes} bytes while streaming`);
      return null;
    }
    log.warn("Matrix bridge: failed to download media", error);
    return null;
  }
}

/**
 * The spec lets the download route redirect to a CDN, but a redirect response cannot authorize a
 * destination to receive the appservice token, so the target is fetched anonymously through the
 * guarded downloader.
 */
async function followAnonymousMediaRedirect(
  response: Response,
  downloadUrl: URL,
  maxAttachmentBytes: number,
  mediaTimeoutMs: number,
): Promise<DownloadedMedia | null> {
  const location = response.headers.get("location");
  await response.body?.cancel();
  const target = location ? URL.parse(location, downloadUrl) : null;
  if (!target || (target.protocol !== "https:" && target.protocol !== "http:")) {
    log.warn(`Matrix bridge: media redirect (${response.status}) has no usable HTTP location`);
    return null;
  }

  const result = await safeDownload(target.toString(), {
    maxSizeMB: maxAttachmentBytes / BYTES_PER_MIB,
    timeoutMs: mediaTimeoutMs,
  });
  if (!result.success || !result.buffer) {
    log.warn(`Matrix bridge: redirected media download refused or failed (${result.error ?? "unknown"})`);
    return null;
  }
  return { buffer: result.buffer, mimeType: result.contentType ?? "application/octet-stream" };
}

/**
 * Parses `mxc://<server-name>/<media-id>` into exactly two segments, so dot segments, separators,
 * encoded traversal, queries, and fragments never reach a token-bearing request.
 */
export function parseMxcUri(value: string): MxcIdentifier | null {
  const scheme = "mxc://";
  if (!value.startsWith(scheme)) return null;
  const rest = value.slice(scheme.length);
  const separator = rest.indexOf("/");
  if (separator <= 0) return null;

  const serverName = rest.slice(0, separator);
  const mediaId = rest.slice(separator + 1);
  if (!isMatrixServerName(serverName) || !MEDIA_ID_PATTERN.test(mediaId)) return null;
  return { serverName, mediaId };
}

/**
 * Follows the appendix server-name grammar: an IPv4 literal, bracketed IPv6 literal, or DNS name,
 * with an optional port.
 */
function isMatrixServerName(serverName: string): boolean {
  const match = SERVER_NAME_PATTERN.exec(serverName);
  if (!match) return false;
  const [, host, port] = match;
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65_535)) return false;
  if (host.startsWith("[")) return isIPv6(host.slice(1, -1));
  if (IPV4_PATTERN.test(host)) return host.split(".").every((octet) => Number(octet) <= 255);
  return DNS_NAME_PATTERN.test(host);
}

function buildMediaDownloadUrl(homeserverUrl: string, identifier: MxcIdentifier): URL | null {
  const base = URL.parse(homeserverUrl);
  if (!base || (base.protocol !== "https:" && base.protocol !== "http:")) return null;

  const expectedPath =
    `${base.pathname.replace(/\/+$/, "")}${MEDIA_DOWNLOAD_ROUTE}` +
    `/${encodeURIComponent(identifier.serverName)}/${encodeURIComponent(identifier.mediaId)}`;
  const url = new URL(expectedPath, base.origin);
  if (url.origin !== base.origin || url.pathname !== expectedPath) return null;
  return url;
}

async function resolveSendIntent(roomId: string, personaName?: string, avatarUrl?: string | null): Promise<Intent> {
  const bridge = getMatrixBridge();
  if (!bridge) {
    throw new Error("Matrix bridge is not configured");
  }

  if (!personaName) {
    return bridge.getIntent();
  }

  const serverName = process.env.MATRIX_SERVER_NAME ?? "";
  const localpart = `_tomori_${personaName.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
  const userId = `@${localpart}:${serverName}`;
  const intent = (await getPersonaIntent(personaName, avatarUrl ?? null)) ?? bridge.getIntent();
  await ensurePersonaInRoom(intent, userId, localpart, roomId);
  return intent;
}
