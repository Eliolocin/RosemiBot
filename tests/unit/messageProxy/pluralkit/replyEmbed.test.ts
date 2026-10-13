import { describe, expect, it } from "bun:test";
import type { Embed } from "discord.js";
import { extractPluralKitReplyTarget, isPluralKitReplyEmbed } from "@/utils/messageProxy/services/pluralkit/replyEmbed";
import { processLinkEmbed } from "@/utils/discord/embedClassifier";
import { findReplyContextTargetInMessage } from "@/utils/chat/contextAnnotations";

const CHANNEL_ID = "111111111111111111";
const MESSAGE_ID = "222222222222222222";
const JUMP_LINK = `https://discord.com/channels/333333333333333333/${CHANNEL_ID}/${MESSAGE_ID}`;

function pluralKitReplyEmbed(overrides: Partial<Embed> = {}): Embed {
  return {
    url: null,
    title: null,
    description: `**[Reply to:](${JUMP_LINK})** you finally finished whatever that was keeping you busy`,
    author: { name: "Ellen ↩️", iconURL: "https://cdn.example.invalid/ellen.png" },
    fields: [],
    image: null,
    thumbnail: null,
    footer: null,
    color: 0x7b68ee,
    ...overrides,
  } as unknown as Embed;
}

describe("extractPluralKitReplyTarget", () => {
  it("reads the quoted message coordinates from a PluralKit reply embed", () => {
    expect(extractPluralKitReplyTarget(pluralKitReplyEmbed())).toEqual({
      channelId: CHANNEL_ID,
      messageId: MESSAGE_ID,
    });
  });

  it("matches the attachment-only reply form", () => {
    const embed = pluralKitReplyEmbed({
      description: `*[(click to see attachment)](${JUMP_LINK})*`,
    } as Partial<Embed>);
    expect(isPluralKitReplyEmbed(embed)).toBe(true);
  });

  it("tolerates the bare U+21A9 author suffix without the variation selector", () => {
    const embed = pluralKitReplyEmbed({
      author: { name: "Ellen ↩" },
    } as unknown as Partial<Embed>);
    expect(isPluralKitReplyEmbed(embed)).toBe(true);
  });

  it("ignores a link preview whose author merely ends in the arrow", () => {
    const embed = pluralKitReplyEmbed({
      description: "a blog post about returning home ↩️",
    } as Partial<Embed>);
    expect(extractPluralKitReplyTarget(embed)).toBeNull();
  });

  it("ignores an ordinary link preview", () => {
    const embed = pluralKitReplyEmbed({
      author: { name: "Example News" },
      description: "Some article summary",
    } as unknown as Partial<Embed>);
    expect(extractPluralKitReplyTarget(embed)).toBeNull();
  });
});

describe("PluralKit reply embed in the context pipeline", () => {
  it("is not surfaced as link preview content", () => {
    const result = processLinkEmbed(pluralKitReplyEmbed());
    expect(result.isLinkPreview).toBe(false);
    expect(result.textContent).toBeNull();
  });

  it("still yields a reply target so a refetched proxy keeps its reference", () => {
    expect(findReplyContextTargetInMessage({ embeds: [pluralKitReplyEmbed()] })).toEqual({
      channelId: CHANNEL_ID,
      messageId: MESSAGE_ID,
    });
  });

  it("leaves genuine link previews intact", () => {
    const embed = pluralKitReplyEmbed({
      author: { name: "Example News" },
      title: "Headline",
      description: "Some article summary",
    } as unknown as Partial<Embed>);
    const result = processLinkEmbed(embed);
    expect(result.isLinkPreview).toBe(true);
    expect(result.textContent).toContain("Headline");
  });
});
