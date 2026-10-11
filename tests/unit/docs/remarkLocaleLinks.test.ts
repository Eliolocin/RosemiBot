import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localizeDocsLink, remarkLocaleLinks } from "../../../apps/docs/src/remarkLocaleLinks";

const SECTIONS: ReadonlySet<string> = new Set(["features", "self-hosting"]);

/** Only `/ja/features/pair` is translated; everything else exists in English alone. */
const jaHasPage = (locale: string, pageId: string): boolean => locale === "ja" && pageId === "features/pair";

const FIXTURE_FILES: Record<string, string> = {
  "en/features/pair.md": "---\ntitle: Pair\n---\n",
  "en/features/only-english.md": "---\ntitle: English Only\n---\n",
  "en/self-hosting/README.md": "---\ntitle: Self-hosting\n---\n",
  "ja/features/pair.md": "---\ntitle: Pair\n---\n",
  "ja/self-hosting/README.md": "---\ntitle: Self-hosting\n---\n",
};

let docsRoot: string;

describe("localizeDocsLink", () => {
  it("keeps the reader in their locale when the page is translated", () => {
    expect(localizeDocsLink("/features/pair/", "ja", SECTIONS, jaHasPage)).toBe("/ja/features/pair/");
  });

  it("sends an untranslated page to the default locale instead of a noindex fallback", () => {
    expect(localizeDocsLink("/features/only-english/", "ja", SECTIONS, jaHasPage)).toBe("/en/features/only-english/");
  });

  it("preserves the fragment and query", () => {
    expect(localizeDocsLink("/features/pair/#setup", "ja", SECTIONS, jaHasPage)).toBe("/ja/features/pair/#setup");
    expect(localizeDocsLink("/features/pair/?a=1#setup", "ja", SECTIONS, jaHasPage)).toBe(
      "/ja/features/pair/?a=1#setup",
    );
  });

  it("leaves links alone that already carry a locale, leave the docs tree, or are not root-absolute", () => {
    for (const url of [
      "/ja/features/pair/",
      "/en/features/pair/",
      "/img/social-banner.png",
      "/llms.txt",
      "//cdn.example.test/features/x/",
      "https://example.test/features/x/",
      "./sibling/",
      "#same-page",
    ]) {
      expect(localizeDocsLink(url, "ja", SECTIONS, jaHasPage)).toBe(url);
    }
  });
});

describe("remarkLocaleLinks", () => {
  beforeAll(async () => {
    docsRoot = await mkdtemp(join(tmpdir(), "tomori-locale-links-"));
    for (const [relativePath, content] of Object.entries(FIXTURE_FILES)) {
      const absolutePath = join(docsRoot, relativePath);
      await mkdir(join(absolutePath, ".."), { recursive: true });
      await writeFile(absolutePath, content);
    }
  });

  afterAll(async () => {
    await rm(docsRoot, { recursive: true, force: true });
  });

  const run = (path: string) => {
    const link = { type: "link", url: "/self-hosting/", children: [] };
    const definition = { type: "definition", url: "/features/only-english/" };
    const jsxHref = { type: "mdxJsxAttribute", name: "href", value: "/features/pair/" };
    const tree = {
      type: "root",
      children: [
        { type: "paragraph", children: [link] },
        definition,
        { type: "mdxJsxFlowElement", attributes: [jsxHref], children: [] },
        // remark-directive nodes carry `attributes` as an object, which must not be iterated.
        { type: "containerDirective", attributes: { class: "note" }, children: [] },
      ],
    };
    remarkLocaleLinks(docsRoot)()(tree, { path });
    return { link, definition, jsxHref };
  };

  it("resolves a directory index and an MDX href against the locale read from the file path", () => {
    const { link, definition, jsxHref } = run("C:\\repo\\apps\\docs\\src\\content\\docs\\ja\\features\\pair.md");

    expect(link.url).toBe("/ja/self-hosting/");
    expect(definition.url).toBe("/en/features/only-english/");
    expect(jsxHref.value).toBe("/ja/features/pair/");
  });

  it("does nothing when the file path names no docs locale", () => {
    const { link } = run("C:\\repo\\somewhere\\else.md");

    expect(link.url).toBe("/self-hosting/");
  });
});
