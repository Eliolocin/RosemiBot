import { beforeAll, describe, expect, it } from "bun:test";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { filterDuplicateCustomEmojis, getEmojiPenaltyDirective } from "@/utils/text/emojiPenalty";
import { useEnvSandbox } from "../../helpers/env";

function botMessage(text: string): StructuredContextItem {
  return { role: "model", parts: [{ type: "text", text }], metadataTag: ContextItemTag.DIALOGUE_HISTORY };
}

const SWITCHES = ["EMOJI_PENALTY_ENABLED", "EMOJI_UNIQUE_ENABLED"] as const;

useEnvSandbox(SWITCHES);

// A developer .env that turns either switch off would make every assertion here vacuous.
beforeAll(() => {
  for (const name of SWITCHES) delete process.env[name];
});

describe("getEmojiPenaltyDirective", () => {
  it("allows one custom emoji across the last three bot messages", () => {
    const history = [botMessage("hi :wave:"), botMessage("plain"), botMessage("plain")];

    expect(getEmojiPenaltyDirective(history)).toBeNull();
  });

  it("triggers once the last three bot messages hold two custom emojis", () => {
    const history = [botMessage("hi :wave:"), botMessage("plain"), botMessage("ok <:smile:123>")];

    expect(getEmojiPenaltyDirective(history)).not.toBeNull();
  });

  it("ignores emojis older than the last three bot messages", () => {
    const history = [botMessage(":wave: :smile:"), botMessage("a"), botMessage("b"), botMessage("c")];

    expect(getEmojiPenaltyDirective(history)).toBeNull();
  });
});

describe("filterDuplicateCustomEmojis", () => {
  it("strips an emoji the bot used within its last five messages", () => {
    const history = [botMessage("<:tomori:1>"), botMessage("a"), botMessage("b"), botMessage("c"), botMessage("d")];

    expect(filterDuplicateCustomEmojis("hello :tomori:", history)).not.toContain(":tomori:");
  });

  it("keeps an emoji last used six bot messages ago", () => {
    const history = [
      botMessage("<:tomori:1>"),
      botMessage("a"),
      botMessage("b"),
      botMessage("c"),
      botMessage("d"),
      botMessage("e"),
    ];

    expect(filterDuplicateCustomEmojis("hello :tomori:", history)).toBe("hello :tomori:");
  });
});
