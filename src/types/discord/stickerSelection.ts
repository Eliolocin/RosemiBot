import type { Sticker } from "discord.js";

export type StickerSelection =
  | { kind: "native"; sticker: Sticker }
  | { kind: "custom"; serverId: number; expressionId: string };
