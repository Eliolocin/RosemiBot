import { describe, expect, it } from "bun:test";
import { buildHiddenImageDirective } from "@/utils/provider/hiddenImageTurn";

const BASE = {
  presetLabel: "Character Focus",
  presetInstruction: "Frame the main character.",
  aspectRatio: "3:4",
  naiOrientation: "portrait",
} as const;

describe("buildHiddenImageDirective", () => {
  it("offers the Danbooru lookup only when Danbooru Search is on, for both backends", () => {
    const failures: string[] = [];
    for (const backend of ["current_provider", "novelai"] as const) {
      const imageTool = backend === "current_provider" ? "generate_image" : "generate_image_nai";
      for (const lookupEnabled of [true, false]) {
        const directive = buildHiddenImageDirective({ ...BASE, backend, lookupEnabled });
        if (directive.includes("danbooru_search_tags") !== lookupEnabled) {
          failures.push(`${backend} lookup=${lookupEnabled}: lookup mention mismatch`);
        }
        if (!directive.includes(imageTool)) {
          failures.push(`${backend} lookup=${lookupEnabled}: missing ${imageTool}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
