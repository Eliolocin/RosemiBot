import type { Message, SendableChannels } from "discord.js";
import { log } from "@/utils/misc/logger";

/** Discord rejects an empty message body, so the placeholder is a blank braille character. */
const PLACEHOLDER_CONTENT = "⠀";

const seededAnchors = new WeakSet<Message>();

/**
 * Posts then deletes a placeholder for a system turn to borrow as its trigger, since a turn cannot
 * run in a channel with no messages and Discord rejects an empty body.
 */
export async function seedTurnAnchor(channel: SendableChannels, contextLabel: string): Promise<Message | null> {
  try {
    const placeholder = await channel.send({ content: PLACEHOLDER_CONTENT });
    seededAnchors.add(placeholder);
    await placeholder
      .delete()
      .catch((error) =>
        log.warn(`Failed to remove placeholder message in channel ${channel.id} for ${contextLabel}:`, error),
      );
    log.info(`Seeded placeholder message in channel ${channel.id} for ${contextLabel}`);
    return placeholder;
  } catch (error) {
    log.warn(`Failed to seed placeholder message in channel ${channel.id} for ${contextLabel}:`, error);
    return null;
  }
}

/** True for the deleted placeholder a system turn borrowed, which context assembly must not record. */
export function isSeededTurnAnchor(message: Message): boolean {
  return seededAnchors.has(message);
}
