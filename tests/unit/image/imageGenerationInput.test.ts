import { beforeAll, describe, expect, it } from "bun:test";
import {
  buildImageGenerationInputAttachment,
  IMAGE_GENERATION_INPUT_FILENAME,
} from "@/utils/image/imageGenerationInput";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy } from "../../helpers/localeCases";

describe("buildImageGenerationInputAttachment", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  it("saves standard image inputs and identifies references that need another upload", () => {
    const prompt = "A moonlit garden 🌙";
    const file = buildImageGenerationInputAttachment("en-US", {
      kind: "standard",
      prompt,
      aspectRatio: "16:9",
      referenceFilenames: ["reference.png"],
    });
    const content = file.attachment.toString();

    expect(file.name).toBe(IMAGE_GENERATION_INPUT_FILENAME);
    expect(content).toContain(prompt);
    expect(content).toContain("16:9");
    expect(content).toContain("reference.png");
    expect(content).toContain(localizedCopy("en-US", "commands.generate.image.recovery_reupload_references"));
  });

  it("saves NovelAI prompt and negative tags without shortening them", () => {
    const prompt = "星空, ".repeat(300);
    const negativeTags = "blurry, text";
    const file = buildImageGenerationInputAttachment("en-US", {
      kind: "novelai",
      prompt,
      negativeTags,
      orientation: "portrait",
      referenceFilenames: [],
    });
    const content = file.attachment.toString();

    expect(content).toContain(prompt);
    expect(content).toContain(negativeTags);
    expect(content).toContain("portrait");
  });
});
