import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { z } from "astro/zod";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Base points to src/content/docs/: a junction/symlink created by astro.config.mts
// at startup that points to the repo-root docs/ directory. Using this local path
// (rather than the external ../../docs URL) keeps filePath values in the form
// "src/content/docs/..." so Starlight's autogenerate prefix-strip works correctly.
const docsDir = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), "./content/docs"));

export const collections = {
  docs: defineCollection({
    loader: glob({
      // `docs/README.md` indexes the tree for repo readers. The id rewrite below would turn it into
      // the empty slug, which is the site root that `redirects["/"]` already owns, so Astro would
      // skip it with a route-conflict warning on every build.
      pattern: ["**/*.{md,mdx}", "!README.md"],
      base: docsDir,
      generateId: ({ entry }) =>
        entry
          .replace(/\\/g, "/") // normalize Windows backslashes → forward slashes
          .replace(/README\.mdx?$/i, "index.md") // README.md/.mdx → index so it becomes the section root
          .replace(/\.mdx?$/, ""), // strip extension for clean slugs
    }),
    // Extend Starlight's frontmatter schema with an AI-disclaimer opt-in.
    // Defaults to false, so a page renders the disclaimer note only when it
    // sets `aiGenerated: true`. Translations mirror their English source. The
    // note itself is injected at render time by the MarkdownContent component
    // override, so the wording lives in exactly one place.
    schema: docsSchema({
      extend: z.object({
        aiGenerated: z.boolean().default(false),
      }),
    }),
  }),
};
