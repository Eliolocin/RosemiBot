import type { Client, Message, PartialMessage } from "discord.js";
import { markMessageProxyOriginalDeleted } from "@/utils/messageProxy/proxyExpectation";
import { log } from "@/utils/misc/logger";

export default async function messageDeleteHandler(
  _client: Client,
  deletedMessage: Message | PartialMessage,
): Promise<void> {
  const wasMessageProxyOriginal = markMessageProxyOriginalDeleted(deletedMessage.channelId, deletedMessage.id);
  if (wasMessageProxyOriginal) {
    log.info(
      `Message-proxy expectation marked proxied for deleted original ${deletedMessage.id} in channel ${deletedMessage.channelId}`,
    );
  }
}
