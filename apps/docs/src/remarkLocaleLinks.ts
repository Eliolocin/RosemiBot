import { readdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_DOCS_LOCALE_ID, DOCS_LOCALES } from "../../../src/constants/docsLocales";
import { findEntryFile } from "./docsRouting";

/** Declared locally because `apps/docs` does not depend on `@astrojs/markdown-remark`; see `remarkHeadingIds.ts`. */
type RemarkPlugin = () => (tree: unknown, file: { path?: string }) => void;

interface MdastNode {
  type: string;
  url?: string;
  attributes?: { type: string; name?: string; value?: unknown }[];
  children?: MdastNode[];
}

const LOCALE_IDS: readonly string[] = DOCS_LOCALES.map((locale) => locale.id);

/**
 * Locale of a docs source file, read from its path. The last `/docs/<locale>/` segment wins because
 * the project itself lives under `apps/docs/`, which also contains the string `/docs/`.
 */
function localeFromSourcePath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const matches = [...path.replaceAll("\\", "/").matchAll(/\/docs\/([A-Za-z0-9-]+)\//g)];
  const locale = matches.at(-1)?.[1];
  return locale && LOCALE_IDS.includes(locale) ? locale : undefined;
}

/**
 * Prefixes a locale-less docs link with the locale it should open in, or returns it unchanged.
 *
 * Pages deploy only under a locale prefix, so an authored `/self-hosting/` points at nothing. A page
 * that exists in the reader's locale keeps the reader there; an untranslated one goes to the
 * default locale instead of a `noindex` fallback route that repeats English under a foreign URL.
 * Links that already carry a locale, leave the docs tree (assets, external sites), or are not
 * root-absolute are left alone, so a translator's explicit prefix always wins.
 */
export function localizeDocsLink(
  url: string,
  locale: string,
  sections: ReadonlySet<string>,
  pageExists: (locale: string, pageId: string) => boolean,
): string {
  if (!url.startsWith("/") || url.startsWith("//")) return url;

  const suffixStart = url.search(/[#?]/);
  const pathname = suffixStart === -1 ? url : url.slice(0, suffixStart);
  const suffix = suffixStart === -1 ? "" : url.slice(suffixStart);
  const segments = pathname.split("/").filter(Boolean);
  const [section] = segments;
  if (!section || !sections.has(section)) return url;

  const pageId = segments.join("/");
  const target = pageExists(locale, pageId) ? locale : DEFAULT_DOCS_LOCALE_ID;
  return `/${target}${pathname}${suffix}`;
}

/**
 * Rewrites root-absolute docs links to the page's own locale at build time.
 *
 * Authors write `/features/knowledge/memory/` once for every locale (see "Links" in the docs
 * authoring guide), and this plugin is what makes that URL resolve. It covers Markdown links and the
 * `href` prop of MDX components such as `LinkCard`.
 *
 * The output depends on which other pages exist, but Astro's content layer reuses a page's rendered
 * HTML until that page's own content changes. A build that reuses `.astro/data-store.json` therefore
 * keeps old targets after a translation is added or removed. Clean builds are correct; if a deploy
 * ever restores that cache, include the locale page list in the content config digest.
 */
export function remarkLocaleLinks(docsRoot: string): RemarkPlugin {
  const sections: ReadonlySet<string> = new Set(
    readdirSync(join(docsRoot, DEFAULT_DOCS_LOCALE_ID), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );

  // A path names either a page or a directory index, and the URL alone does not say which.
  const pageExists = (locale: string, pageId: string): boolean =>
    findEntryFile(docsRoot, locale, pageId) !== undefined ||
    findEntryFile(docsRoot, locale, `${pageId}/index`) !== undefined;

  return () => (tree, file) => {
    const locale = localeFromSourcePath(file.path);
    if (!locale) return;

    const rewrite = (url: string): string => localizeDocsLink(url, locale, sections, pageExists);

    const visit = (node: MdastNode): void => {
      if ((node.type === "link" || node.type === "definition") && typeof node.url === "string") {
        node.url = rewrite(node.url);
      }
      // Directive nodes also carry `attributes`, as a plain object, so only the MDX JSX array form
      // can hold an `href` prop.
      if (Array.isArray(node.attributes)) {
        for (const attribute of node.attributes) {
          if (attribute.name === "href" && typeof attribute.value === "string") {
            attribute.value = rewrite(attribute.value);
          }
        }
      }
      node.children?.forEach(visit);
    };

    visit(tree as MdastNode);
  };
}
