import { beforeAll, describe, expect, it } from "bun:test";
import { ChannelType, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { NOTICE_CONFIG_HINT_KEY, type NoticeVerbosity, type ToolNoticeKey } from "@/constants/toolNotices";
import type { ToolContext } from "@/types/tool/interfaces";
import { sendMemoryEmbedWithExpand, sendToolNoticeContainer } from "@/utils/discord/expandableEmbedNotice";
import { sendToolNotice } from "@/utils/discord/toolProgressNotice";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy } from "../../helpers/localeCases";

beforeAll(async () => initializeLocalizer());

const SOURCE_URL = "https://discord.com/channels/1/200/300";

/** A guild channel every member can read unless `restricted` denies `@everyone` the channel. */
function fakeChannel(id: string, options: { dm?: boolean; parentId?: string; restricted?: boolean } = {}) {
  const sent: string[] = [];
  const audience = (restricted: boolean) => ({
    permissionsFor: () => new PermissionsBitField(restricted ? 0n : PermissionFlagsBits.ViewChannel),
    permissionOverwrites: { cache: [] },
  });
  return {
    id,
    sent,
    guildId: "guild_1",
    guild: { roles: { everyone: { id: "guild_1" } } },
    type: options.parentId === undefined ? ChannelType.GuildText : ChannelType.PublicThread,
    parentId: options.parentId ?? null,
    parent: options.parentId === undefined ? null : { id: options.parentId, ...audience(false) },
    ...audience(options.restricted ?? false),
    isThread: () => options.parentId !== undefined,
    isDMBased: () => options.dm ?? false,
    send: async (payload: unknown) => {
      sent.push(JSON.stringify(payload));
      return null;
    },
  };
}

function buildContext(input: {
  hidden: ToolNoticeKey[];
  conversation: ReturnType<typeof fakeChannel>;
  thoughtLog?: ReturnType<typeof fakeChannel>;
  privateChannelIds?: string[];
  verbosity?: NoticeVerbosity;
}): ToolContext {
  return {
    channel: input.conversation,
    locale: "en-US",
    message: { url: SOURCE_URL },
    client: {
      channels: { fetch: async (id: string) => (input.thoughtLog?.id === id ? input.thoughtLog : null) },
    },
    tomoriState: {
      config: {
        tool_notice_hidden_keys: input.hidden,
        tool_notice_verbosity: input.verbosity ?? "minimal",
        thought_log_channel_disc_id: input.thoughtLog?.id ?? null,
        private_channel_ids: input.privateChannelIds ?? [],
      },
    },
  } as unknown as ToolContext;
}

const memoryNotice = {
  titleKey: "genai.self_teach.server_memory_learned_title",
  titleVars: { persona_nickname: "Tomori" },
  descriptionKey: "genai.self_teach.server_memory_learned_description",
  descriptionVars: { memory_content: "likes tea" },
  footerKey: "genai.self_teach.server_memory_footer",
};

// JSON-encoded payloads escape backticks and quotes the same way, so compare in that encoding.
const encoded = (text: string) => JSON.stringify(text).slice(1, -1);
const configHint = () => encoded(localizedCopy("en-US", NOTICE_CONFIG_HINT_KEY));

describe("hideable tool notices", () => {
  it("posts a visible memory notice in the conversation with the shared /config line under its own footer", async () => {
    const conversation = fakeChannel("200");
    const thoughtLog = fakeChannel("900");
    await sendMemoryEmbedWithExpand(
      buildContext({ hidden: [], conversation, thoughtLog, verbosity: "verbose" }),
      memoryNotice,
      "likes tea",
    );

    expect(thoughtLog.sent).toHaveLength(0);
    expect(conversation.sent).toHaveLength(1);
    const footer = encoded(localizedCopy("en-US", "genai.self_teach.server_memory_footer"));
    expect(conversation.sent[0]).toContain(`-# ${footer}\\n-# ${configHint()}`);
  });

  it("posts a Minimal memory notice as its title alone, with no expand button for long content", async () => {
    const conversation = fakeChannel("200");
    const longContent = "likes tea ".repeat(100);
    await sendMemoryEmbedWithExpand(buildContext({ hidden: [], conversation }), memoryNotice, longContent);

    expect(conversation.sent).toHaveLength(1);
    const [payload] = conversation.sent;
    const title = localizedCopy("en-US", memoryNotice.titleKey, memoryNotice.titleVars);
    expect(payload).toContain(`### ${encoded(title)}`);
    expect(payload).not.toContain("likes tea");
    expect(payload).not.toContain(configHint());
    expect(payload).not.toContain("memory_notice_expand");
  });

  it("keeps the expand button on a Verbose memory notice whose content overflows the preview", async () => {
    const conversation = fakeChannel("200");
    await sendMemoryEmbedWithExpand(
      buildContext({ hidden: [], conversation, verbosity: "verbose" }),
      memoryNotice,
      "likes tea ".repeat(100),
    );

    expect(conversation.sent[0]).toContain("memory_notice_expand");
  });

  it("shrinks a visible progress notice to its title and drops the /kill hint", async () => {
    const conversation = fakeChannel("200");
    const context = buildContext({ hidden: [], conversation });
    context.showKillHint = true;
    await sendToolNotice(
      context,
      "web_search",
      {
        titleKey: "tools.search.category_search_title",
        titleVars: { category: "Web", query: "tea" },
        description: "Looking around",
      },
      "test",
    );

    expect(conversation.sent).toHaveLength(1);
    const [payload] = conversation.sent;
    const searchTitle = { category: "Web", query: "tea" };
    expect(payload).toContain(encoded(localizedCopy("en-US", "tools.search.category_search_title", searchTitle)));
    expect(payload).not.toContain("Looking around");
    expect(payload).not.toContain(encoded(localizedCopy("en-US", "tools.tool_notice.kill_hint")));
  });

  it("reroutes a hidden memory notice to the thought log with a link to its source message", async () => {
    const conversation = fakeChannel("200");
    const thoughtLog = fakeChannel("900");
    await sendMemoryEmbedWithExpand(
      buildContext({ hidden: ["memory_update"], conversation, thoughtLog }),
      memoryNotice,
      "likes tea",
    );

    expect(conversation.sent).toHaveLength(0);
    expect(thoughtLog.sent).toHaveLength(1);
    expect(thoughtLog.sent[0]).toContain(SOURCE_URL);
    // The thought log is the full record, so it keeps the Verbose card even on a Minimal server.
    expect(thoughtLog.sent[0]).toContain("likes tea");
    expect(thoughtLog.sent[0]).toContain(configHint());
  });

  it("mirrors a Minimal progress notice to the thought log as a full verbose card with a source backlink", async () => {
    const conversation = fakeChannel("200");
    const thoughtLog = fakeChannel("900");
    const context = buildContext({ hidden: [], conversation, thoughtLog });
    context.showKillHint = true;
    await sendToolNotice(
      context,
      "web_search",
      {
        titleKey: "tools.search.category_search_title",
        titleVars: { category: "Web", query: "tea" },
        description: "Looking around",
      },
      "test",
    );

    expect(conversation.sent).toHaveLength(1);
    expect(thoughtLog.sent).toHaveLength(1);
    const [convPayload] = conversation.sent;
    const [thoughtPayload] = thoughtLog.sent;

    const searchTitle = { category: "Web", query: "tea" };
    expect(convPayload).toContain(encoded(localizedCopy("en-US", "tools.search.category_search_title", searchTitle)));
    expect(convPayload).not.toContain("Looking around");
    expect(convPayload).not.toContain(encoded(localizedCopy("en-US", "tools.tool_notice.kill_hint")));

    expect(thoughtPayload).toContain(SOURCE_URL);
    expect(thoughtPayload).toContain("Looking around");
    expect(thoughtPayload).toContain(encoded(localizedCopy("en-US", "tools.tool_notice.kill_hint")));
  });

  it("keeps a Verbose progress notice conversation-only to avoid redundancy", async () => {
    const conversation = fakeChannel("200");
    const thoughtLog = fakeChannel("900");
    const context = buildContext({ hidden: [], conversation, thoughtLog, verbosity: "verbose" });
    context.showKillHint = true;
    await sendToolNotice(
      context,
      "web_search",
      {
        titleKey: "tools.search.category_search_title",
        titleVars: { category: "Web", query: "tea" },
        description: "Looking around",
      },
      "test",
    );

    expect(conversation.sent).toHaveLength(1);
    expect(thoughtLog.sent).toHaveLength(0);
  });

  it("does not mirror a Minimal notice to the thought log when sent from a DM or private channel", async () => {
    const dmConversation = fakeChannel("200", { dm: true });
    const dmThoughtLog = fakeChannel("900");
    await sendToolNotice(
      buildContext({ hidden: [], conversation: dmConversation, thoughtLog: dmThoughtLog }),
      "web_search",
      {
        titleKey: "tools.search.category_search_title",
        titleVars: { category: "Web", query: "tea" },
        description: "Looking around",
      },
      "test",
    );

    expect(dmConversation.sent).toHaveLength(1);
    expect(dmThoughtLog.sent).toHaveLength(0);

    const privateConversation = fakeChannel("200");
    const privateThoughtLog = fakeChannel("900");
    await sendMemoryEmbedWithExpand(
      buildContext({
        hidden: [],
        conversation: privateConversation,
        thoughtLog: privateThoughtLog,
        privateChannelIds: ["200"],
      }),
      memoryNotice,
      "likes tea",
    );

    expect(privateConversation.sent).toHaveLength(1);
    expect(privateThoughtLog.sent).toHaveLength(0);
  });

  it("hides only the toggled notice type", async () => {
    const conversation = fakeChannel("200");
    const thoughtLog = fakeChannel("900");
    await sendToolNoticeContainer(
      buildContext({ hidden: ["task_update"], conversation, thoughtLog }),
      "user_info_update",
      {
        titleKey: "tools.user_info_update.success_title",
        titleVars: { target_user: "Bau" },
        description: "Updated",
      },
    );

    expect(conversation.sent).toHaveLength(1);
    expect(thoughtLog.sent).toHaveLength(1);
    expect(thoughtLog.sent[0]).toContain(SOURCE_URL);
  });

  it.each<[string, Omit<Parameters<typeof buildContext>[0], "hidden">]>([
    ["no thought log is set", { conversation: fakeChannel("200") }],
    ["the notice came from a DM", { conversation: fakeChannel("200", { dm: true }), thoughtLog: fakeChannel("900") }],
    [
      "the notice came from a private channel",
      { conversation: fakeChannel("200"), thoughtLog: fakeChannel("900"), privateChannelIds: ["200"] },
    ],
    [
      "the notice came from a channel @everyone cannot read",
      { conversation: fakeChannel("200", { restricted: true }), thoughtLog: fakeChannel("900") },
    ],
    [
      "the notice came from a thread under a private channel",
      {
        conversation: fakeChannel("201", { parentId: "200" }),
        thoughtLog: fakeChannel("900"),
        privateChannelIds: ["200"],
      },
    ],
  ])("drops a hidden notice when %s", async (_case, setup) => {
    await sendToolNoticeContainer(buildContext({ hidden: ["user_info_update"], ...setup }), "user_info_update", {
      titleKey: "tools.user_info_update.success_title",
      titleVars: { target_user: "Bau" },
      description: "Updated",
    });

    expect(setup.conversation.sent).toHaveLength(0);
    expect(setup.thoughtLog?.sent ?? []).toHaveLength(0);
  });
});
