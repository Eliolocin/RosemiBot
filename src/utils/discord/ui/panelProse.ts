import { ComponentType, type ComponentInContainerData } from "discord.js";
import { getDiscordTextLength } from "@/utils/text/discordTextLimits";

const PANEL_PROSE_LAYOUT_POLICY = {
  default: {
    body: 65,
    besideThumbnail: 40,
  },
  japanese: {
    body: 30,
    besideThumbnail: 20,
  },
} as const;

const JAPANESE_SCRIPT_PATTERN = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });

interface InlineToken {
  raw: string;
  width: number;
  whitespace: boolean;
}

interface LinePrefix {
  content: string;
  first: string;
  continuation: string;
}

interface ProtectedSpan {
  raw: string;
  visible: string;
  visibleIsMarkdown: boolean;
}

function readMarkdownLink(value: string, start: number): ProtectedSpan | null {
  if (value[start] !== "[") return null;

  let labelDepth = 1;
  let cursor = start + 1;
  while (cursor < value.length && labelDepth > 0) {
    if (value[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (value[cursor] === "\n" || value[cursor] === "\r") return null;
    if (value[cursor] === "[") labelDepth++;
    if (value[cursor] === "]") labelDepth--;
    cursor++;
  }

  const labelEnd = cursor - 1;
  if (labelDepth !== 0 || value[cursor] !== "(") return null;

  let destinationDepth = 1;
  cursor++;
  while (cursor < value.length && destinationDepth > 0) {
    if (value[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (value[cursor] === "\n" || value[cursor] === "\r") return null;
    if (value[cursor] === "(") destinationDepth++;
    if (value[cursor] === ")") destinationDepth--;
    cursor++;
  }

  if (destinationDepth !== 0) return null;
  return {
    raw: value.slice(start, cursor),
    visible: value.slice(start + 1, labelEnd),
    visibleIsMarkdown: true,
  };
}

function graphemeWidth(value: string): number {
  return [...graphemeSegmenter.segment(value)].length;
}

function firstGrapheme(value: string): string | undefined {
  return graphemeSegmenter.segment(value)[Symbol.iterator]().next().value?.segment;
}

function findClosingDelimiter(value: string, start: number, delimiter: string): number {
  let cursor = start + delimiter.length;
  while (cursor < value.length) {
    const next = value.indexOf(delimiter, cursor);
    if (next < 0) return -1;

    let precedingBackslashes = 0;
    for (let index = next - 1; index >= 0 && value[index] === "\\"; index--) precedingBackslashes++;
    if (precedingBackslashes % 2 === 0) return next;
    cursor = next + delimiter.length;
  }
  return -1;
}

function readProtectedSpan(value: string, start: number): ProtectedSpan | null {
  const remaining = value.slice(start);
  const customEmoji = remaining.match(/^<a?:[A-Za-z0-9_]+:\d+>/)?.[0];
  if (customEmoji) return { raw: customEmoji, visible: "●", visibleIsMarkdown: false };

  const mention = remaining.match(/^<(?:@!?|@&|#)\d+>/)?.[0];
  if (mention) return { raw: mention, visible: "●", visibleIsMarkdown: false };

  const commandMention = remaining.match(/^<\/([^:>\n]+):\d+>/);
  if (commandMention) return { raw: commandMention[0], visible: `/${commandMention[1]}`, visibleIsMarkdown: false };

  const autolink = remaining.match(/^<(https?:\/\/[^<>\n]+)>/i);
  if (autolink) return { raw: autolink[0], visible: autolink[1], visibleIsMarkdown: false };

  const link = readMarkdownLink(value, start);
  if (link) return link;

  const url = remaining.match(/^https?:\/\/[^\s<>]+/i)?.[0];
  if (url) return { raw: url, visible: url, visibleIsMarkdown: false };

  if (value[start] === "\\" && start + 1 < value.length) {
    const escaped = firstGrapheme(value.slice(start + 1));
    if (escaped) return { raw: `\\${escaped}`, visible: escaped, visibleIsMarkdown: false };
  }

  if (value[start] === "`") {
    const opener = value.slice(start).match(/^`+/)?.[0];
    if (opener) {
      const close = value.indexOf(opener, start + opener.length);
      if (close >= 0) {
        return {
          raw: value.slice(start, close + opener.length),
          visible: value.slice(start + opener.length, close),
          visibleIsMarkdown: false,
        };
      }
    }
  }

  for (const delimiter of ["**", "__", "~~", "||", "*", "_"] as const) {
    if (!value.startsWith(delimiter, start)) continue;
    const close = findClosingDelimiter(value, start, delimiter);
    if (close > start + delimiter.length) {
      return {
        raw: value.slice(start, close + delimiter.length),
        visible: value.slice(start + delimiter.length, close),
        visibleIsMarkdown: true,
      };
    }
  }

  return null;
}

function appendPlainTokens(tokens: InlineToken[], value: string): void {
  for (const part of wordSegmenter.segment(value)) {
    if (/^[\t ]+$/u.test(part.segment)) {
      tokens.push({ raw: part.segment, width: graphemeWidth(part.segment), whitespace: true });
      continue;
    }

    const width = graphemeWidth(part.segment);
    const closesPrevious = /^[,.;:!?%)\]}、。，！？：；…]+$/u.test(part.segment);
    const previous = tokens.at(-1);
    if (closesPrevious && previous && !previous.whitespace) {
      previous.raw += part.segment;
      previous.width += width;
    } else {
      tokens.push({ raw: part.segment, width, whitespace: false });
    }
  }
}

function tokenizeInlineMarkdown(value: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let plainStart = 0;
  let cursor = 0;

  while (cursor < value.length) {
    const protectedSpan = readProtectedSpan(value, cursor);
    if (!protectedSpan) {
      const codePoint = value.codePointAt(cursor);
      cursor += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
      continue;
    }

    if (plainStart < cursor) appendPlainTokens(tokens, value.slice(plainStart, cursor));
    tokens.push({
      raw: protectedSpan.raw,
      width: protectedSpan.visibleIsMarkdown
        ? measurePanelProseWidth(protectedSpan.visible)
        : graphemeWidth(protectedSpan.visible),
      whitespace: false,
    });
    cursor += protectedSpan.raw.length;
    plainStart = cursor;
  }

  if (plainStart < value.length) appendPlainTokens(tokens, value.slice(plainStart));
  return tokens;
}

function parseLinePrefix(line: string): LinePrefix {
  const indentation = line.match(/^\s*/u)?.[0] ?? "";
  let cursor = indentation.length;
  let recurring = indentation;

  while (line.startsWith("> ", cursor)) {
    recurring += "> ";
    cursor += 2;
  }

  if (line.startsWith("-# ", cursor)) {
    const marker = "-# ";
    return {
      content: line.slice(cursor + marker.length),
      first: `${recurring}${marker}`,
      continuation: `${recurring}${marker}`,
    };
  }

  const heading = line.slice(cursor).match(/^#{1,3}\s+/u)?.[0];
  if (heading) {
    return {
      content: line.slice(cursor + heading.length),
      first: `${recurring}${heading}`,
      continuation: `${recurring}${heading}`,
    };
  }

  const bullet = line.slice(cursor).match(/^(?:[-+*•]|\d+[.)])\s+/u)?.[0];
  if (bullet) {
    return {
      content: line.slice(cursor + bullet.length),
      first: `${recurring}${bullet}`,
      continuation: `${recurring}${" ".repeat(graphemeWidth(bullet))}`,
    };
  }

  return {
    content: line.slice(cursor),
    first: recurring,
    continuation: recurring,
  };
}

function isIndentedCodeLine(line: string): boolean {
  return /^(?: {0,3}>[ \t]?)*(?: {4}|\t)/u.test(line);
}

function wrapLine(line: string, width: number, newline: string): string {
  if (line.length === 0) return line;

  const trailingWhitespace = line.match(/[ \t]+$/u)?.[0] ?? "";
  const content = trailingWhitespace.length > 0 ? line.slice(0, -trailingWhitespace.length) : line;
  if (content.length === 0) return line;

  const prefix = parseLinePrefix(content);
  const tokens = tokenizeInlineMarkdown(prefix.content);
  if (tokens.length === 0) return line;

  const lines: string[] = [];
  let currentPrefix = prefix.first;
  let current = "";
  let currentWidth = measurePanelProseWidth(currentPrefix);

  for (const token of tokens) {
    if (token.whitespace && current.length === 0) continue;

    if (!token.whitespace && current.length > 0 && currentWidth + token.width > width) {
      lines.push(`${currentPrefix}${current.trimEnd()}`);
      currentPrefix = prefix.continuation;
      current = "";
      currentWidth = measurePanelProseWidth(currentPrefix);
    }

    if (token.whitespace && currentWidth + token.width > width) continue;
    current += token.raw;
    currentWidth += token.width;
  }

  lines.push(`${currentPrefix}${current.trimEnd()}${trailingWhitespace}`);
  return lines.join(newline);
}

/** Measures the grapheme width Discord renders after removing inline Markdown syntax. */
export function measurePanelProseWidth(markdown: string): number {
  return tokenizeInlineMarkdown(markdown).reduce((total, token) => total + token.width, 0);
}

/**
 * Width for one line. Kana renders at roughly twice the advance of a Latin glyph, so a line
 * carrying it wraps against the Japanese profile. Choosing per line rather than per TextDisplay
 * keeps a stored Japanese name from narrowing the English prose that shares its component.
 */
function layoutWidthForLine(line: string, besideThumbnail: boolean): number {
  const profile = JAPANESE_SCRIPT_PATTERN.test(line)
    ? PANEL_PROSE_LAYOUT_POLICY.japanese
    : PANEL_PROSE_LAYOUT_POLICY.default;
  return besideThumbnail ? profile.besideThumbnail : profile.body;
}

/**
 * Wraps panel prose while preserving fenced blocks and explicit line structure.
 *
 * Each line picks its own layout profile, so mixed-script content keeps the Latin width on its
 * English lines. Fenced and indented code lines bypass wrapping, so Kana inside stored code never
 * selects a width.
 *
 * A token wider than the selected layout remains intact on its own line because splitting it
 * could corrupt a URL, inline-code span, custom emoji, or grapheme cluster.
 */
export function formatPanelProse(markdown: string, besideThumbnail = false): string {
  const parts = markdown.split(/(\r?\n)/u);
  const fallbackNewline = markdown.includes("\r\n") ? "\r\n" : "\n";
  const output: string[] = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;

  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index] ?? "";
    const separator = parts[index + 1] ?? "";
    const fenceRun = line.match(/^\s*(`{3,}|~{3,})/u)?.[1];

    if (fence) {
      output.push(line, separator);
      const closingPattern = new RegExp(`^\\s*${fence.marker}{${fence.length},}\\s*$`, "u");
      if (closingPattern.test(line)) fence = null;
      continue;
    }

    if (isIndentedCodeLine(line)) {
      output.push(line, separator);
      continue;
    }

    if (fenceRun) {
      fence = { marker: fenceRun[0] as "`" | "~", length: fenceRun.length };
      output.push(line, separator);
      continue;
    }

    output.push(wrapLine(line, layoutWidthForLine(line, besideThumbnail), separator || fallbackNewline), separator);
  }

  return output.join("");
}

function formatComponentNode(value: unknown, besideThumbnail: boolean): unknown {
  if (Array.isArray(value)) return value.map((child) => formatComponentNode(child, besideThumbnail));
  if (typeof value !== "object" || value === null) return value;

  const record = value as Record<string, unknown>;
  const accessory = record.accessory as Record<string, unknown> | undefined;
  const nestedBesideThumbnail =
    besideThumbnail || (record.type === ComponentType.Section && accessory?.type === ComponentType.Thumbnail);
  const clone = Object.fromEntries(
    Object.entries(record).map(([key, child]) => [key, formatComponentNode(child, nestedBesideThumbnail)]),
  );

  if (record.type === ComponentType.TextDisplay && typeof record.content === "string") {
    clone.content = formatPanelProse(record.content, besideThumbnail);
  }
  return clone;
}

/** Returns a formatted clone whose layout profile follows each TextDisplay's component context. */
export function formatPanelComponentTree<T extends readonly ComponentInContainerData[]>(components: T): T {
  return formatComponentNode(components, false) as T;
}

function measureTextDisplays(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((total, child) => total + measureTextDisplays(child), 0);
  if (typeof value !== "object" || value === null) return 0;

  const record = value as Record<string, unknown>;
  const ownLength =
    record.type === ComponentType.TextDisplay && typeof record.content === "string"
      ? getDiscordTextLength(record.content)
      : 0;
  return ownLength + Object.values(record).reduce<number>((total, child) => total + measureTextDisplays(child), 0);
}

/** Measures a component tree after applying the wrapping that the shared panel boundary will add. */
export function measureFormattedPanelTextLength(components: unknown): number {
  return measureTextDisplays(formatComponentNode(components, false));
}
