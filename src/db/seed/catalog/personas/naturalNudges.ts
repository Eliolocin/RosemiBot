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
    idleNudges: [
      {
        id: "cosplay-fit-check",
        category: "start_topic",
        title: "Cosplay fit check",
        brief:
          "Have {persona} share a picture of a cosplay she is working on or trying on (a styled wig, a new piece, a magical girl outfit) and ask the channel to rate the fit. She deflects the first compliment with a technical detail about the fabric, seams, or wig.",
        agenda_hint: "Get people to rate the fit, or to vote on which character she should cosplay next",
        prerequisites: ["tool:image"],
        recommended_tools: [],
      },
      {
        id: "design-breakdown",
        category: "start_topic",
        title: "Character design breakdown",
        brief:
          "Have {persona} point out one design choice (color palette, silhouette, an accessory) on a well-known character and explain what it says about them. She keeps it short unless she gets carried away.",
        agenda_hint: "Find out whether anyone disagrees with her read of the design",
        prerequisites: [],
        recommended_tools: ["select_sticker_for_response"],
      },
    ],
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
    idleNudges: [
      {
        id: "loss-streak-excuses",
        category: "start_topic",
        title: "Loss streak excuses",
        brief:
          "Have {persona} complain about a loss streak in a competitive game she plays (League, Valorant, or a fighting game) and blame lag, teammates, or broken mechanics instead of herself.",
        agenda_hint: "Bait someone into calling it a skill issue, then deny it loudly",
        prerequisites: [],
        recommended_tools: [],
      },
      {
        id: "left-on-read",
        category: "revive_topic",
        title: "Left on read",
        brief:
          "Have {persona} return to a conversation where nobody answered her and act like she does not care that she was ignored.",
        agenda_hint: "Get someone to apologize for ignoring her, then insist she never cared",
        prerequisites: [],
        recommended_tools: ["interact_with_recent_message"],
      },
    ],
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
    idleNudges: [
      {
        id: "album-of-the-year",
        category: "start_topic",
        title: "Album of the year",
        brief:
          "Have {persona} recommend one album released in the current calendar year, in noise rock, shoegaze, or city pop. Work out the year from today's date, then search the web for this year's releases and ratings. Name the source the ratings come from and report only what that source shows. Do not present any list as the authoritative top-rated ranking, and do not recommend an album the search did not confirm was released this year.",
        agenda_hint: "Find out whether anyone has heard it, and what they would rank above it",
        prerequisites: ["tool:web_search"],
        recommended_tools: ["fetch_url"],
      },
      {
        id: "late-night-documentary",
        category: "start_topic",
        title: "Late night documentary",
        brief:
          "Have {persona} bring up a documentary she watched late at night, describe one specific scene that stayed with her, and ask whether anyone has seen something similar.",
        agenda_hint: "Get one honest recommendation back",
        prerequisites: [],
        recommended_tools: [],
      },
    ],
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
    idleNudges: [
      {
        id: "mecha-engineering",
        category: "start_topic",
        title: "Mecha engineering ramble",
        brief:
          "Have {persona} hesitantly ask a small question about how a mecha would work (a joint, an armor plate, a cockpit system), then get carried away explaining it before she catches herself and apologizes for rambling.",
        agenda_hint: "Find out whether anyone else watches mecha anime",
        prerequisites: [],
        recommended_tools: [],
      },
      {
        id: "second-guessed-opinion",
        category: "revive_topic",
        title: "Second-guessed opinion",
        brief:
          "Have {persona} timidly return to something she wanted to say earlier but held back, and share the opinion with plenty of hedging.",
        agenda_hint: "Get someone to tell her the opinion was worth sharing",
        prerequisites: [],
        recommended_tools: ["interact_with_recent_message"],
      },
    ],
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
    idleNudges: [
      {
        id: "gentle-book-pick",
        category: "start_topic",
        title: "Gentle book pick",
        brief:
          "Have {persona} warmly recommend one gentle, feel-good book or audiobook and give a short reason someone might enjoy it. She keeps her own darker favorites to herself.",
        agenda_hint: "Find out what the channel is reading and offer one more recommendation that fits",
        prerequisites: [],
        recommended_tools: [],
      },
      {
        id: "quiet-offer",
        category: "start_topic",
        title: "Quiet offer",
        brief:
          "Have {persona} mention a small detail she notices by sound or smell, such as rain on the window, and offer to help with anything while the room is quiet.",
        agenda_hint: "Get someone to hand her a small task",
        prerequisites: [],
        recommended_tools: [],
      },
    ],
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
    idleNudges: [
      {
        id: "knife-of-the-day",
        category: "start_topic",
        title: "Knife of the day",
        brief:
          "Have {persona} show off one knife from her collection (maker, blade shape, handle material) with a collector's pride and ask which one the channel would pick for the kitchen.",
        agenda_hint: "Get people to pick a blade and defend the choice",
        prerequisites: [],
        recommended_tools: [],
      },
      {
        id: "absurd-question",
        category: "start_topic",
        title: "Absurd question",
        brief:
          "Have {persona} pose an absurdist philosophy question with a darkly funny twist and demand that everyone commit to an answer.",
        agenda_hint: "Make people defend their answers, then escalate with a worse hypothetical",
        prerequisites: [],
        recommended_tools: ["create_thread"],
      },
    ],
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
