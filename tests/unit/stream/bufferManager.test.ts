import { describe, expect, it } from "bun:test";
import { createDefaultStreamState } from "@/types/stream/types";
import {
  autoCloseIncompleteMarkers,
  drainThinkBlocksFromBuffer,
  hasIncompleteSemanticMarkers,
  processBufferContent,
} from "@/utils/discord/stream/bufferManager";

describe("stream buffer think-block fallback", () => {
  it("routes text before a stray close tag into raw thoughts", () => {
    const state = createDefaultStreamState();
    state.buffer = "originally.</think>Bella: Eep!";

    drainThinkBlocksFromBuffer(state);

    expect(state.thoughtRawSegments).toEqual(["originally."]);
    expect(state.buffer).toBe("Bella: Eep!");
  });

  it("holds a partial close tag so a reasoning tail cannot flush visibly", () => {
    expect(hasIncompleteSemanticMarkers("originally.</thi")).toBe(true);
  });
});

/**
 * Holding the buffer suppresses newline splitting, which is what breaks a multi-message reply into
 * separate sends and lets each `Persona (sprite):` label open its own segment. An orphan ")" used to
 * count as "unbalanced", so a single emoticon deferred the whole response to the final flush: the
 * messages merged and every label after the first shipped as visible text.
 */
describe("stream buffer parenthesis balance", () => {
  it("does not hold for an emoticon's orphan closing paren", () => {
    expect(hasIncompleteSemanticMarkers("we won B)")).toBe(false);
    expect(hasIncompleteSemanticMarkers("nice :)")).toBe(false);
    expect(hasIncompleteSemanticMarkers("sneaky >:)")).toBe(false);
  });

  it("holds for a genuinely unclosed parenthetical so an aside is not split mid-way", () => {
    expect(hasIncompleteSemanticMarkers("we won (barely")).toBe(true);
  });

  it("does not hold once the parenthetical closes", () => {
    expect(hasIncompleteSemanticMarkers("we won (barely)")).toBe(false);
  });

  /**
   * The counter clamps at zero rather than banking orphan closers, so an earlier emoticon cannot
   * offset a later opener back to a balanced-looking total.
   */
  it("still holds when an emoticon precedes a genuinely unclosed parenthetical", () => {
    expect(hasIncompleteSemanticMarkers("we won :) (barely")).toBe(true);
  });

  it("closes a later parenthetical even when an emoticon contributed an orphan closer", () => {
    expect(autoCloseIncompleteMarkers("we won B) (barely")).toBe("we won B) (barely)");
  });

  it("keeps the multi-message label boundary flushable when a line ends in an emoticon", () => {
    const buffer = "@Obonya bet sending the vibes right now B)\ntomori (silly): double message combo";

    expect(hasIncompleteSemanticMarkers(buffer)).toBe(false);
  });
});

/**
 * An unclosed emphasis run is the same hazard as an unclosed quote: the newline and period breaks
 * would cut inside `*...and more*`, and chunkMessage() can only protect a span it receives whole.
 * The hold must also stay off for the stray markers prose is full of, because a false hold defers
 * every remaining flush in the response to the final flush, which costs the reply its pacing.
 */
describe("stream buffer emphasis markers", () => {
  it("holds while an emphasis run is open", () => {
    const unclosed = ["*...but if you're asking the answer's more than zero", "**still bold", "~~struck through"];
    const failures = unclosed.filter((buffer) => !hasIncompleteSemanticMarkers(buffer));
    expect(failures).toEqual([]);
  });

  it("does not hold once the run closes", () => {
    const closed = [
      "*italic* and more",
      "**bold** and *italic*",
      "~~struck~~ and more",
      "an _emphasis_ aside",
      "**bold *italic***",
    ];
    const failures = closed.filter((buffer) => hasIncompleteSemanticMarkers(buffer));
    expect(failures).toEqual([]);
  });

  it("does not hold for markers that are not emphasis delimiters", () => {
    const plain = [
      "call the user_id column of snake_case_table",
      "2 * 3 = 6 and 4 * 5 = 20",
      "* first item\n* second item",
      "a footnote marker like Best* in prose",
      "what the f*** is this",
      "~approx twenty",
      "kiss :* ok",
    ];
    const failures = plain.filter((buffer) => hasIncompleteSemanticMarkers(buffer));
    expect(failures).toEqual([]);
  });

  /**
   * "_" is left out of the hold on purpose, and inline code and URLs are blanked before the scan,
   * because each of these is common in casual and technical replies and would otherwise stop
   * streaming for the rest of the response.
   */
  it("does not hold for underscores, kaomoji, inline code, or URLs", () => {
    const ignored = [
      "_emphasis aside",
      "edit src/utils/_internal/x.ts",
      "the _id field and the _user field",
      "o_O ok",
      "ugh -_- fine",
      "yay ^_^ ok",
      "ugh >_< ok",
      "hmm ._. ok",
      "use `*args` here",
      "pass `**kwargs` too",
      "see https://site.dev/_next/x",
      "*_* wow",
    ];
    const failures = ignored.filter((buffer) => hasIncompleteSemanticMarkers(buffer));
    expect(failures).toEqual([]);
  });

  /**
   * Han, kana, and Hangul write without spaces, so a marker sits directly against letters there.
   * Counting those letters as word characters left the ja and zh-TW locales with the same mid-span
   * cut the classifier exists to prevent.
   */
  it("holds for a marker embedded in a spaceless script", () => {
    const unclosed = ["えっと*ため息をつきながら", "日本語*強調", "他說*重點", "안녕*강조"];
    const failures = unclosed.filter((buffer) => !hasIncompleteSemanticMarkers(buffer));
    expect(failures).toEqual([]);
  });

  // ASCII "~~" glued to kana is a wave-dash elongation, and one unpaired elongation would otherwise
  // hold every remaining flush of the reply.
  it("does not hold for a tilde elongation glued to kana", () => {
    const plain = ["おはよ~~！今日もがんばる\n", "やだ~~w\n", "えへへ~~♪\n"];
    const failures = plain.filter((buffer) => hasIncompleteSemanticMarkers(buffer));
    expect(failures).toEqual([]);
  });

  it("still does not hold for a marker inside a spaced-script word", () => {
    const plain = ["f***ing hell", "2*3", "a*b"];
    const failures = plain.filter((buffer) => hasIncompleteSemanticMarkers(buffer));
    expect(failures).toEqual([]);
  });
});

/**
 * A spoiler line used to read as a markdown table header still waiting for its separator row, so the
 * buffer never split at its newline and the next `Persona:` label shipped inside the spoiler's segment,
 * where the cleaner then dropped the spoiler as a leaked preamble.
 */
describe("stream buffer Discord spoilers", () => {
  it("does not hold a line whose only pipes are spoilers", () => {
    expect(hasIncompleteSemanticMarkers("Mirri (The Voice): ||We like Miso.||\n")).toBe(false);
    expect(hasIncompleteSemanticMarkers("a ||b|| c ||d||")).toBe(false);
  });

  it("holds when a spoiler tag is opened but not yet closed", () => {
    expect(hasIncompleteSemanticMarkers("||We want to be picked up like that.")).toBe(true);
  });

  it("does not hold once the spoiler closes on the same line", () => {
    expect(hasIncompleteSemanticMarkers("||We want to be picked up like that.||")).toBe(false);
  });

  it("holds a multi-line spoiler that has not closed yet", () => {
    expect(hasIncompleteSemanticMarkers("||No. That is slop.\n[Panel 1] They push us down.")).toBe(true);
  });

  it("does not hold for logical OR inside inline code", () => {
    expect(hasIncompleteSemanticMarkers("Use `a || b` here\nMore text follows.")).toBe(false);
  });

  it("does not hold for adjacent pipes in a well-formed table", () => {
    expect(hasIncompleteSemanticMarkers("| name | mid | age |\n|---|---|---|\n| Bob || 50 |\n\nParagraph after.")).toBe(
      false,
    );
  });

  it("auto-closes an unclosed spoiler on final flush", () => {
    expect(autoCloseIncompleteMarkers("||Secret text")).toBe("||Secret text||");
  });

  it("does not auto-close inline code pipes on final flush before a table", () => {
    const input = "Use `a || b` for the fallback.\n\n| Feature | Supported |\n|---|---|\n| A | Yes |\n";
    expect(autoCloseIncompleteMarkers(input)).toBe(input);
  });

  it("still holds a real table header that contains a spoiler cell", () => {
    expect(hasIncompleteSemanticMarkers("| ||secret|| | score |\n")).toBe(true);
  });

  it("splits a spoiler line from the speaker label on the next line", () => {
    const state = createDefaultStreamState();
    state.buffer = "Mirri (The Voice): ||We like Miso.||\nMirri: ...Ignore that.";

    const result = processBufferContent(state, { humanizerDegree: 1 } as Parameters<typeof processBufferContent>[1]);

    expect(result.segmentToFlush).toBe("Mirri (The Voice): ||We like Miso.||\n");
    expect(result.updatedBuffer).toBe("Mirri: ...Ignore that.");
  });
});
