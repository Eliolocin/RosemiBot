import { ComponentType, type MessageCreateOptions, MessageFlags } from "discord.js";
import { danbooruPostUrl, type PostableImage } from "@/tools/restAPIs/danbooru/posts";
import { localizer } from "@/utils/text/localizer";

export type DanbooruGalleryPayload = Required<Pick<MessageCreateOptions, "components" | "flags" | "allowedMentions">>;

/**
 * Danbooru images as one gallery, with a footer naming the searched tags (NovelAI form) and linking
 * each post. Every image rated above general is spoilered.
 */
export function buildDanbooruGalleryPayload(
  locale: string,
  tags: readonly string[],
  images: readonly PostableImage[],
): DanbooruGalleryPayload {
  const query = tags.map((tag) => `\`${tag.replaceAll("`", "'")}\``).join(", ");
  const links = images.map(({ post }) =>
    localizer(locale, "tools.danbooru.gallery_post_link", { id: String(post.id), url: danbooruPostUrl(post.id) }),
  );
  const footerLines = [localizer(locale, "tools.danbooru.gallery_footer", { query }), links.join(" · ")];

  return {
    components: [
      {
        type: ComponentType.MediaGallery,
        items: images.map(({ post, imageUrl }) => ({ media: { url: imageUrl }, spoiler: post.rating !== "g" })),
      },
      {
        type: ComponentType.TextDisplay,
        content: footerLines.map((line) => `-# ${line}`).join("\n"),
      },
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
