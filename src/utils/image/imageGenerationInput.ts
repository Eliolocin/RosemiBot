import { AttachmentBuilder } from "discord.js";
import { localizer } from "@/utils/text/localizer";

export const IMAGE_GENERATION_INPUT_FILENAME = "image_generation_input.txt";

type ImageGenerationInput =
  | { kind: "standard"; prompt: string; aspectRatio: string; referenceFilenames: string[] }
  | { kind: "novelai"; prompt: string; negativeTags: string; orientation: string; referenceFilenames: string[] };

/** Save modal inputs so a failed generation does not force the user to retype them. */
export function buildImageGenerationInputAttachment(locale: string, input: ImageGenerationInput): AttachmentBuilder {
  const isNovelAi = input.kind === "novelai";
  const lines = [
    localizer(
      locale,
      isNovelAi ? "commands.novelai.generate.image.modal_title" : "commands.generate.image.modal.title",
    ),
    "",
    `${localizer(locale, isNovelAi ? "commands.novelai.generate.image.prompt_label" : "commands.generate.image.modal.prompt_label")}:`,
    input.prompt,
    "",
  ];

  if (isNovelAi) {
    lines.push(
      `${localizer(locale, "commands.novelai.generate.image.negative_tags_label")}:`,
      input.negativeTags,
      "",
      `${localizer(locale, "commands.novelai.generate.image.orientation_label")}: ${input.orientation}`,
    );
  } else {
    lines.push(`${localizer(locale, "commands.generate.image.modal.aspect_ratio_label")}: ${input.aspectRatio}`);
  }

  if (input.referenceFilenames.length > 0) {
    lines.push(
      "",
      `${localizer(locale, isNovelAi ? "commands.novelai.generate.image.character_reference_label" : "commands.generate.image.modal.image_upload_label")}:`,
      ...input.referenceFilenames,
      localizer(locale, "commands.generate.image.recovery_reupload_references"),
    );
  }

  return new AttachmentBuilder(Buffer.from(lines.join("\n"), "utf8"), { name: IMAGE_GENERATION_INPUT_FILENAME });
}
