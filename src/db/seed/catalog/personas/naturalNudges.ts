import type { NaturalNudgeInterest } from "@/modules/natural-nudges/db/types";

export interface PresetNaturalNudgeDefaults {
  talkativeness: number;
  interests: NaturalNudgeInterest[];
}

/**
 * Keyed by lineage so every language row shares one set; Active Nudge Decision accuracy was measured
 * against this interest wording.
 */
export const PRESET_NATURAL_NUDGE_DEFAULTS: Readonly<Record<number, PresetNaturalNudgeDefaults>> = {
  4: {
    talkativeness: 3,
    interests: [
      { label: "cute things", description: "Cute characters and merch such as Chiikawa, plushies, and hamsters." },
      { label: "cosplay", description: "Making or wearing costumes, wigs, fabric crafting, and cosplay conventions." },
      {
        label: "character design",
        description: "Critiquing or discussing how characters look: outfits, silhouettes, color, visual identity.",
      },
      { label: "anime", description: "Anime series, seasons, and recommendations in general." },
    ],
  },
  716: {
    talkativeness: 3,
    interests: [
      {
        label: "competitive gaming",
        description: "Playing ranked or competitive games such as League, Valorant, and fighting games.",
      },
      { label: "gacha games", description: "Gacha pulls, banners, pity, and rare drops." },
    ],
  },
  1770: {
    talkativeness: 1,
    interests: [
      { label: "noise rock", description: "Noise rock, shoegaze, and similar loud or abrasive music." },
      { label: "city pop", description: "Japanese city pop and nostalgic 80s pop music." },
      { label: "cats", description: "Cats: pets, photos, and cat behavior." },
      { label: "documentaries", description: "Documentaries and deep dives into real-world subjects." },
    ],
  },
  3585: {
    talkativeness: 1,
    interests: [
      {
        label: "mecha anime",
        description: "Fiction about giant piloted robots, such as Gundam, Code Geass, and Evangelion.",
      },
      {
        label: "mobile suit engineering",
        description: "How mechs would work: frames, weapons, armor, and pilot systems.",
      },
    ],
  },
  50: {
    talkativeness: 2,
    interests: [
      { label: "horror fiction", description: "Horror and gothic stories, such as Poe, in books or audiobooks." },
      { label: "mystery stories", description: "Mystery and detective fiction." },
      { label: "audiobooks", description: "Listening to audiobooks, braille editions, and narration." },
    ],
  },
  1337: {
    talkativeness: 3,
    interests: [
      { label: "esports", description: "Professional competitive gaming: teams, tournaments, and strategy." },
      {
        label: "DIY projects",
        description: "Building or overengineering things by hand: tools, gadgets, home projects.",
      },
      { label: "painting and art", description: "Drawing, painting, and making art." },
    ],
  },
  666: {
    talkativeness: 2,
    interests: [
      { label: "cooking", description: "Cooking and recipes: preparing dishes and ingredients." },
      { label: "knife collecting", description: "Collecting knives: blades, makers, and handles." },
      {
        label: "erotic doujinshi",
        description: "Adult doujinshi and hentai, including genres such as NTR.",
      },
      { label: "shibari", description: "Rope bondage, BDSM, and pain play." },
      { label: "harsh noise", description: "Harsh noise and extreme experimental music, such as Merzbow." },
      { label: "philosophy", description: "Philosophy, absurdism, and existential questions." },
    ],
  },
};
