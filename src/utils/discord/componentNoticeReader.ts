/**
 * Components V2 notice reader.
 *
 * Several system notices that used to be sent as Discord embeds are now sent as
 * Components V2 containers (see `expandableEmbedNotice.ts`: memory-learning and
 * scheduled-task confirmations). A CV2 message carries an EMPTY `message.embeds`
 * array and an empty `message.content`: all of its text lives inside
 * `message.components` as `TextDisplay` blocks nested in a `Container`.
 *
 * Every context consumer in the chat/compaction pipelines was written against
 * `message.embeds`, so those notices became completely invisible to the LLM:
 * causing Tomori to re-run tools she had already run. This module restores the
 * old behavior by reconstructing the embed-equivalent {title, description,
 * footer} triple from a CV2 container, so the shared title protocol lookup
 * can classify notices even though they cannot carry embed footer markers.
 *
 * The traversal is duck-typed (via `toJSON()` when present) rather than
 * instanceof-based, mirroring `collectMediaCandidatesFromComponent` in
 * `contextMedia.ts`, so it works for both discord.js component class instances
 * and raw API payloads (e.g. forwarded message snapshots).
 */

import { ComponentType } from "discord.js";

/**
 * The embed-equivalent shape reconstructed from a Components V2 notice
 * container. Mirrors the fields the title classifiers and context formatters
 * read off a real `Embed`.
 */
export interface ComponentNoticeText {
  /** Heading line with its Markdown prefix stripped, or null when the container has no heading. */
  title: string | null;
  /** Body text (all non-heading, non-subtext lines joined), or null when empty. */
  description: string | null;
  /** Discord subtext (`-# `) lines with their prefix stripped, or null when absent. */
  footer: string | null;
}

/**
 * Matches a Markdown heading line (`# `, `## `, or `### `). `buildNoticeContainer`
 * currently renders titles via `formatContainerTitle` as H3, but H1/H2 are accepted
 * so a change of heading level in the UI layer cannot silently break classification.
 */
const HEADING_LINE_PATTERN = /^#{1,3}\s+(.+)$/;

/** Matches a Discord "subtext" line (`-# `), which CV2 notices use for the footer. */
const SUBTEXT_LINE_PATTERN = /^-#\s+(.+)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Normalizes a component into a plain record. discord.js component instances
 * expose their raw API data through `toJSON()`; raw API payloads are already
 * records and pass through untouched.
 *
 * @param component - A component instance or raw API component payload.
 * @returns The component as a plain record, or null when it is not an object.
 */
function toComponentRecord(component: unknown): Record<string, unknown> | null {
  if (!isRecord(component)) return null;

  const toJson = component.toJSON;
  if (typeof toJson === "function") {
    const json = toJson.call(component);
    if (isRecord(json)) return json;
  }

  return component;
}

/**
 * Recursively collects the `content` of every `TextDisplay` component, in render
 * order. Descends through `Container` and `Section` children so a notice keeps
 * its text even if the UI layer later nests it more deeply.
 *
 * @param blocks - Accumulator that receives each TextDisplay's content, in order.
 */
function collectTextDisplayBlocks(component: unknown, blocks: string[]): void {
  const data = toComponentRecord(component);
  if (!data) return;

  // Leaf case: a TextDisplay carries the actual notice text.
  if (data.type === ComponentType.TextDisplay && typeof data.content === "string" && data.content.length > 0) {
    blocks.push(data.content);
  }

  // Recurse into any nested children (Container -> components,
  //    Section -> components). Buttons/separators have no text and are skipped
  //    naturally because they carry no TextDisplay descendants.
  if (Array.isArray(data.components)) {
    for (const child of data.components) {
      collectTextDisplayBlocks(child, blocks);
    }
  }
}

export function extractTextDisplayContent(components: readonly unknown[] | undefined): string {
  if (!components) return "";
  const blocks: string[] = [];
  for (const component of components) collectTextDisplayBlocks(component, blocks);
  return blocks.join("\n").trim();
}

/**
 * Reconstructs the embed-equivalent {title, description, footer} triple from a
 * message's Components V2 tree.
 *
 * Parsing rules, matched to what `buildNoticeContainer` emits:
 *   - The FIRST line of the FIRST TextDisplay block is the title, but only when
 *     it is a Markdown heading. Restricting the title to line 0 means a heading
 *     that happens to appear inside user-authored memory content can never be
 *     mistaken for the notice title.
 *   - Lines prefixed with `-# ` (Discord subtext) form the footer.
 *   - Every remaining line forms the description.
 *
 * @returns The reconstructed notice text, or null when the tree holds no text at all.
 */
export function extractNoticeTextFromComponents(
  components: readonly unknown[] | undefined,
): ComponentNoticeText | null {
  if (!components || components.length === 0) return null;

  // Flatten every TextDisplay in the tree into ordered text blocks.
  const blocks: string[] = [];
  for (const component of components) {
    collectTextDisplayBlocks(component, blocks);
  }
  if (blocks.length === 0) return null;

  // Split into lines, preserving order across blocks.
  const lines = blocks.join("\n").split("\n");

  // Pull the title off line 0 only, and only if it is a heading.
  let title: string | null = null;
  const headingMatch = lines[0]?.match(HEADING_LINE_PATTERN);
  if (headingMatch) {
    title = headingMatch[1].trim();
    lines.shift();
  }

  // Partition the remainder into footer (subtext) and description lines.
  const descriptionLines: string[] = [];
  const footerLines: string[] = [];
  for (const line of lines) {
    const subtextMatch = line.match(SUBTEXT_LINE_PATTERN);
    if (subtextMatch) {
      footerLines.push(subtextMatch[1].trim());
      continue;
    }
    descriptionLines.push(line);
  }

  const description = descriptionLines.join("\n").trim();
  const footer = footerLines.join("\n").trim();

  return {
    title,
    description: description.length > 0 ? description : null,
    footer: footer.length > 0 ? footer : null,
  };
}
