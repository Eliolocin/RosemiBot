import { describe, expect, it } from "bun:test";
import { serverEmojiSchema, serverStickerSchema } from "@/types/db/schema";

describe("server expression row schemas", () => {
  it("maps NULL emoji classification columns to the sync placeholders", () => {
    const parsed = serverEmojiSchema.parse({
      server_id: 1,
      emoji_disc_id: "123",
      emoji_name: "smug",
      emoji_desc: null,
      emotion_key: null,
    });

    expect(parsed.emoji_desc).toBe("");
    expect(parsed.emotion_key).toBe("unset");
  });

  it("maps NULL sticker classification columns to the sync placeholders", () => {
    const parsed = serverStickerSchema.parse({
      server_id: 1,
      sticker_disc_id: "456",
      sticker_name: "wave",
      sticker_desc: null,
      emotion_key: null,
    });

    expect(parsed.sticker_desc).toBe("");
    expect(parsed.emotion_key).toBe("unset");
  });

  it("keeps classified values unchanged", () => {
    const parsed = serverEmojiSchema.parse({
      server_id: 1,
      emoji_disc_id: "123",
      emoji_name: "smug",
      emoji_desc: "A smirking face",
      emotion_key: "smug",
    });

    expect(parsed.emoji_desc).toBe("A smirking face");
    expect(parsed.emotion_key).toBe("smug");
  });
});
