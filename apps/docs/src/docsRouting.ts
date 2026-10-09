import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_DOCS_LOCALE_ID,
  DOCS_BASE_URL,
  DOCS_LOCALES,
  PUBLISHED_DOCS_LOCALES,
  getDocsLocaleConfig,
  type DocsLocaleId,
} from "../../../src/constants/docsLocales";

/**
 * Route-level behavior for every docs locale: which locale a content entry belongs to, whether its
 * page exists in another locale, what the head tags should advertise, and which review notice the
 * page carries.
 *
 * Split out of `routeData.ts` because everything here is a pure function of the entry id, the
 * published locale table, and the files on disk under `docs/`. That makes the routing and fallback
 * rules testable without booting Astro, while `routeData.ts` keeps only the Starlight middleware
 * wiring.
 */

interface DocsLinkTag {
  tag: "link";
  attrs: Record<string, string>;
}

interface DocsMetaTag {
  tag: "meta";
  attrs: Record<string, string>;
}

/** Astro's head entries, narrowed to the two shapes this module produces. */
export type DocsHeadTag = DocsLinkTag | DocsMetaTag;

const LOCALE_IDS: readonly string[] = DOCS_LOCALES.map((locale) => locale.id);

/** The locale segment at the front of a content entry id, or undefined for an unprefixed id. */
export function localeFromEntryId(entryId: string): string | undefined {
  const [segment] = entryId.split("/");
  return LOCALE_IDS.includes(segment) ? segment : undefined;
}

/** Strips the locale segment, giving the id both locales share (`features/knowledge/memory`). */
export function stripLocaleFromEntryId(entryId: string): string {
  const locale = localeFromEntryId(entryId);
  return locale ? entryId.slice(locale.length).replace(/^\//, "") : entryId;
}

/**
 * Source filenames that produce an entry id, in the order Starlight would pick them.
 *
 * A directory index has four possible sources, while a normal page is always `<id>.md` or
 * `<id>.mdx`, so the two cases cannot share one filename list.
 */
export function entryFileCandidates(baseId: string): string[] {
  if (baseId === "index") return ["README.md", "README.mdx", "index.md", "index.mdx"];
  if (baseId.endsWith("/index")) {
    const directory = baseId.slice(0, -"/index".length);
    return ["README.md", "README.mdx", "index.md", "index.mdx"].map((name) => `${directory}/${name}`);
  }
  return [`${baseId}.md`, `${baseId}.mdx`];
}

/** Resolves a locale-less entry id to its source file under the docs content root. */
export function findEntryFile(docsRoot: string, locale: string, baseId: string): string | undefined {
  for (const candidate of entryFileCandidates(baseId)) {
    const filePath = join(docsRoot, locale, candidate);
    if (existsSync(filePath)) return filePath;
  }
  return undefined;
}

/**
 * Whether the locale has a real source file for this entry.
 *
 * This is the guard that keeps a locale-fallback route from being advertised as a translation: a
 * `/ja/x/` route serving English content is a fallback, and telling Google it is the Japanese
 * version competes the same English text against itself.
 */
function entryExists(docsRoot: string, locale: string, baseId: string): boolean {
  return findEntryFile(docsRoot, locale, baseId) !== undefined;
}

/** Locales with a real source file for this entry, in the published locale order. */
export function localesWithEntry(docsRoot: string, baseId: string): DocsLocaleId[] {
  return PUBLISHED_DOCS_LOCALES.filter((locale) => entryExists(docsRoot, locale, baseId));
}

/** Site-absolute path for an entry id within a locale, matching the directory-format routes. */
export function entryRoute(locale: string, baseId: string): string {
  const slug = baseId.replace(/(^|\/)index$/, "").replace(/\/+$/, "");
  return `/${locale}/${slug ? `${slug}/` : ""}`;
}

/**
 * hreflang alternates for an entry.
 *
 * Returns an empty list for a fallback route, because a fallback is not a translation of anything.
 * A locale with no source file for the entry is skipped, so a partially translated tree advertises
 * only the pairs that are genuinely different documents.
 */
export function buildHreflangAlternates(
  docsRoot: string,
  baseId: string,
  options: { isFallback: boolean; site?: URL | string },
): DocsHeadTag[] {
  if (options.isFallback) return [];

  const available = localesWithEntry(docsRoot, baseId);
  if (available.length < 2) return [];

  const site = options.site ?? DOCS_BASE_URL;
  return [
    ...available.map((locale) => ({
      tag: "link" as const,
      attrs: {
        rel: "alternate",
        hreflang: getDocsLocaleConfig(locale)?.lang ?? locale,
        href: new URL(entryRoute(locale, baseId), site).href,
      },
    })),
    {
      tag: "link" as const,
      attrs: {
        rel: "alternate",
        hreflang: "x-default",
        href: new URL(entryRoute(DEFAULT_DOCS_LOCALE_ID, baseId), site).href,
      },
    },
  ];
}

/** Removes every hreflang alternate from a head array, including the ones Starlight emits. */
export function withoutHreflangAlternates<T extends { tag: string; attrs?: Record<string, unknown> }>(
  head: T[],
): T[] {
  return head.filter((tag) => !(tag.tag === "link" && tag.attrs?.rel === "alternate"));
}

/**
 * Which review notice a page carries.
 *
 * - `none`: the page's substantive content has been human-reviewed.
 * - `translated`: the translated file's flag differs from its reviewed English source.
 * - `drafts`: substantively unreviewed content, in the locale's own wording.
 */
export type TranslationNoticeMode = "none" | "translated" | "drafts";

/**
 * Reads the `aiGenerated` frontmatter flag directly instead of through the content layer, because
 * the source locale's flag is a different collection entry and loading it mid-render would add a
 * second content lookup to every translated page.
 */
export function sourceIsHumanWritten(source: string): boolean {
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  return /^aiGenerated:\s*false\s*$/m.test(frontmatter);
}

export function resolveTranslationNoticeMode(options: {
  docsRoot: string;
  entryId: string;
  locale: string;
  aiGenerated: boolean;
  /** True when the route serves the default locale's page, so it has no translation of its own. */
  isFallback?: boolean;
}): TranslationNoticeMode {
  if (!options.aiGenerated) return "none";

  const baseId = stripLocaleFromEntryId(options.entryId);
  if (options.locale === DEFAULT_DOCS_LOCALE_ID || options.isFallback) return "drafts";

  const sourceFile = findEntryFile(options.docsRoot, DEFAULT_DOCS_LOCALE_ID, baseId);
  if (!sourceFile) return "drafts";

  return sourceIsHumanWritten(readFileSync(sourceFile, "utf8")) ? "translated" : "drafts";
}

/**
 * Derives a plain-text meta description from the first prose paragraph of a Markdown/MDX body.
 *
 * Skips frontmatter-adjacent noise (imports, headings, code fences, asides, images, tables, lists,
 * JSX/HTML blocks) until it finds real prose, then strips inline Markdown syntax and truncates at a
 * word boundary.
 */
export function deriveDescription(body: string, maxLength: number): string | undefined {
  // Strip HTML comments up front because they can span multiple lines, so the
  // line-based filtering below cannot reliably skip their continuations.
  const lines = body.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
  const paragraph: string[] = [];
  let insideFence = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith("```") || line.startsWith("~~~")) {
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) continue;

    if (line === "") {
      if (paragraph.length > 0) break;
      continue;
    }

    const isNonProse =
      line.startsWith("#") || // headings
      line.startsWith("import ") || // MDX imports
      line.startsWith("export ") || // MDX exports
      line.startsWith(":::") || // asides/admonitions
      line.startsWith("!") || // standalone images
      line.startsWith("|") || // tables
      line.startsWith(">") || // blockquotes
      line.startsWith("<") || // JSX/HTML blocks
      /^[-*+]\s/.test(line) || // unordered lists
      /^\d+\.\s/.test(line); // ordered lists
    if (isNonProse) {
      if (paragraph.length > 0) break;
      continue;
    }

    paragraph.push(line);
  }

  if (paragraph.length === 0) return undefined;

  const text = paragraph
    .join(" ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images → alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → link text
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // bold
    .replace(/(\*|_)(.*?)\1/g, "$2") // italic
    .replace(/<[^>]+>/g, "") // stray inline HTML/JSX
    .replace(/\s+/g, " ")
    .trim();

  if (text.length === 0) return undefined;
  if (text.length <= maxLength) return text;

  // Truncate at the last word boundary that fits, then add an ellipsis. Scripts
  // written without spaces have no boundary to find, so the hard cut is theirs.
  const clipped = text.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 0 ? lastSpace : maxLength)}…`;
}
