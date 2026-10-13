import { createHash } from "node:crypto";
import type { ServerEmojiRow, ServerStickerRow } from "@/types/db/schema";

export function nativeExpressionRevision(row: ServerEmojiRow | ServerStickerRow): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "emoji_disc_id" in row ? row.emoji_disc_id : row.sticker_disc_id,
        "emoji_name" in row ? row.emoji_name : row.sticker_name,
        "emoji_desc" in row ? row.emoji_desc : row.sticker_desc,
        row.emotion_key,
        row.updated_at,
      ]),
    )
    .digest("base64url")
    .slice(0, 8);
}
