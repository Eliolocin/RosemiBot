import { beforeAll, describe, expect, it } from "bun:test";
import { formatTargetEmbedForContext, processEmbedsFromMessage } from "@/utils/chat/contextEmbeds";
import { PROTOCOL_KEYS, classifyProtocolTitle, isMinimalTitleKind } from "@/utils/discord/embedProtocol";
import { buildNoticeContainer } from "@/utils/discord/ui/statusComponents";
import { localizedMinimalTitle } from "@/utils/discord/ui/statusTitle";
import { ColorCode } from "@/utils/misc/logger";
import { getSupportedLocales, hasLocaleKey, initializeLocalizer, localizer } from "@/utils/text/localizer";

beforeAll(async () => initializeLocalizer());

const TITLE_VARS = { persona_nickname: "Mirri", user_nickname: "Bau", target_user: "Bau" };

describe("Minimal notice titles", () => {
  it("classify as the same kind as their Verbose title in every locale", () => {
    const minimalEntries = PROTOCOL_KEYS.filter((entry) => isMinimalTitleKind(entry.kind));
    expect(minimalEntries.length).toBeGreaterThan(0);

    for (const locale of getSupportedLocales()) {
      for (const entry of minimalEntries) {
        if (!hasLocaleKey(locale, entry.key)) continue;
        const minimal = localizedMinimalTitle(locale, entry.key, TITLE_VARS);
        expect({ locale, key: entry.key, kind: classifyProtocolTitle(minimal) }).toEqual({
          locale,
          key: entry.key,
          kind: entry.kind,
        });
        expect(classifyProtocolTitle(localizer(locale, entry.key, TITLE_VARS))).toBe(entry.kind);
      }
    }
  });

  it("keeps a persona nickname's own leading emoji", () => {
    const title = localizedMinimalTitle("en-US", "genai.self_teach.server_memory_learned_title", {
      persona_nickname: "🌸Mirri",
    });

    expect(title.startsWith("🌸Mirri")).toBe(true);
    expect(title).not.toContain("🧠");
  });

  it("does not let an emoji-free reward title match, since reward titles differ only by emoji", () => {
    const rewardTitle = localizer("en-US", "commands.reward.feed.embed_title");
    const bare = rewardTitle.replace(/^\p{Extended_Pictographic}️?\s*/u, "");

    expect(bare).not.toBe(rewardTitle);
    expect(classifyProtocolTitle(bare)).toBeNull();
  });

  it("formats a title-only profile update as a [System: title] block, the shape /tool prompt snapshot reuses", () => {
    const title = localizedMinimalTitle("en-US", "tools.user_info_update.success_title", { target_user: "Bau" });

    expect(formatTargetEmbedForContext({ title, description: "" }, "user_info_update", "Mirri")).toBe(
      `[System: ${title}]`,
    );
  });

  it.each([
    ["Verbose", false],
    ["Minimal", true],
  ])("carries a %s task deletion notice into the model's context", (_mode, minimal) => {
    const components = buildNoticeContainer({
      locale: "en-US",
      color: ColorCode.SUCCESS,
      titleKey: "reminders.task_deleted_title",
      titleVars: { persona_nickname: "Mirri" },
      description: "water the plants",
      minimal,
    });

    const result = processEmbedsFromMessage({
      embeds: [],
      components,
      content: "",
      imageAttachments: [],
      isTomoriAuthoredMessage: true,
      selfDebugEnabled: false,
      tomoriNickname: "Mirri",
    });

    const title = localizedMinimalTitle("en-US", "reminders.task_deleted_title", { persona_nickname: "Mirri" });
    expect(result.processedSystemEmbed).toBe(true);
    expect(result.content).toContain(title);
    expect(result.content.includes("water the plants")).toBe(!minimal);
  });

  it("still reaches the model's context as a title-only Components V2 notice", () => {
    const components = buildNoticeContainer({
      locale: "en-US",
      color: ColorCode.SUCCESS,
      titleKey: "genai.self_teach.server_memory_learned_title",
      titleVars: { persona_nickname: "Mirri" },
      description: "likes tea",
      minimal: true,
    });

    const result = processEmbedsFromMessage({
      embeds: [],
      components,
      content: "",
      imageAttachments: [],
      isTomoriAuthoredMessage: true,
      selfDebugEnabled: false,
      tomoriNickname: "Mirri",
    });

    const minimalTitle = localizedMinimalTitle("en-US", "genai.self_teach.server_memory_learned_title", {
      persona_nickname: "Mirri",
    });
    expect(result.processedSystemEmbed).toBe(true);
    expect(result.content).toBe(`[System: ${minimalTitle}]`);
  });
});
