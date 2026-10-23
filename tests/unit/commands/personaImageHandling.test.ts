import { describe, expect, test } from "bun:test";
import { planImageHandling } from "@/commands/persona/generate";

/**
 * The four image cases `/persona generate` documents are decided here rather than inline in
 * the command, because the command branch is untestable without a Discord interaction and the
 * cases are the part that must not drift.
 */
describe("persona generate image handling", () => {
  test("case 2: no image never reaches this decision, and an unattachable image fails", () => {
    // No vision anywhere and nothing extracted is the only case that stops generation.
    expect(planImageHandling({ primarySeesImages: false, visionSeesImages: false, hasExtractedPreset: false })).toBe(
      "fail_no_vision",
    );
  });

  test("case 1: a non-vision primary with a vision model captions first", () => {
    expect(planImageHandling({ primarySeesImages: false, visionSeesImages: true, hasExtractedPreset: false })).toBe(
      "caption_then_generate",
    );
  });

  test("case 3: a vision-capable primary reads the image itself", () => {
    expect(planImageHandling({ primarySeesImages: true, visionSeesImages: false, hasExtractedPreset: false })).toBe(
      "primary_with_image",
    );

    // The vision row is irrelevant once the primary can see, even when both could read it.
    expect(planImageHandling({ primarySeesImages: true, visionSeesImages: true, hasExtractedPreset: false })).toBe(
      "primary_with_image",
    );
  });

  test("case 4: extracted card data replaces vision entirely", () => {
    expect(planImageHandling({ primarySeesImages: false, visionSeesImages: false, hasExtractedPreset: true })).toBe(
      "text_only_extracted",
    );
  });

  test("extracted card data replaces vision only when nothing can read the image", () => {
    expect(planImageHandling({ primarySeesImages: false, visionSeesImages: true, hasExtractedPreset: true })).toBe(
      "caption_then_generate",
    );
  });

  test("a vision-capable primary keeps the image even when card data was extracted", () => {
    // The primary can read the image, so the card is reference material rather than a
    // replacement for it.
    expect(planImageHandling({ primarySeesImages: true, visionSeesImages: false, hasExtractedPreset: true })).toBe(
      "primary_with_image",
    );
  });

  test("a card only rescues the case where no model can see the image", () => {
    expect(planImageHandling({ primarySeesImages: false, visionSeesImages: false, hasExtractedPreset: true })).toBe(
      "text_only_extracted",
    );
    expect(planImageHandling({ primarySeesImages: false, visionSeesImages: false, hasExtractedPreset: false })).toBe(
      "fail_no_vision",
    );
  });
});
