import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { Collection, EmbedBuilder, type Client, type GuildTextBasedChannel, type Message } from "discord.js";
import { CrossChannelMessageTool, consumePendingBoomerang } from "@/tools/functionCalls/crossChannelMessageTool";
import { PrivacyLevel } from "@/types/db/schema";
import type { ToolContext } from "@/types/tool/interfaces";
import * as userCache from "@/utils/cache/userCache";
import * as authorLabels from "@/utils/discord/contextAuthorLabel";
import * as targets from "@/utils/discord/targetResolver";
import * as proxyHistory from "@/utils/messageProxy/historyAttribution";
import * as contextBuilder from "@/utils/text/contextBuilder";
import * as chat from "@/events/messageCreate/tomoriChat";
import { initializeLocalizer, localizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";

const restores: Array<() => void> = [];
const sourceId = "source-channel";

beforeAll(initializeLocalizer);
afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore();
  consumePendingBoomerang(sourceId);
});

function message(id: string, authorId: string, webhookId: string | null = null): Message {
  return {
    id,
    author: { id: authorId, username: authorId, bot: webhookId !== null || authorId === "bot" },
    webhookId,
    content: id,
    embeds: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
  } as unknown as Message;
}

function fixture(history: Message[]) {
  const fetches: number[] = [];
  const target = {
    id: "target-channel",
    name: "garden",
    isThread: () => false,
    permissionsFor: () => ({ has: () => true }),
    messages: {
      fetch: async ({ limit }: { limit: number }) => {
        fetches.push(limit);
        const messages = limit === 1 ? [message("anchor", "bot")] : history;
        return new Collection(messages.map((entry) => [entry.id, entry]));
      },
    },
  } as unknown as GuildTextBasedChannel;
  const client = {
    user: { id: "bot" },
    guilds: { fetch: async () => ({ members: { me: {}, fetch: async () => ({}) } }) },
  } as unknown as Client;
  const context: ToolContext = {
    channel: { id: sourceId } as ToolContext["channel"],
    client,
    userId: "invoker",
    guildId: "guild",
    locale: "en-US",
    provider: "google",
    tomoriState: createPersona({ config: { message_fetch_limit: 35 } }),
  };
  const privacy = spyOn(userCache, "getCachedPrivacyLevel").mockImplementation(async (id) =>
    id === "hidden" || id === "hidden-host"
      ? PrivacyLevel.FULL
      : id === "partial"
        ? PrivacyLevel.PARTIAL
        : PrivacyLevel.MINIMAL,
  );
  const proxies = spyOn(proxyHistory, "resolveMessageProxyMessageIdentitiesForHistory").mockImplementation(
    async (messages) =>
      new Map(
        messages
          .filter((entry) => entry.id === "private-proxy")
          .map((entry) => [
            entry.id,
            { serviceId: "pluralkit", userDiscId: "pk:member", senderDiscId: "hidden-host", displayName: "Juno" },
          ]),
      ),
  );
  const labels = spyOn(authorLabels, "resolveContextAuthorLabel").mockImplementation(async (entry) => entry.author.id);
  const mentions = spyOn(contextBuilder, "convertMentions").mockImplementation(async (content) => content);
  const resolve = spyOn(targets, "resolveChannelTarget").mockResolvedValue({
    status: "resolved",
    channel: target,
    displayLabel: "garden",
    source: "legacy_id",
  });
  const dispatch = spyOn(chat, "tomoriChat").mockResolvedValue("run");
  const suppress = spyOn(chat, "suppressNextSelfReply").mockImplementation(() => {});
  for (const spy of [privacy, proxies, labels, mentions, resolve, dispatch, suppress]) {
    restores.push(() => spy.mockRestore());
  }
  return { context, privacy, proxies, labels, mentions, dispatch, fetches };
}

describe("cross-channel full privacy", () => {
  for (const mode of ["peek", "boomerang"] as const) {
    it(`${mode} excludes full-private direct and proxy authors while preserving visible history and refresh boundaries`, async () => {
      const marker = message("refresh", "hidden");
      marker.embeds = [
        new EmbedBuilder().setTitle(localizer("en-US", "commands.refresh.title")).toJSON(),
      ] as Message["embeds"];
      const history = [
        message("newest", "minimal"),
        message("private-proxy", "proxy-webhook", "proxy-webhook"),
        message("private-direct", "hidden"),
        message("partial-message", "partial"),
        message("persona-output", "bot"),
        message("ordinary-webhook", "other-hook", "other-hook"),
        marker,
        message("stale", "minimal"),
      ];
      const fixtureState = fixture(history);
      const result = await new CrossChannelMessageTool().execute(
        {
          target_channel: "garden",
          task: "Check the conversation",
          peek_only: mode === "peek",
          boomerang: mode === "boomerang",
        },
        fixtureState.context,
      );
      expect(result.success).toBe(true);
      const expectedContents = ["ordinary-webhook", "persona-output", "partial-message", "newest"];
      if (mode === "peek") {
        expect(result.data).toMatchObject({
          status: "cross_channel_peek_complete",
          message_count: expectedContents.length,
          messages: expectedContents.map((content) => ({ content })),
        });
        expect(fixtureState.dispatch).not.toHaveBeenCalled();
        expect(fixtureState.fetches).toEqual([35]);
      } else {
        expect(consumePendingBoomerang(sourceId)?.targetChannelMessages.map((entry) => entry.content)).toEqual(
          expectedContents,
        );
        expect(fixtureState.dispatch).toHaveBeenCalledTimes(1);
        expect(fixtureState.fetches).toEqual([1, 10]);
      }
      expect(fixtureState.privacy).toHaveBeenCalledWith("hidden-host");
      expect(fixtureState.privacy).not.toHaveBeenCalledWith("proxy-webhook");
      const formattedIds = fixtureState.labels.mock.calls.map(([entry]) => entry.id);
      expect(formattedIds).toEqual(expectedContents);
      expect(fixtureState.mentions.mock.calls.map(([content]) => content)).toEqual(expectedContents);
      expect(fixtureState.proxies.mock.calls[0]?.[0].map((entry) => entry.id)).not.toContain("stale");
    });

    it(`${mode} returns no history when every author has full privacy`, async () => {
      const fixtureState = fixture([
        message("private-direct", "hidden"),
        message("private-proxy", "proxy-webhook", "proxy-webhook"),
      ]);
      const result = await new CrossChannelMessageTool().execute(
        {
          target_channel: "garden",
          task: "Check the conversation",
          peek_only: mode === "peek",
          boomerang: mode === "boomerang",
        },
        fixtureState.context,
      );
      expect(result.success).toBe(true);
      if (mode === "peek") {
        expect(result.data).toMatchObject({ message_count: 0, messages: [] });
      } else {
        expect(consumePendingBoomerang(sourceId)?.targetChannelMessages).toEqual([]);
      }
      expect(fixtureState.labels).not.toHaveBeenCalled();
      expect(fixtureState.mentions).not.toHaveBeenCalled();
    });
  }
});
