import { describe, expect, it } from "bun:test";
import { embeddingSections } from "@/db/seed/catalog/models";

describe("OpenRouter model catalog defaults", () => {
  it("uses google/gemini-embedding-2 as the OpenRouter default embedding model", () => {
    const rows = embeddingSections.flatMap((section) => section.rows).filter((row) => row.provider === "openrouter");
    const defaults = rows.filter((row) => row.isDefault);

    expect(defaults.map((row) => row.codename)).toEqual(["google/gemini-embedding-2"]);
  });
});
