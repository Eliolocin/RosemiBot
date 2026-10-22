import { drawRaffle } from "@/modules/natural-nudges/runtime/meters";
import { PLAY_SCENE_SECOND_PARTNER_CHANCE } from "@/modules/natural-nudges/runtime/tuning";

export interface PartnerCandidate<T> {
  persona: T;
  /** Talkativeness tickets times rested share, as in the lead's raffle. */
  tickets: number;
  channelIds: ReadonlySet<string>;
}

export function hasScenePartner<T>(candidates: readonly PartnerCandidate<T>[], channelIds: readonly string[]): boolean {
  return candidates.some((candidate) => candidate.tickets > 0 && channelIds.some((id) => candidate.channelIds.has(id)));
}

/**
 * Draws one Play Scene partner, sometimes two, each by tickets among personas allowed in a channel
 * every speaker so far shares. Null when nobody can join.
 */
export function drawScenePartners<T>(
  candidates: readonly PartnerCandidate<T>[],
  channelIds: readonly string[],
  random: () => number = Math.random,
): { partners: T[]; channelIds: string[] } | null {
  const wanted = random() < PLAY_SCENE_SECOND_PARTNER_CHANCE ? 2 : 1;
  const remaining = [...candidates];
  const partners: T[] = [];
  let shared = [...channelIds];
  while (partners.length < wanted) {
    const pick = drawRaffle(
      remaining.map((candidate) => ({
        item: candidate,
        tickets: shared.some((id) => candidate.channelIds.has(id)) ? candidate.tickets : 0,
      })),
      random,
    );
    if (!pick) break;
    partners.push(pick.persona);
    remaining.splice(remaining.indexOf(pick), 1);
    shared = shared.filter((id) => pick.channelIds.has(id));
  }
  return partners.length > 0 ? { partners, channelIds: shared } : null;
}
