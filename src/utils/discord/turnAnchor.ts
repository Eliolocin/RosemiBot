import type { Message, SendableChannels } from "discord.js";
import { log } from "@/utils/misc/logger";

/** Discord rejects an empty message body, so the placeholder is a blank braille character. */
const PLACEHOLDER_CONTENT = "⠀";

/**
 * Posts a placeholder for a system turn to borrow as its trigger, because a turn cannot run in a
 * channel with no messages. Pair it with `removeSeededTurnAnchor` once the turn has run.
 */
export async function seedTurnAnchor(channel: SendableChannels, contextLabel: string): Promise<Message | null> {
  try {
    const placeholder = await channel.send({ content: PLACEHOLDER_CONTENT });
    log.info(`Seeded placeholder message in channel ${channel.id} for ${contextLabel}`);
    return placeholder;
  } catch (error) {
    log.warn(`Failed to seed placeholder message in channel ${channel.id} for ${contextLabel}:`, error);
    return null;
  }
}

/** Every reply that quotes a trigger sets `failIfNotExists: false`, so the placeholder can go once the turn has run. */
export async function removeSeededTurnAnchor(placeholder: Message): Promise<void> {
  await placeholder
    .delete()
    .catch((error) => log.warn(`Failed to remove placeholder message in channel ${placeholder.channelId}:`, error));
}
