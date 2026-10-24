import type { NaturalNudgeInterest, PersonaAuthoredIdleNudge } from "@/modules/natural-nudges/db/types";

export interface PresetNaturalNudgeDefaults {
  talkativeness: number;
  interests: NaturalNudgeInterest[];
  idleNudges: PersonaAuthoredIdleNudge[];
}

/**
 * Keyed by lineage so every language row shares one set; Active Nudge Decision accuracy was measured
 * against this interest wording.
 */
export const PRESET_NATURAL_NUDGE_DEFAULTS: Readonly<Record<number, PresetNaturalNudgeDefaults>> = {
  4: {
    talkativeness: 2,
    idleNudges: [],
    interests: [
      { label: "plushies", description: "Plush toys, cute character plushies such as Chiikawa, and hamsters." },
      { label: "cosplay", description: "Making or wearing costumes, wigs, fabric crafting, and cosplay conventions." },
      {
        label: "character design",
        description: "Critiquing or discussing how characters look: outfits, silhouettes, color, visual identity.",
      },
      { label: "anime", description: "Anime series, seasons, and recommendations in general." },
    ],
  },
  716: {
    talkativeness: 2,
    idleNudges: [],
    interests: [
      {
        label: "competitive gaming",
        description: "Playing ranked or competitive games such as League, Valorant, and fighting games.",
      },
      { label: "League of Legends", description: "League of Legends champions, builds, matches, and ranked play." },
    ],
  },
  1770: {
    talkativeness: 2,
    idleNudges: [],
    interests: [
      {
        label: "music",
        description: "Music discussions and recommendations, especially noise rock, shoegaze, and city pop.",
      },
      { label: "cats", description: "Cats: pets, photos, and cat behavior." },
      { label: "documentaries", description: "Documentaries and deep dives into real-world subjects." },
    ],
  },
  3585: {
    talkativeness: 1,
    idleNudges: [],
    interests: [
      {
        label: "anime",
        description: "Anime series and recommendations, especially mecha such as Gundam, Code Geass, and Evangelion.",
      },
      {
        label: "mobile suit engineering",
        description: "How mechs would work: frames, weapons, armor, and pilot systems.",
      },
    ],
  },
  50: {
    talkativeness: 1,
    idleNudges: [],
    interests: [
      { label: "horror", description: "Horror stories, films, and gothic fiction, including Poe." },
      {
        label: "books",
        description: "Books and reading, especially mysteries, detective fiction, and dark literary stories.",
      },
      { label: "audiobooks", description: "Listening to audiobooks, braille editions, and narration." },
      { label: "tea", description: "Tea varieties, brewing, and sharing a quiet cup of tea." },
    ],
  },
  1337: {
    talkativeness: 3,
    idleNudges: [],
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
    idleNudges: [],
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
