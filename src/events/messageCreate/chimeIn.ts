import type { Client, Message } from "discord.js";
import { observeChimeInMessage } from "@/modules/natural-nudges/runtime/chimeIns";
import { log } from "@/utils/misc/logger";

/**
 * Natural Nudges Chime-in counter. Not awaited, because handlers run one after another and a cold
 * settings read here must never delay the chat handler behind it.
 */
export default async function chimeInHandler(client: Client, message: Message): Promise<void> {
  void observeChimeInMessage(client, message).catch((error) =>
    log.warn("Natural Nudges: Chime-in counter failed", error, { metadata: { channelId: message.channelId } }),
  );
}
