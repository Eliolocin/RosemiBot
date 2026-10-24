import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { ChannelType, Collection, type Attachment, type Message } from "discord.js";
import { PrivacyLevel } from "@/types/db/schema";
import { isAudioAttachment } from "@/utils/audio/audioAttachmentTranscription";
import { invalidateWhitelistCache } from "@/utils/cache/channelWhitelistCache";
import { invalidateAllPersonaUserBlockCacheForServer } from "@/utils/cache/personaUserBlockCache";
import { invalidatePersonalSpotlightCache } from "@/utils/cache/personalSpotlightCache";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { isSupportedVideoAttachmentContentType } from "@/utils/chat/contextMedia";
import { evaluateChatAdmission } from "@/utils/chat/admission";
import type { ChatIncoming } from "@/utils/chat/types";
import { personaRepository, personaUserBlockRepository, serverRepository } from "@/utils/db/repositories";
import { userRepository } from "@/utils/db/repositories/UserRepository";
import { whitelistRepository } from "@/utils/db/repositories/WhitelistRepository";
import { invalidateUserCache } from "@/utils/cache/userCache";
import * as speechEndpointResolver from "@/utils/provider/speechEndpointResolver";
import { createPersona, createUserRow } from "../../helpers/fixtures";

describe("audioAttachmentDisambiguation", () => {
  describe("isAudioAttachment", () => {
    it("returns true for audio MIME types and pure audio extensions", () => {
      expect(isAudioAttachment({ name: "voice.ogg", contentType: "audio/ogg" })).toBe(true);
      expect(isAudioAttachment({ name: "song.mp3", contentType: "audio/mpeg" })).toBe(true);
      expect(isAudioAttachment({ name: "voice.mp4", contentType: "audio/mp4" })).toBe(true);
      expect(isAudioAttachment({ name: "voice.opus", contentType: null })).toBe(true);
      expect(isAudioAttachment({ name: "sample.wav", contentType: null })).toBe(true);
      expect(isAudioAttachment({ name: "audio.m4a", contentType: null })).toBe(true);
    });

    it("returns false for video and image attachments", () => {
      expect(isAudioAttachment({ name: "clip.mp4", contentType: "video/mp4" })).toBe(false);
      expect(isAudioAttachment({ name: "clip.mp4", contentType: null })).toBe(false);
      expect(isAudioAttachment({ name: "recording.webm", contentType: "video/webm" })).toBe(false);
      expect(isAudioAttachment({ name: "recording.webm", contentType: null })).toBe(false);
      expect(isAudioAttachment({ name: "clip.mpeg", contentType: null })).toBe(false);
      expect(isAudioAttachment({ name: "video.mov", contentType: "video/quicktime" })).toBe(false);
      expect(isAudioAttachment({ name: "photo.png", contentType: "image/png" })).toBe(false);
      expect(isAudioAttachment({ name: "photo.jpg", contentType: "image/jpeg" })).toBe(false);
    });
  });

  describe("contextMedia", () => {
    it("recognizes video/quicktime as supported video MIME type", () => {
      expect(isSupportedVideoAttachmentContentType("video/quicktime")).toBe(true);
    });
  });

  describe("evaluateChatAdmission", () => {
    const memberId = "100000000000000021";
    const guildId = "300000000000000031";
    const channelId = "400000000000000041";
    const webhookId = "500000000000000051";

    let personaSpy: ReturnType<typeof spyOn>;
    let userRowSpy: ReturnType<typeof spyOn>;
    let privacySpy: ReturnType<typeof spyOn>;
    let blacklistSpy: ReturnType<typeof spyOn>;
    let spotlightSpy: ReturnType<typeof spyOn>;
    let whitelistSpy: ReturnType<typeof spyOn>;
    let personaBlockSpy: ReturnType<typeof spyOn>;
    let webhookSpy: ReturnType<typeof spyOn>;
    let transcriptionEndpointSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      invalidateUserCache(memberId);
      invalidateTomoriStateCache(guildId);
      invalidateWhitelistCache(guildId);
      invalidatePersonalSpotlightCache(1);
      invalidateAllPersonaUserBlockCacheForServer(1);
      personaSpy = spyOn(personaRepository, "loadAllForServer").mockResolvedValue([
        createPersona({ persona_nickname: "Mirri" }),
      ]);
      userRowSpy = spyOn(userRepository, "loadByDiscordId").mockResolvedValue(
        createUserRow({ user_disc_id: memberId }),
      );
      privacySpy = spyOn(userRepository, "getPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL);
      blacklistSpy = spyOn(userRepository, "isBlacklisted").mockResolvedValue(false);
      spotlightSpy = spyOn(userRepository, "serverHasPersonalSpotlights").mockResolvedValue(false);
      whitelistSpy = spyOn(whitelistRepository, "checkChannelWhitelist").mockResolvedValue({
        hasActiveWhitelist: false,
        hasActiveChannelWhitelist: false,
        isChannelWhitelisted: false,
        hasActiveRoleWhitelist: false,
        isRoleWhitelisted: false,
        hasActivePersonaWhitelist: false,
        isTriggerAllowed: true,
        hasChannelCooldownOverride: false,
      });
      personaBlockSpy = spyOn(personaUserBlockRepository, "loadActiveBlocksForUser").mockResolvedValue([]);
      webhookSpy = spyOn(serverRepository, "loadManagedWebhookByChannelAndWebhookId").mockImplementation(
        async (targetChannelId, targetWebhookId) => ({
          managed_webhook_id: 1,
          guild_disc_id: guildId,
          kind: "shared_channel",
          channel_disc_id: targetChannelId,
          webhook_disc_id: targetWebhookId,
          avatar_fingerprint: null,
          discord_avatar_hash: null,
          webhook_token: Buffer.from("token"),
          key_version: 1,
          created_at: new Date(),
        }),
      );
      transcriptionEndpointSpy = spyOn(speechEndpointResolver, "resolveActiveTranscriptionEndpoint").mockResolvedValue(
        null,
      );
    });

    afterEach(() => {
      for (const spy of [
        personaSpy,
        userRowSpy,
        privacySpy,
        blacklistSpy,
        spotlightSpy,
        whitelistSpy,
        personaBlockSpy,
        webhookSpy,
        transcriptionEndpointSpy,
      ]) {
        spy.mockRestore();
      }
      invalidateUserCache(memberId);
      invalidateTomoriStateCache(guildId);
      invalidateWhitelistCache(guildId);
      invalidatePersonalSpotlightCache(1);
      invalidateAllPersonaUserBlockCacheForServer(1);
    });

    it("admits a pure video reply referencing a persona webhook", async () => {
      const guild = {
        id: guildId,
        preferredLocale: "en-US",
        members: { cache: { get: () => null } },
      };

      const channel = {
        id: channelId,
        type: ChannelType.PublicThread,
        guild,
        isThread: () => true,
        parentId: "parent-channel-1",
        messages: {
          cache: new Map<string, Message>(),
          fetch: mock(async () => null as unknown as Message),
        },
        permissionsFor: () => ({ has: () => true }),
      };

      const client = { user: { id: "tomori-bot" } };

      const referencedMessage = {
        id: "ref-persona-1",
        content: "Hello!",
        webhookId,
        guildId,
        channelId,
        channel,
        author: { id: "webhook-bot", username: "Mirri", bot: true },
        partial: false,
        client,
      } as unknown as Message;

      channel.messages.cache.set("ref-persona-1", referencedMessage);
      channel.messages.fetch = mock(async () => referencedMessage);

      const videoAttachment = {
        name: "cat.mp4",
        contentType: "video/mp4",
        url: "https://cdn.discordapp.com/attachments/1/cat.mp4",
      } as Attachment;

      const incoming = {
        client,
        message: {
          id: "video-reply-1",
          content: "",
          webhookId: null,
          interaction: null,
          reference: { messageId: "ref-persona-1" },
          author: { id: memberId, bot: false, username: "member" },
          guild,
          guildId,
          channel,
          client,
          attachments: new Collection([["att-1", videoAttachment]]),
          mentions: { users: new Collection() },
        },
        isManuallyTriggered: false,
      } as unknown as ChatIncoming;

      const admission = await evaluateChatAdmission(incoming);

      expect(admission.disposition).toBe("run");
    });

    it("ignores a pure audio message when no speech endpoint is configured", async () => {
      const audioAttachment = {
        name: "voice.ogg",
        contentType: "audio/ogg",
        url: "https://cdn.discordapp.com/attachments/1/voice.ogg",
      } as Attachment;

      const guild = {
        id: guildId,
        preferredLocale: "en-US",
        members: { cache: { get: () => null } },
      };

      const incoming = {
        client: { user: { id: "tomori-bot" } },
        message: {
          id: "voice-message-1",
          content: "",
          webhookId: null,
          interaction: null,
          reference: null,
          author: { id: memberId, bot: false, username: "member" },
          guild,
          guildId,
          channel: {
            id: channelId,
            type: ChannelType.PublicThread,
            guild,
            messages: {
              cache: new Map(),
              fetch: mock(async () => null),
            },
            permissionsFor: () => ({ has: () => true }),
            isThread: () => false,
          },
          attachments: new Collection([["att-1", audioAttachment]]),
          mentions: { users: new Collection() },
        },
        isManuallyTriggered: false,
      } as unknown as ChatIncoming;

      const admission = await evaluateChatAdmission(incoming);

      expect(admission.disposition).toBe("ignore");
      expect(admission.disposition === "run" ? null : admission.reason).toBe("voice_transcription_failed");
    });
  });
});
