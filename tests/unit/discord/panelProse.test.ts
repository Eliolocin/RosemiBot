import { describe, expect, it } from "bun:test";
import { ComponentType, MessageFlags, type ComponentInContainerData, type TextDisplayComponentData } from "discord.js";
import { validateComponentsV2MessageLimits } from "@/utils/discord/ui/componentsV2Limits";
import { buildPanelContainer } from "@/utils/discord/ui/panel";
import { formatPanelComponentTree, formatPanelProse, measurePanelProseWidth } from "@/utils/discord/ui/panelProse";

function textDisplay(content: string): TextDisplayComponentData {
  return { type: ComponentType.TextDisplay, content };
}

describe("panel prose formatter", () => {
  it("wraps ordinary prose without truncating it", () => {
    const input =
      "This sentence contains enough natural prose to cross the ordinary panel layout policy without losing words.";
    const output = formatPanelProse(input);

    expect(output).toContain("\n");
    expect(output.replaceAll("\n", " ")).toBe(input);
    for (const line of output.split("\n")) expect(measurePanelProseWidth(line)).toBeLessThanOrEqual(65);
  });

  it("selects the narrow profile from a thumbnail section", () => {
    const input = "A thumbnail section automatically uses narrower prose without a caller supplied width.";
    const components: ComponentInContainerData[] = [
      textDisplay(input),
      {
        type: ComponentType.Section,
        components: [textDisplay(input)],
        accessory: { type: ComponentType.Thumbnail, media: { url: "https://example.com/avatar.png" } },
      },
    ];

    const formatted = formatPanelComponentTree(components);
    const ordinary = formatted[0];
    const section = formatted[1];
    expect(ordinary.type).toBe(ComponentType.TextDisplay);
    expect(section.type).toBe(ComponentType.Section);
    if (!("content" in ordinary) || !("components" in section)) return;

    const narrow = section.components[0];
    if (!("type" in narrow)) return;
    expect(narrow.type).toBe(ComponentType.TextDisplay);
    if (!("content" in narrow)) return;
    expect(ordinary.content.split("\n").length).toBeLessThan(narrow.content.split("\n").length);
    for (const line of narrow.content.split("\n")) expect(measurePanelProseWidth(line)).toBeLessThanOrEqual(40);
  });

  it("does not mutate a reusable component tree", () => {
    const components: ComponentInContainerData[] = [
      textDisplay("This reusable component contains enough words that formatting must clone and alter its content."),
    ];
    const snapshot = structuredClone(components);

    const formatted = formatPanelComponentTree(components);

    expect(components).toEqual(snapshot);
    expect(formatted).not.toBe(components);
    expect(formatted).not.toEqual(components);
  });

  it("preserves links, inline code, emphasis, escapes, URLs, and custom emoji", () => {
    const tokens = [
      "[documentation](https://docs.example.com/a/very/long/path)",
      "[escaped \\] label](https://docs.example.com/a_(nested)_path)",
      "`inline code stays whole`",
      "**bold words**",
      "__underlined words__",
      "~~removed words~~",
      "||spoiler words||",
      "\\*literal asterisk",
      "https://example.com/a/long/path?with=query",
      "</config switch-models:123456789012345678>",
      "<:mirri_wave:123456789012345678>",
    ];
    const input = tokens.join(" and ");
    const output = formatPanelProse(input, true);

    for (const token of tokens) expect(output).toContain(token);
    expect(measurePanelProseWidth(tokens[0])).toBe("documentation".length);
    expect(measurePanelProseWidth(tokens[2])).toBe("inline code stays whole".length);
  });

  it("repeats subtext and quote markers on continuations", () => {
    const subtext = formatPanelProse(
      "-# This warning contains enough words to wrap onto several lines while keeping every continuation subdued.",
      true,
    );
    const quote = formatPanelProse(
      "> This current value contains enough words to wrap onto several lines while remaining a quote row.",
      true,
    );

    expect(subtext.split("\n").every((line) => line.startsWith("-# "))).toBe(true);
    expect(quote.split("\n").every((line) => line.startsWith("> "))).toBe(true);
  });

  it("keeps a wrapped heading visually consistent", () => {
    const output = formatPanelProse(
      "### A deliberately long heading keeps its heading marker when it wraps onto another visual line",
      true,
    );

    expect(output.split("\n").length).toBeGreaterThan(1);
    expect(output.split("\n").every((line) => line.startsWith("### "))).toBe(true);
  });

  it("keeps one list item while indenting continuation lines", () => {
    const output = formatPanelProse(
      "- A list item can contain enough natural prose to need multiple visual lines without becoming several list items.",
      true,
    );
    const lines = output.split("\n");

    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toStartWith("- ");
    expect(lines.slice(1).every((line) => line.startsWith("  ") && !line.startsWith("- "))).toBe(true);
  });

  it("preserves semantic blank lines, hard breaks, and code blocks byte for byte", () => {
    const fence =
      "```markdown\nA stored line that must remain byte-for-byte intact even when it is much wider than the layout policy.\n> raw marker\n```";
    const hardBreak = "Hard break stays.  \nNext line.";
    const indentedCode = `    const preserved = "${"x".repeat(70)}";`;
    const quotedIndentedCode = `>     const quoted = "${"y".repeat(70)}";`;
    const input = `A natural paragraph that wraps because it is deliberately longer than the narrow policy allows.\n\n${hardBreak}\n\n${fence}\n\n${indentedCode}\n${quotedIndentedCode}\n\nFinal paragraph.`;
    const output = formatPanelProse(input, true);

    expect(output).toContain("\n\n");
    expect(output).toContain(hardBreak);
    expect(output).toContain(fence);
    expect(output).toContain(indentedCode);
    expect(output).toContain(quotedIndentedCode);
  });

  it("uses Unicode word and grapheme boundaries", () => {
    const inputs = [
      "日本語の文章を自然な単語境界で折り返して書記素を壊さないことを確認するための十分に長い文章です。",
      "这是一个足够长的中文句子，用来验证运行时换行不会拆分字素簇或破坏标点符号。",
      "Tiếng Việt có dấu được giữ nguyên khi câu văn đủ dài để cần tự động xuống dòng trong bảng điều khiển.",
      "Family emoji 👨‍👩‍👧‍👦 and flags 🇸🇬 remain complete when nearby prose wraps across visual lines.",
    ];

    for (const input of inputs) {
      const output = formatPanelProse(input, true);
      expect(output.replace(/\s/gu, "")).toBe(input.replace(/\s/gu, ""));
      expect(output).not.toContain("\uFFFD");
    }
  });

  it("uses narrower Japanese limits without changing Chinese limits", () => {
    const japanese = formatPanelProse("かな ".repeat(25).trimEnd());
    const chinese = formatPanelProse("中文 ".repeat(25).trimEnd());

    expect(japanese.split("\n").every((line) => measurePanelProseWidth(line) <= 30)).toBe(true);
    expect(chinese.split("\n").some((line) => measurePanelProseWidth(line) > 30)).toBe(true);
    expect(chinese.split("\n").every((line) => measurePanelProseWidth(line) <= 65)).toBe(true);

    const narrowJapanese = formatPanelProse("かな ".repeat(20).trimEnd(), true);
    expect(narrowJapanese.split("\n").every((line) => measurePanelProseWidth(line) <= 20)).toBe(true);
  });

  it("picks the layout profile per line when one TextDisplay mixes scripts", () => {
    const latin = "Manage this persona's identity and how they chat with people";
    const kana = "> なまえ: ともりのペルソナのプロフィールです";
    const lines = formatPanelProse(`${latin}\n${kana}`, true).split("\n");
    const latinLines = lines.filter((line) => !line.startsWith("> "));
    const kanaLines = lines.filter((line) => line.startsWith("> "));

    expect(latinLines.join(" ")).toBe(latin);
    expect(kanaLines.every((line) => measurePanelProseWidth(line) <= 20)).toBe(true);
    // The kana row must not drag this English paragraph down to the Japanese width.
    expect(latinLines.some((line) => measurePanelProseWidth(line) > 20)).toBe(true);
  });

  it("ignores Japanese characters inside code blocks when choosing layout policy", () => {
    const prose = "A **[Personal Memory](https://docs.example.com/memory)** about Locke has been saved:";
    const input = `${prose}\n\`\`\`\nラーメンが好き\n\`\`\``;
    const output = formatPanelProse(input);

    expect(output.split("\n")[0]).toBe(prose);
  });

  it("leaves an oversized unbreakable token intact", () => {
    const token = `https://example.com/${"x".repeat(100)}`;
    expect(formatPanelProse(token, true)).toBe(token);
  });

  it("preserves interpolated values with leading zero-width content", () => {
    const value = `\uFEFF${"stored-name ".repeat(8).trimEnd()}`;
    const output = formatPanelProse(`> ${value}`, true);

    expect(output).toContain("\uFEFF");
    expect(output.replaceAll("\n> ", " ").slice(2)).toBe(value);
  });

  it("is idempotent after wrapping markers and prose", () => {
    const once = formatPanelProse(
      "-# Repainting the same panel must not add another layer of wrapping or duplicate line markers.",
      true,
    );
    expect(formatPanelProse(once, true)).toBe(once);
  });

  it("lets final validation detect wrapping that crosses the aggregate text limit", () => {
    const content = `-# ${"word ".repeat(794).trimEnd()}`;
    expect([...content].length).toBeLessThanOrEqual(4000);

    const container = buildPanelContainer([textDisplay(content)]);
    const validation = validateComponentsV2MessageLimits({
      flags: MessageFlags.IsComponentsV2,
      components: [container],
    });

    expect(validation.valid).toBe(false);
    expect(validation.violations.some((violation) => violation.code === "TEXT_DISPLAY_TOTAL_EXCEEDED")).toBe(true);
  });
});
