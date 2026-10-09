import { beforeAll, describe, expect, it } from "bun:test";
import { getLocaleStringList, getSupportedLocales, initializeLocalizer } from "@/utils/text/localizer";
import {
  DELIBERATE_TOOL_PACK_KEYS,
  EXPLICIT_MEMORY_PACK_KEY,
  findIntentPackViolations,
  getIntentPackEntryProblem,
} from "@/utils/text/localeIntentPacks";
import {
  applyDeliberateToolAllowlist,
  getAutonomousDeliberateToolNames,
  getDeliberateToolAllowedNames,
  matchesLocaleDeliberateToolPack,
  resolveDeliberateToolContextTurns,
} from "@/utils/tools/deliberateToolMode";

import { createPersona } from "../../helpers/fixtures";

const ALL_PACK_KEYS = [...Object.values(DELIBERATE_TOOL_PACK_KEYS), EXPLICIT_MEMORY_PACK_KEY];

describe("deliberate tool mode", () => {
  it("admits spontaneous stickers while retaining task restrictions", () => {
    const state = createPersona({ config: { sticker_usage_enabled: true } });
    for (const prompt of ["hello", "search the web for cats"]) {
      const allowed = [...getDeliberateToolAllowedNames(prompt), ...getAutonomousDeliberateToolNames(state)];
      const result = applyDeliberateToolAllowlist({
        providerLabel: "test",
        builtInTools: [{ name: "select_sticker_for_response" }, { name: "web_search" }, { name: "generate_image" }],
        mcpFunctionNames: [],
        allowedToolNames: allowed,
      });
      expect(result.builtInTools.map((tool) => tool.name)).toEqual(
        prompt === "hello" ? ["select_sticker_for_response"] : ["select_sticker_for_response", "web_search"],
      );
    }
    for (const disabled of [
      createPersona({ config: { sticker_usage_enabled: false } }),
      createPersona({ config: { sticker_usage_enabled: true, tool_use_enabled: false } }),
      createPersona({ llm: { ...state.llm, has_tools: false }, config: { sticker_usage_enabled: true } }),
      createPersona({ llm: { ...state.llm, llm_provider: "novelai" }, config: { sticker_usage_enabled: true } }),
    ])
      expect(getAutonomousDeliberateToolNames(disabled)).toEqual([]);
  });

  it("ignores obsolete stored sticker triggers", () => {
    expect(getDeliberateToolAllowedNames("hello", { sticker: ["^"] })).not.toContain("select_sticker_for_response");
  });

  it("allows the unified web_search tool for web-search intent", () => {
    const allowedNames = getDeliberateToolAllowedNames("can you search the web for current TypeScript news?");

    expect(allowedNames).toContain("web_search");
  });

  it("keeps web_search visible after applying the deliberate allowlist", () => {
    const result = applyDeliberateToolAllowlist({
      providerLabel: "test",
      builtInTools: [{ name: "web_search" }, { name: "create_task" }],
      mcpFunctionNames: [],
      allowedToolNames: getDeliberateToolAllowedNames("look up today's AI news"),
    });

    expect(result.builtInTools.map((tool) => tool.name)).toEqual(["web_search"]);
  });

  it("allows update_task for reminder edit/delete intent", () => {
    expect(getDeliberateToolAllowedNames("cancel reminder ID:42")).toContain("update_task");
    expect(getDeliberateToolAllowedNames("reschedule that task for tomorrow")).toContain("update_task");
  });

  it("exposes create_task and update_task for reminder custom triggers", () => {
    const allowedNames = getDeliberateToolAllowedNames("scheduler please", { reminder: ["scheduler"] });

    expect(allowedNames).toContain("create_task");
    expect(allowedNames).toContain("update_task");
  });

  it("allows user blocking tools for block and unblock intent", () => {
    expect(getDeliberateToolAllowedNames("mute Alice for one hour")).toContain("block_user");
    expect(getDeliberateToolAllowedNames("remove the user block for Alice")).toContain("unblock_user");
  });

  it("exposes block_user and unblock_user for user-blocking custom triggers", () => {
    const allowedNames = getDeliberateToolAllowedNames("moderation please", {
      "user-blocking": ["moderation"],
    });

    expect(allowedNames).toContain("block_user");
    expect(allowedNames).toContain("unblock_user");
  });

  it("allows structured user info updates for naming, identity, and timezone requests", () => {
    for (const prompt of [
      "call me Mirri",
      "change my pronouns to they/them",
      "set my UTC offset to 8",
      "clear my honorific",
    ]) {
      expect(getDeliberateToolAllowedNames(prompt)).toContain("update_user_info");
    }
  });

  it("exposes user info updates for its custom trigger target", () => {
    expect(getDeliberateToolAllowedNames("profile settings", { "user-info": ["profile settings"] })).toContain(
      "update_user_info",
    );
  });

  it("supports wildcard custom triggers without breaking regex triggers", () => {
    expect(getDeliberateToolAllowedNames("", { image: ["^"] })).toContain("generate_image");
    expect(
      getDeliberateToolAllowedNames("please sketch this", { image: [{ type: "regex", value: "\\bsketch\\b" }] }),
    ).toContain("generate_image");
    expect(getDeliberateToolAllowedNames("hello", { image: [{ type: "literal", value: "pic" }] })).not.toContain(
      "generate_image",
    );
  });

  it("exposes capability review and docs access for self-diagnostic questions", () => {
    const prompts = [
      "What model are you currently using?",
      "Is web search enabled for you?",
      "Why can't you generate images?",
      "Why do you forget conversations?",
      "How does TomoriBot memory work?",
    ];

    for (const prompt of prompts) {
      const allowedNames = getDeliberateToolAllowedNames(prompt);
      expect(allowedNames).toContain("review_capabilities");
      expect(allowedNames).toContain("fetch_url");
      expect(allowedNames).not.toContain("web_search");
    }
  });

  it("matches Japanese and Korean custom literals inside longer words", () => {
    expect(getDeliberateToolAllowedNames("リマインドしてね", { reminder: ["リマインド"] })).toContain("create_task");
    expect(getDeliberateToolAllowedNames("알림을 설정해 줘", { reminder: ["알림"] })).toContain("create_task");
  });

  it("treats a trailing * as a word-start stem and keeps whole-word matching otherwise", () => {
    expect(getDeliberateToolAllowedNames("me lembre amanhã", { reminder: ["lembr*"] })).toContain("create_task");
    expect(getDeliberateToolAllowedNames("vou relembrar", { reminder: ["lembr*"] })).not.toContain("create_task");
    expect(getDeliberateToolAllowedNames("nice pictures", { image: ["pic"] })).not.toContain("generate_image");
  });
});

describe("locale intent packs", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  it("exposes tools from an authored locale's pack regardless of the user's language", () => {
    expect(getDeliberateToolAllowedNames("明日の朝にリマインドして")).toContain("create_task");
    expect(getDeliberateToolAllowedNames("この画像を分析して")).toContain("analyze_image");
    expect(getDeliberateToolAllowedNames("hello there")).not.toContain("create_task");
    expect(matchesLocaleDeliberateToolPack("voice", "音声で知らせて")).toBe(true);
  });

  it("keeps memory tools hidden for Japanese save and forget phrasing that is not a memory request", () => {
    // Japanese pack entries match as substrings, so a bare save or forget verb would expose memory writes
    // for any file, image, or setting a user asks to save.
    for (const request of [
      "画像を保存して",
      "このファイル保存して",
      "設定を保存してください",
      "パスワード忘れてた",
      "記憶力が悪い",
    ]) {
      expect(getDeliberateToolAllowedNames(request)).not.toContain("create_long_term_memory");
      expect(getDeliberateToolAllowedNames(request)).not.toContain("update_long_term_memory");
    }
    expect(getDeliberateToolAllowedNames("これ記憶に保存して")).toContain("create_long_term_memory");
  });

  it("defines every pack as a string list in every authored locale", () => {
    for (const locale of getSupportedLocales()) {
      for (const key of ALL_PACK_KEYS) {
        expect(getLocaleStringList(locale, key)).toBeDefined();
      }
    }
  });

  it("ships no entry that the pack validator rejects", () => {
    expect(findIntentPackViolations(ALL_PACK_KEYS)).toEqual([]);
  });

  it("rejects regex syntax, wildcards, and single-character unspaced entries", () => {
    expect(getIntentPackEntryProblem("^")).toBe("regex_syntax");
    expect(getIntentPackEntryProblem("a*b")).toBe("regex_syntax");
    expect(getIntentPackEntryProblem("remind (me)")).toBe("regex_syntax");
    expect(getIntentPackEntryProblem("画")).toBe("too_short");
    expect(getIntentPackEntryProblem("알")).toBe("too_short");
    expect(getIntentPackEntryProblem("  ")).toBe("empty");
    expect(getIntentPackEntryProblem("lembr*")).toBeNull();
    expect(getIntentPackEntryProblem("画像")).toBeNull();
    expect(getIntentPackEntryProblem("don't forget")).toBeNull();
  });
});

describe("resolveDeliberateToolContextTurns", () => {
  it("keeps tools for four turns when the server has not chosen a value", () => {
    expect(resolveDeliberateToolContextTurns(null)).toBe(4);
    expect(resolveDeliberateToolContextTurns(undefined)).toBe(4);
  });

  it("clamps a server value into 0-10", () => {
    expect(resolveDeliberateToolContextTurns(-2)).toBe(0);
    expect(resolveDeliberateToolContextTurns(25)).toBe(10);
  });
});
