import type { TextBasedChannel } from "discord.js";
import type { ReminderRow } from "@/types/db/schema";
import { log } from "@/utils/misc/logger";
import { readBoundedResponse } from "@/utils/security/boundedResponse";
import { ensureRoomRelayable, getLinkedMatrixRoom } from "./rooms";
import {
  MATRIX_MAX_TRACKED_SENT_EVENTS,
  getMatrixSettings,
  pendingMatrixReplyChannels,
  sentEventPersonas,
} from "./state";
import { sendToMatrixRoom } from "./media";

export { pendingMatrixReplyChannels } from "./state";

// The spec caps an event at 64 KiB in federation format; the client format adds `unsigned`
// metadata, so the headroom admits every valid event while bounding a misbehaving homeserver.
const EVENT_RESPONSE_MAX_BYTES = 128 * 1024;

export type PersonaReplyLookup = {
  isPersonaReply: boolean;
  replySnippet?: string;
};

export function getTrackedPersonaReply(eventId: string) {
  return sentEventPersonas.get(eventId);
}

export function trackSentMatrixEvent(eventId: string, personaName: string, sentText?: string): void {
  if (sentEventPersonas.size >= MATRIX_MAX_TRACKED_SENT_EVENTS) {
    const oldestKey = sentEventPersonas.keys().next().value;
    if (oldestKey) sentEventPersonas.delete(oldestKey);
  }

  sentEventPersonas.set(eventId, {
    personaName,
    replySnippet: buildReplySnippet(sentText),
  });
}

export function markPendingMatrixReply(channelDiscId: string): void {
  pendingMatrixReplyChannels.add(channelDiscId);
}

export function stripMatrixReplyFallback(body: string): string {
  if (!body.startsWith("> ")) return body;
  const blankLineIndex = body.indexOf("\n\n");
  if (blankLineIndex === -1) return body;
  return body.slice(blankLineIndex + 2).trim();
}

export async function getPersonaReplyEventMetadata(
  roomId: string,
  eventId: string,
  serverName: string,
): Promise<PersonaReplyLookup> {
  const homeserverUrl = process.env.MATRIX_HOMESERVER_URL;
  const asToken = process.env.MATRIX_ACCESS_TOKEN;
  if (!homeserverUrl || !asToken || !serverName) {
    return { isPersonaReply: false };
  }

  try {
    const url = `${homeserverUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${asToken}` },
      redirect: "error",
      signal: AbortSignal.timeout(getMatrixSettings().mediaTimeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { isPersonaReply: false };
    }

    const data: unknown = JSON.parse((await readBoundedResponse(response, EVENT_RESPONSE_MAX_BYTES)).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) return { isPersonaReply: false };
    const { sender, content } = data as { sender?: unknown; content?: unknown };
    const isPersonaReply =
      typeof sender === "string" && sender.startsWith("@_tomori_") && sender.endsWith(`:${serverName}`);
    if (!isPersonaReply) return { isPersonaReply: false };

    const body = content && typeof content === "object" ? (content as { body?: unknown }).body : undefined;
    return {
      isPersonaReply: true,
      replySnippet: typeof body === "string" ? buildReplySnippet(body) : undefined,
    };
  } catch (error) {
    log.warn(`Matrix bridge: failed to inspect reply event ${eventId} in room ${roomId}`, error);
    return { isPersonaReply: false };
  }
}

export async function sendMatrixReminderMention(
  channel: TextBasedChannel,
  reminder: ReminderRow,
  afterMessageId: string,
  reminderStartTime: number,
  botUserId: string,
): Promise<void> {
  const matrixRoomId = await getLinkedMatrixRoom(reminder.channel_disc_id);
  if (!matrixRoomId || !botUserId || !("messages" in channel)) return;
  if (!(await ensureRoomRelayable(matrixRoomId, channel.client))) return;

  const matrixLocalpart = reminder.user_discord_id.split(":")[0].replace(/^@/, "");
  const mentionPlaceholder = `@{${matrixLocalpart}}`;

  try {
    const recentMessages = await channel.messages.fetch({
      after: afterMessageId,
      limit: 100,
    });

    const relevantMessages = recentMessages.filter(
      (message) =>
        (message.author.id === botUserId || message.webhookId) && message.createdTimestamp >= reminderStartTime - 1000,
    );

    if (relevantMessages.some((message) => message.content.includes(mentionPlaceholder))) {
      return;
    }

    const matrixId = reminder.user_discord_id;
    const safeName = reminder.user_nickname.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    await sendToMatrixRoom(
      matrixRoomId,
      matrixId,
      undefined,
      undefined,
      `<a href="https://matrix.to/#/${matrixId}">${safeName}</a>`,
      [matrixId],
    );

    log.info(`Matrix: Added fallback mention for reminder ${reminder.reminder_id} to ensure recipient is pinged`);
  } catch (error) {
    log.warn(`Matrix: Failed to ensure mention for reminder ${reminder.reminder_id}:`, error);
  }
}

function buildReplySnippet(rawText?: string | null): string | undefined {
  if (!rawText) return undefined;
  const normalized = rawText.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.replace(/"/g, "'");
}
