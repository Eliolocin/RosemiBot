import { describe, expect, it } from "bun:test";
import type { Client } from "discord.js";
import { HumanizerDegree, type AssembledServerConfig, type TomoriState } from "@/types/db/schema";
import { appendDialogueHistoryContext, DOCUMENT_HINT_TEMPLATE } from "@/utils/text/context/dialogueHistory";
import type { SimplifiedMessageForContext } from "@/utils/text/context/types";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { createPersona } from "../../helpers/fixtures";

function makeConfig(): AssembledServerConfig {
  return {
    message_fetch_limit: 80,
    context_note: null,
    context_note_depth: 0,
    humanizer_degree: HumanizerDegree.NONE,
    personal_memories_enabled: true,
    uncensor_unicode_space_enabled: false,
    uncensor_sanitize_enabled: false,
  } as AssembledServerConfig;
}

// The shared factory's default row (google, tool-capable) covers every field this file set by
// hand, so only the note fields are overridden.
function makeTomoriState(): TomoriState {
  return createPersona({
    context_note: null,
    context_note_depth: 0,
  });
}

function makeRemoteImageMessage(
  remoteMediaSourceKind: SimplifiedMessageForContext["remoteMediaSourceKind"],
  sourceMessageId: string,
): SimplifiedMessageForContext {
  return {
    id: "wrapper-message",
    authorId: "user-1",
    authorName: "Alice",
    authorType: "user",
    content: "Use this image",
    mediaSourceMessageIds: [sourceMessageId],
    remoteMediaSourceKind,
    imageAttachments: [
      {
        url: "https://cdn.discordapp.com/attachments/1/2/reference.png",
        proxyUrl: "https://media.discordapp.net/attachments/1/2/reference.png",
        mimeType: "image/png",
        filename: "reference.png",
        sourceMessageId,
      },
    ],
    videoAttachments: [],
  };
}

async function buildMediaReference(
  message: SimplifiedMessageForContext,
): Promise<{ mediaId: string; messageIdMap: MessageIdMap }> {
  const contextItems: Parameters<typeof appendDialogueHistoryContext>[0]["contextItems"] = [];
  const messageIdMap = new MessageIdMap();

  await appendDialogueHistoryContext({
    contextItems,
    client: {} as Client,
    guildId: "guild-1",
    simplifiedMessageHistory: [message],
    botName: "Tomori",
    tomoriConfig: makeConfig(),
    tomoriState: makeTomoriState(),
    documentHintTemplate: DOCUMENT_HINT_TEMPLATE,
    includeTimestamps: false,
    isUserImpersonation: false,
    triggererFormattedName: "Alice",
    messageIdMap,
    uncensorInputOptions: { unicodeSpacesEnabled: false, sanitizeEnabled: false },
    convertMentions: async (text) => text,
  });

  const descriptor = contextItems.flatMap((item) => item.mediaDescriptors ?? [])[0];
  if (!descriptor) {
    throw new Error("Expected an image media descriptor");
  }

  return { mediaId: descriptor.mediaId, messageIdMap };
}

describe("appendDialogueHistoryContext — remote media references", () => {
  it("maps reply-derived images to the replied-to message that owns them", async () => {
    const { mediaId, messageIdMap } = await buildMediaReference(makeRemoteImageMessage("reply", "image-message"));

    expect(mediaId).toBe("media_1");
    expect(messageIdMap.resolve(mediaId)).toBe("image-message");
  });

  it("keeps forwarded images mapped to the fetchable wrapper message", async () => {
    const { mediaId, messageIdMap } = await buildMediaReference(makeRemoteImageMessage("forwarded", "wrapper-message"));

    expect(mediaId).toBe("media_1");
    expect(messageIdMap.resolve(mediaId)).toBe("wrapper-message");
  });

  it("keeps reply and local images mapped to their respective owners", async () => {
    const message = makeRemoteImageMessage(undefined, "image-message");
    message.mediaSourceMessageIds = ["wrapper-message", "image-message"];
    message.imageAttachments.push({
      url: "https://cdn.discordapp.com/attachments/1/2/local.png",
      proxyUrl: "https://media.discordapp.net/attachments/1/2/local.png",
      mimeType: "image/png",
      filename: "local.png",
    });

    const contextItems: Parameters<typeof appendDialogueHistoryContext>[0]["contextItems"] = [];
    const messageIdMap = new MessageIdMap();
    await appendDialogueHistoryContext({
      contextItems,
      client: {} as Client,
      guildId: "guild-1",
      simplifiedMessageHistory: [message],
      botName: "Tomori",
      tomoriConfig: makeConfig(),
      tomoriState: makeTomoriState(),
      documentHintTemplate: DOCUMENT_HINT_TEMPLATE,
      includeTimestamps: false,
      isUserImpersonation: false,
      triggererFormattedName: "Alice",
      messageIdMap,
      uncensorInputOptions: { unicodeSpacesEnabled: false, sanitizeEnabled: false },
      convertMentions: async (text) => text,
    });

    const descriptorMediaIds = contextItems.flatMap((item) =>
      (item.mediaDescriptors ?? []).map((descriptor) => descriptor.mediaId),
    );
    expect(descriptorMediaIds).toEqual(["media_1", "media_2"]);
    expect(messageIdMap.resolve("media_1")).toBe("image-message");
    expect(messageIdMap.resolve("media_2")).toBe("wrapper-message");
  });

  it("does not let a wrapper custom emoji replace the replied-to image handle", async () => {
    const message = makeRemoteImageMessage(undefined, "image-message");
    message.mediaSourceMessageIds = ["wrapper-message", "image-message"];
    message.imageAttachments.push({
      url: "https://cdn.discordapp.com/emojis/123456789012345678.png",
      proxyUrl: "https://cdn.discordapp.com/emojis/123456789012345678.png",
      mimeType: "image/png",
      filename: "local-emoji.png",
      isEmoji: true,
    });

    const contextItems: Parameters<typeof appendDialogueHistoryContext>[0]["contextItems"] = [];
    const messageIdMap = new MessageIdMap();
    await appendDialogueHistoryContext({
      contextItems,
      client: {} as Client,
      guildId: "guild-1",
      simplifiedMessageHistory: [message],
      botName: "Tomori",
      tomoriConfig: makeConfig(),
      tomoriState: makeTomoriState(),
      documentHintTemplate: DOCUMENT_HINT_TEMPLATE,
      includeTimestamps: false,
      isUserImpersonation: false,
      triggererFormattedName: "Alice",
      messageIdMap,
      uncensorInputOptions: { unicodeSpacesEnabled: false, sanitizeEnabled: false },
      convertMentions: async (text) => text,
    });

    const descriptorMediaIds = contextItems.flatMap((item) =>
      (item.mediaDescriptors ?? []).map((descriptor) => descriptor.mediaId),
    );
    expect(descriptorMediaIds).toEqual(["media_1"]);
    expect(messageIdMap.resolve("media_1")).toBe("image-message");
    expect(messageIdMap.getOpaque("wrapper-message", "media")).toBeUndefined();
  });

  it("points a reply-carried file hint at its source message and never expands the filename", async () => {
    const filename = "{document_tool} {{if tool:read_file}}x{{/if}} $&.pdf";
    const message: SimplifiedMessageForContext = {
      ...makeRemoteImageMessage(undefined, "unused"),
      content: "pdf見て",
      mediaSourceMessageIds: undefined,
      imageAttachments: [],
      documentAttachments: [{ filename, sourceMessageId: "file-message" }],
    };

    const contextItems: Parameters<typeof appendDialogueHistoryContext>[0]["contextItems"] = [];
    const messageIdMap = new MessageIdMap();
    await appendDialogueHistoryContext({
      contextItems,
      client: {} as Client,
      guildId: "guild-1",
      simplifiedMessageHistory: [message],
      botName: "Tomori",
      tomoriConfig: makeConfig(),
      tomoriState: makeTomoriState(),
      documentHintTemplate: "[System: `{filename}` ({media_id})]",
      includeTimestamps: false,
      isUserImpersonation: false,
      triggererFormattedName: "Alice",
      messageIdMap,
      uncensorInputOptions: { unicodeSpacesEnabled: false, sanitizeEnabled: false },
      convertMentions: async (text) => text,
    });

    const texts = contextItems.flatMap((item) => item.parts.map((part) => (part.type === "text" ? part.text : "")));
    expect(texts).toContain(`[System: \`${filename}\` (media_1)]`);
    expect(messageIdMap.resolve("media_1")).toBe("file-message");
  });
});
