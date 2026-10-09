import { beforeAll, describe, expect, it } from "bun:test";
import {
  ComponentType,
  type ComponentInContainerData,
  type ContainerComponentData,
  type Embed,
  type TopLevelComponentData,
} from "discord.js";
import { buildNoticeContainer } from "@/utils/discord/ui/statusComponents";
import { ColorCode } from "@/utils/misc/logger";
import { processEmbedsFromMessage } from "@/utils/chat/contextEmbeds";
import { checkTargetEmbedTitle } from "@/utils/discord/embedClassifier";
import { initializeLocalizer, localizer } from "@/utils/text/localizer";
import { buildSuccessHeading, type FieldPlan } from "@/tools/functionCalls/updateUserInfoTool";
import { localizedCopy } from "../../helpers/localeCases";

function makeEmbed(title: string, description: string): Embed {
  return { title, description, fields: [], color: null } as unknown as Embed;
}

function buildContext(embed: Embed): string {
  return processEmbedsFromMessage({
    embeds: [embed],
    content: "",
    imageAttachments: [],
    isTomoriAuthoredMessage: true,
    selfDebugEnabled: false,
    tomoriNickname: "Mirri",
  }).content;
}

function isContainerComponent(
  component: TopLevelComponentData,
): component is ContainerComponentData<ComponentInContainerData> {
  return "components" in component && component.type === ComponentType.Container;
}

describe("update_user_info notice visibility", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  it("classifies the tool's success title the same way a memory-learning title is classified", () => {
    const title = localizer("en-US", "tools.user_info_update.success_title", { target_user: "Bau" });
    expect(checkTargetEmbedTitle(title)).toEqual({ isTarget: true, type: "user_info_update" });

    const memoryTitle = localizer("en-US", "genai.self_teach.personal_memory_learned_title");
    expect(checkTargetEmbedTitle(memoryTitle).isTarget).toBe(true);
  });

  it("classifies the field-specific title in every locale, including its Minimal emoji-free form", () => {
    for (const locale of ["en-US", "ja", "pt-BR", "es-419", "zh-TW", "zh-CN", "vi"]) {
      const title = localizer(locale, "tools.user_info_update.success_title_fields", {
        target_user: "Bau",
        fields: localizer(locale, "tools.user_info_update.subject_timezone_offset"),
      });
      expect(checkTargetEmbedTitle(title)).toEqual({ isTarget: true, type: "user_info_update" });
      expect(checkTargetEmbedTitle(title.replace(/^✅\s*/u, ""))).toEqual({ isTarget: true, type: "user_info_update" });
    }
    expect(
      localizer("en-US", "tools.user_info_update.success_title_fields", {
        target_user: "Bau",
        fields: "nickname and timezone",
      }),
    ).toBe("✅ Updated Bau's nickname and timezone");
  });

  it("classifies the cleared title in every locale, including its Minimal emoji-free form", () => {
    for (const locale of ["en-US", "ja", "pt-BR", "es-419", "zh-TW", "zh-CN", "vi"]) {
      const title = localizer(locale, "tools.user_info_update.success_title_cleared_fields", {
        target_user: "Bau",
        fields: localizer(locale, "tools.user_info_update.subject_pronouns"),
      });
      expect(checkTargetEmbedTitle(title)).toEqual({ isTarget: true, type: "user_info_update" });
      expect(checkTargetEmbedTitle(title.replace(/^🗑️\s*/u, ""))).toEqual({ isTarget: true, type: "user_info_update" });
    }
  });

  it("titles a pure removal as cleared in red, but a removed affix alone as a nickname update", () => {
    const heading = (plans: FieldPlan[]) => {
      const { titleKey, titleVars, color } = buildSuccessHeading("en-US", plans, "Bau");
      return { title: localizer("en-US", titleKey, titleVars), color };
    };

    expect(heading([{ field: "timezone_offset", cleared: true }])).toEqual({
      title: "🗑️ Cleared Bau's timezone",
      color: ColorCode.ERROR,
    });
    expect(
      heading([
        { field: "nickname", cleared: true },
        { field: "prefix", cleared: true },
      ]),
    ).toEqual({ title: "🗑️ Cleared Bau's nickname", color: ColorCode.ERROR });
    expect(heading([{ field: "prefix", cleared: true }])).toEqual({
      title: "✅ Updated Bau's nickname",
      color: ColorCode.SUCCESS,
    });
    expect(
      heading([
        { field: "suffix", cleared: false, value: "-san" },
        { field: "timezone_offset", cleared: false, value: 9 },
      ]),
    ).toEqual({ title: "✅ Updated Bau's nickname and timezone", color: ColorCode.SUCCESS });
    expect(
      heading([
        { field: "pronouns", cleared: true },
        { field: "gender_identity", cleared: true },
        { field: "timezone_offset", cleared: true },
      ]),
    ).toEqual({ title: "✅ Updated Bau's Profile", color: ColorCode.SUCCESS });
  });

  it("renders the notice into the [System: ...] block for a later turn", () => {
    const title = localizer("en-US", "tools.user_info_update.success_title", { target_user: "Bau" });
    const body = 'Updated the following:\n1. Naming prefix: `none` → `Master`\n\nMirri now calls Bau "Master Bau".';

    const content = buildContext(makeEmbed(title, body));

    expect(content).toContain("[System:");
    expect(content).toContain(title);
    expect(content).toContain("Master Bau");
  });

  it("survives the Components V2 round trip the tool actually sends through", () => {
    const targetLabel = "Bau";
    const body = 'Updated the following:\n1. Naming prefix: `none` → `Master`\n\nMirri now calls Bau "Master Bau".';
    const components = buildNoticeContainer({
      locale: "en-US",
      color: ColorCode.SUCCESS,
      titleKey: "tools.user_info_update.success_title",
      titleVars: { target_user: targetLabel },
      description: body,
      footerKey: "tools.user_info_update.success_footer",
      footerVars: { target_user: targetLabel },
    });

    const content = processEmbedsFromMessage({
      embeds: [],
      components,
      content: "",
      imageAttachments: [],
      isTomoriAuthoredMessage: true,
      selfDebugEnabled: false,
      tomoriNickname: "Mirri",
    }).content;

    expect(content).toContain("[System:");
    expect(content).toContain("Updated Bau's Profile");
    expect(content).toContain("Master Bau");
  });

  it("keeps Japanese Components V2 tool notices visible to the chat reader", () => {
    const title = localizer("ja", "tools.user_info_update.success_title", { target_user: "Juno" });
    const components = buildNoticeContainer({
      locale: "ja",
      titleKey: "tools.user_info_update.success_title",
      titleVars: { target_user: "Juno" },
      description: "Updated a profile field.",
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
    expect(result.processedSystemEmbed).toBe(true);
    expect(result.content).toContain(title);
  });

  it("separates the footer from the body with a real divider component", () => {
    const components = buildNoticeContainer({
      locale: "en-US",
      titleKey: "tools.user_info_update.success_title",
      titleVars: { target_user: "Bau" },
      description: "body",
      footerKey: "tools.user_info_update.success_footer",
      footerVars: { target_user: "Bau" },
    });

    const [container] = components;
    if (!container || !isContainerComponent(container)) {
      throw new Error("Expected the notice to be wrapped in a container component");
    }

    const inner = container.components;
    expect(
      inner.some(
        (component) =>
          component.type === ComponentType.Separator && "divider" in component && Boolean(component.divider),
      ),
    ).toBe(true);
  });

  it("does not insert artificial newlines into notice descriptions", () => {
    const memoryNotice = buildNoticeContainer({
      locale: "en-US",
      titleKey: "genai.self_teach.personal_memory_learned_title",
      titleVars: { persona_nickname: "Mirri", user_nickname: "Locke" },
      descriptionKey: "genai.self_teach.personal_memory_learned_description",
      descriptionVars: { user_nickname: "Locke", memory_content: "ラーメンが好き" },
    });

    const [container] = memoryNotice;
    if (!container || !isContainerComponent(container)) {
      throw new Error("Expected the notice to be wrapped in a container component");
    }

    const description = container.components.find(
      (component) =>
        component.type === ComponentType.TextDisplay &&
        "content" in component &&
        component.content.includes("Personal Memory"),
    );
    expect(description).toBeDefined();
    if (!description || !("content" in description)) return;

    const expectedIntro = localizedCopy("en-US", "genai.self_teach.personal_memory_learned_description", {
      user_nickname: "Locke",
      memory_content: "ラーメンが好き",
    }).split("\n```")[0];

    expect(description.content).toContain(expectedIntro);
    expect(description.content).not.toContain("Locke\n");
  });

  it("also recognizes user block and unblock notices", () => {
    const blockTitle = localizer("en-US", "tools.user_block.block_block_title", {
      persona_name: "Mirri",
      user_name: "Bau",
      duration_hours: 2,
    });
    expect(checkTargetEmbedTitle(blockTitle)).toEqual({ isTarget: true, type: "user_moderation" });

    const unblockTitle = localizer("en-US", "tools.user_block.unblock_success_title", {
      persona_name: "Mirri",
      user_name: "Bau",
    });
    expect(checkTargetEmbedTitle(unblockTitle)).toEqual({ isTarget: true, type: "user_moderation" });
  });

  it("leaves an unrecognized Tomori embed title unclassified", () => {
    expect(checkTargetEmbedTitle("Some Unrelated Embed")).toEqual({ isTarget: false, type: null });
  });
});
