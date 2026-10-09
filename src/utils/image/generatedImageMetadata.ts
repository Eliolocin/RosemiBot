import { AttachmentBuilder } from "discord.js";
import sharp from "sharp";
import { embedImagePromptInPNG } from "@/utils/image/pngMetadata";
import { embedXmpInJpeg, embedXmpInWebp } from "@/utils/image/xmpMetadata";
import { localizer } from "@/utils/text/localizer";

// Tool sends lack an interaction limit, so use Discord's default 20 MiB until their context exposes the effective limit.
const DEFAULT_ATTACHMENT_LIMIT_BYTES = 20 * 1024 * 1024;
export const GENERATED_IMAGE_PROMPT_FILENAME = "image_prompt.txt";

export interface PreparedGeneratedImage {
  buffer: Buffer;
  extension: "png" | "jpg" | "webp" | "gif";
  promptAttachment?: AttachmentBuilder;
}

/** One forbidden XML 1.0 character makes the entire XMP packet unreadable to strict parsers. */
function removeXmlIllegalCharacters(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const isLegal =
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff);
    return isLegal ? character : "";
  }).join("");
}

function escapeXml(value: string): string {
  return removeXmlIllegalCharacters(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });
}

function buildPromptXmp(prompt: string, negativePrompt?: string): string {
  return [
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:tomori="https://tomoribot.app/ns/image/1.0/">',
    `<tomori:Prompt>${escapeXml(prompt)}</tomori:Prompt>`,
    ...(negativePrompt ? [`<tomori:NegativePrompt>${escapeXml(negativePrompt)}</tomori:NegativePrompt>`] : []),
    "</rdf:Description></rdf:RDF></x:xmpmeta>",
    '<?xpacket end="w"?>',
  ].join("");
}

function buildPromptAttachment(locale: string, prompt: string, negativePrompt?: string): AttachmentBuilder {
  const lines = [localizer(locale, "commands.generate.image.field_prompt"), prompt];
  if (negativePrompt) {
    lines.push("", localizer(locale, "commands.generate.image.prompt_file_negative_prompt"), negativePrompt);
  }
  return new AttachmentBuilder(Buffer.from(lines.join("\n"), "utf8"), { name: GENERATED_IMAGE_PROMPT_FILENAME });
}

/** Keep provider formats and their full prompts together while respecting the upload limit. */
export async function prepareGeneratedImage(
  image: Buffer,
  prompt: string,
  locale: string,
  negativePrompt?: string,
  attachmentLimitBytes = DEFAULT_ATTACHMENT_LIMIT_BYTES,
): Promise<PreparedGeneratedImage> {
  const metadata = await sharp(image).metadata();
  const originalExtension =
    metadata.format === "jpeg"
      ? "jpg"
      : metadata.format === "png" || metadata.format === "webp" || metadata.format === "gif"
        ? metadata.format
        : null;
  let encoded: Buffer;
  let extension: PreparedGeneratedImage["extension"];

  if (metadata.format === "png") {
    encoded = embedImagePromptInPNG(image, prompt, negativePrompt);
    extension = "png";
  } else if (metadata.format === "jpeg" || metadata.format === "webp") {
    const xmp = buildPromptXmp(prompt, negativePrompt);
    const withXmp =
      metadata.format === "jpeg"
        ? embedXmpInJpeg(image, xmp)
        : embedXmpInWebp(image, xmp, metadata.width ?? 0, metadata.height ?? 0, metadata.hasAlpha ?? false);
    if (!withXmp) {
      return {
        buffer: image,
        extension: metadata.format === "jpeg" ? "jpg" : "webp",
        promptAttachment: buildPromptAttachment(locale, prompt, negativePrompt),
      };
    }
    encoded = withXmp;
    extension = metadata.format === "jpeg" ? "jpg" : "webp";
  } else {
    const png = await sharp(image).png().toBuffer();
    encoded = embedImagePromptInPNG(png, prompt, negativePrompt);
    extension = "png";
  }

  if (encoded.length > attachmentLimitBytes && image.length <= attachmentLimitBytes && originalExtension) {
    return {
      buffer: image,
      extension: originalExtension,
      promptAttachment: buildPromptAttachment(locale, prompt, negativePrompt),
    };
  }

  return { buffer: encoded, extension };
}
