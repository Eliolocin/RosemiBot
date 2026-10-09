import type { Guild, Sticker } from "discord.js";
import type { CustomExpressionRow, ServerStickerRow } from "@/types/db/schema";
import type { StickerSelection } from "@/types/discord/stickerSelection";
import { isStickerSendable } from "@/utils/discord/stickerAvailability";

export interface StickerCandidate {
  id: string;
  name: string;
  description: string;
  emotionKey: string | null;
  createdTimestamp: number;
  selection: StickerSelection;
}

export function customExpressionIsEligible(row: CustomExpressionRow, personaId: number): boolean {
  return !row.restricted || row.persona_ids.includes(personaId);
}

export function nativeStickerIsEligible(sticker: Sticker, guild: Guild, canUseExternal: boolean): boolean {
  return isStickerSendable(sticker) && (!sticker.guildId || sticker.guildId === guild.id || canUseExternal);
}

export function projectStickerCandidates(
  guild: Guild,
  personaId: number,
  stickers: ServerStickerRow[],
  customs: CustomExpressionRow[],
  canUseExternal = false,
): StickerCandidate[] {
  const metadataByName = new Map<string, ServerStickerRow>();
  const richness = (row: ServerStickerRow) =>
    Number(!!row.sticker_desc?.trim() || (!!row.emotion_key && row.emotion_key !== "unset"));
  const timestamp = (row: ServerStickerRow) => Math.max(row.updated_at?.getTime() ?? 0, row.created_at?.getTime() ?? 0);
  for (const row of stickers) {
    const key = row.sticker_name.toLowerCase();
    const previous = metadataByName.get(key);
    if (
      !previous ||
      richness(row) > richness(previous) ||
      (richness(row) === richness(previous) && timestamp(row) >= timestamp(previous))
    ) {
      metadataByName.set(key, row);
    }
  }
  const latestByName = new Map<string, Sticker>();
  const native = [...guild.stickers.cache.values()]
    .filter((sticker) => !!sticker.name.trim() && nativeStickerIsEligible(sticker, guild, canUseExternal))
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  for (const sticker of native) latestByName.set(sticker.name.toLowerCase(), sticker);
  const candidates: StickerCandidate[] = native
    .filter((sticker) => latestByName.get(sticker.name.toLowerCase())?.id === sticker.id)
    .map((sticker) => {
      const metadata = metadataByName.get(sticker.name.toLowerCase());
      return {
        id: sticker.id,
        name: sticker.name,
        description: metadata?.sticker_desc || sticker.description || "",
        emotionKey: metadata?.emotion_key && metadata.emotion_key !== "unset" ? metadata.emotion_key : null,
        createdTimestamp: sticker.createdTimestamp,
        selection: { kind: "native", sticker },
      };
    });
  for (const row of customs.filter((expression) => customExpressionIsEligible(expression, personaId))) {
    candidates.push({
      id: row.custom_expression_id,
      name: row.name,
      description: row.description,
      emotionKey: row.emotion_key,
      createdTimestamp: row.created_at.getTime(),
      selection: { kind: "custom", serverId: row.server_id, expressionId: row.custom_expression_id },
    });
  }
  return candidates;
}
