import { describe, expect, it } from "bun:test";
import { HumanizerDegree } from "@/types/db/schema";
import { chunkMessage, createSentenceSplitRegex, maskInlineCodeAndUrls } from "@/utils/text/processors/chunkProcessor";

// The regex is a negative-lookbehind split: it matches sentence-ending periods
// that do NOT follow abbreviations, numbers, or acronyms. Tests verify both
// the "splits here" and "does NOT split here" cases, which are equally load-bearing.

describe("createSentenceSplitRegex", () => {
  let regex: RegExp;

  // Rebuild the regex before each test: the regex has state via lastIndex when
  // used with exec(), so a fresh instance avoids cross-test interference.
  const getRegex = () => createSentenceSplitRegex();

  describe("splits at standard sentence-ending periods", () => {
    it("splits 'Hello. World' into two parts", () => {
      regex = getRegex();
      const parts = "Hello. World".split(regex);
      expect(parts.length).toBeGreaterThanOrEqual(2);
      expect(parts[0]).toBe("Hello");
    });

    it("splits at end-of-string period", () => {
      regex = getRegex();
      const parts = "Done.".split(regex);
      expect(parts.length).toBeGreaterThanOrEqual(2);
    });

    it("splits multiple sentences", () => {
      regex = getRegex();
      const parts = "First. Second. Third.".split(regex).filter((s) => s?.trim());
      expect(parts.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("does NOT split on title abbreviations", () => {
    it("does not split 'Dr. Smith'", () => {
      regex = getRegex();
      const parts = "Dr. Smith visited".split(regex).filter((s) => s !== undefined);
      expect(parts.join("")).toBe("Dr. Smith visited");
    });

    it("does not split 'Mr. Jones'", () => {
      regex = getRegex();
      const parts = "Hello Mr. Jones".split(regex).filter((s) => s !== undefined);
      expect(parts.join("")).toBe("Hello Mr. Jones");
    });

    it("does not split 'Mrs. Smith'", () => {
      regex = getRegex();
      const parts = "Mrs. Smith arrived".split(regex).filter((s) => s !== undefined);
      expect(parts.join("")).toBe("Mrs. Smith arrived");
    });

    it("does not split 'Prof. Adams'", () => {
      regex = getRegex();
      const parts = "Prof. Adams taught".split(regex).filter((s) => s !== undefined);
      expect(parts.join("")).toBe("Prof. Adams taught");
    });
  });

  describe("does NOT split on business abbreviations", () => {
    it("does not split 'Inc. founded'", () => {
      regex = getRegex();
      const parts = "Acme Inc. founded in 1990".split(regex).filter((s) => s !== undefined);
      expect(parts.join("")).toBe("Acme Inc. founded in 1990");
    });

    it("does not split 'vs. opponent'", () => {
      regex = getRegex();
      const parts = "Team A vs. Team B".split(regex).filter((s) => s !== undefined);
      expect(parts.join("")).toBe("Team A vs. Team B");
    });
  });

  describe("does NOT split on numbers", () => {
    it("does not split decimal number '3.14'", () => {
      regex = getRegex();
      const parts = "Pi is 3.14 approximately".split(regex).filter((s) => s !== undefined);
      expect(parts.join("")).toBe("Pi is 3.14 approximately");
    });

    it("does not split numbered list like '1. Item'", () => {
      regex = getRegex();
      const parts = "Step 1. Do this".split(regex).filter((s) => s !== undefined);
      expect(parts.join("")).toBe("Step 1. Do this");
    });
  });

  describe("acronym trailing-period behavior (known limitation)", () => {
    // The lookbehind guards mid-sequence dots (e.g. the dot between U and S in U.S.)
    // but the character immediately before the *final* trailing period is always a letter,
    // not a dot so the acronym guard does not fire on the trailing dot.
    // "U.S. is large" → the period after S IS matched and consumed by the split.
    it("splits trailing period of 'U.S.' (lookbehind does not cover the final dot)", () => {
      regex = getRegex();
      const text = "The U.S. is large";
      const parts = text.split(regex).filter((s) => s !== undefined);
      expect(parts.join("")).toBe("The U.S is large");
    });
  });

  describe("splits on Japanese sentence period 。", () => {
    it("splits 'こんにちは。世界'", () => {
      regex = getRegex();
      const parts = "こんにちは。世界".split(regex).filter((s) => s?.trim());
      expect(parts.length).toBeGreaterThanOrEqual(2);
    });

    it("splits mixed Japanese and English", () => {
      regex = getRegex();
      const parts = "Hello。World".split(regex).filter((s) => s?.trim());
      expect(parts.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("does NOT split on latin abbreviations", () => {
    it("does not split 'etc. more'", () => {
      regex = getRegex();
      const parts = "blah etc. more stuff".split(regex).filter((s) => s !== undefined);
      expect(parts.join("")).toBe("blah etc. more stuff");
    });

    it("does not split 'e.g. example'", () => {
      regex = getRegex();
      const parts = "for e.g. this case".split(regex).filter((s) => s !== undefined);
      expect(parts.join("")).toBe("for e.g. this case");
    });
  });

  describe("full-width periods and other target-language abbreviations", () => {
    it("splits at full-width and halfwidth ideographic periods", () => {
      expect("你好．世界".split(getRegex()).filter((s) => s?.trim())).toEqual(["你好", "世界"]);
      expect("ｺﾝﾆﾁﾊ｡ｾｶｲ".split(getRegex()).filter((s) => s?.trim())).toEqual(["ｺﾝﾆﾁﾊ", "ｾｶｲ"]);
    });

    it("does not split after Spanish, Portuguese, French, or Russian abbreviations", () => {
      for (const text of ["La Sra. García llegó", "Chegou a Dra. Lima", "Bonjour Mme. Dupont", "Это т.е. пример"]) {
        expect(text.split(getRegex()).join("")).toBe(text);
      }
    });
  });
});

describe("chunkMessage hard breaks", () => {
  it("breaks unspaced text after a full-width mark before resorting to a hard cut", () => {
    const text = `${"字".repeat(18)}、${"字".repeat(11)}`;
    const chunks = chunkMessage(text, HumanizerDegree.NONE, 20);
    expect(chunks[0]).toBe(`${"字".repeat(18)}、`);
    expect(chunks.join("")).toBe(text);
  });

  it("never cuts between the two halves of a surrogate pair", () => {
    const text = `a${"😀".repeat(15)}`;
    const chunks = chunkMessage(text, HumanizerDegree.NONE, 20);
    expect(chunks.join("")).toBe(text);
    for (const chunk of chunks) {
      expect(chunk).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
  });
});

describe("chunkMessage HEAVY protected spans", () => {
  // The semantic-block pass merges protected spans into plain text blocks so surrounding prose
  // stays in one message. The HEAVY branch used to re-split that block at every newline and
  // sentence period, which cut spans in half and left each message with one half of the pair as
  // literal syntax.
  it("keeps a span with an internal newline in one message", () => {
    const text = "*...but if you're asking the answer's more than zero\ndon't make me say a number.*";

    expect(chunkMessage(text, HumanizerDegree.HEAVY)).toEqual([text]);
  });

  it("keeps an @{handle} with a period in its name in one message", () => {
    expect(chunkMessage("yo @{Mirri J. Juno} welcome. enjoy", HumanizerDegree.HEAVY)).toEqual([
      "yo @{Mirri J. Juno} welcome",
      "enjoy",
    ]);
  });

  it("keeps a span with an internal sentence period in one message", () => {
    expect(chunkMessage("*he said. then he left*", HumanizerDegree.HEAVY)).toEqual(["*he said. then he left*"]);
    expect(chunkMessage("**bold. still bold**", HumanizerDegree.HEAVY)).toEqual(["**bold. still bold**"]);
    expect(chunkMessage('he said "hi. there" ok', HumanizerDegree.HEAVY)).toEqual(['he said "hi. there" ok']);
    expect(chunkMessage("~~old plan. new plan~~", HumanizerDegree.HEAVY)).toEqual(["~~old plan. new plan~~"]);
    expect(chunkMessage("(wait. really?) ok", HumanizerDegree.HEAVY)).toEqual(["(wait. really?) ok"]);
    expect(chunkMessage("run `a. b` now", HumanizerDegree.HEAVY)).toEqual(["run `a. b` now"]);
  });

  it("keeps a multi-line quoted block in one message", () => {
    const text = '"\nthen the prompt layer gets yeeted AGAIN\ndecember you is gonna HATE september you"';

    expect(chunkMessage(text, HumanizerDegree.HEAVY)).toEqual([text]);
  });

  it("still splits sentences and newlines outside a span", () => {
    expect(chunkMessage("first. *a. b* second", HumanizerDegree.HEAVY)).toEqual(["first", "*a. b* second"]);
    expect(chunkMessage("line one\nline two\n*keep. this*", HumanizerDegree.HEAVY)).toEqual([
      "line one",
      "line two",
      "*keep. this*",
    ]);
  });

  it("splits a span longer than the chunk limit instead of sending an oversized message", () => {
    const text = `*${"word ".repeat(600).trim()}.*`;
    const chunks = chunkMessage(text, HumanizerDegree.HEAVY, 1950);

    expect(chunks.length).toBeGreaterThan(1);
    // findBreakPoint can break one character past the requested length, so the ceiling that
    // actually matters here is Discord's 2000-character message limit.
    expect(chunks.filter((chunk) => chunk.length > 2000)).toEqual([]);
    expect(chunks.join(" ")).toContain("word word word");
  });

  it("leaves the span split per paragraph below HEAVY", () => {
    expect(chunkMessage("*a. b\nc. d*", HumanizerDegree.LIGHT)).toEqual(["*a. b", "c. d*"]);
    expect(chunkMessage("*a. b\nc. d*", HumanizerDegree.NONE)).toEqual(["*a. b\nc. d*"]);
  });

  /**
   * The span finders pair any two markers, so every one of these arrives as an emphasis candidate.
   * Protecting them would suppress the paragraph and sentence splits the degree exists to make,
   * which is why a candidate has to clear the flanking rules before it is held whole.
   */
  it("ignores markers that are not emphasis delimiters", () => {
    expect(chunkMessage("* first item\n* second item\n* third item\n* fourth item", HumanizerDegree.HEAVY)).toEqual([
      "* first item",
      "* second item",
      "* third item",
      "* fourth item",
    ]);
    expect(chunkMessage("ugh -_- fine. whatever. >_< stop", HumanizerDegree.HEAVY)).toEqual([
      "ugh -_- fine",
      "whatever",
      ">_< stop",
    ]);
    expect(chunkMessage("yay ^_^ that worked. now fix snake_case next. ok bye", HumanizerDegree.HEAVY)).toEqual([
      "yay ^_^ that worked",
      "now fix snake_case next",
      "ok bye",
    ]);
    expect(chunkMessage("he's 2 * 3 years old. no wait. it's 4 * 5", HumanizerDegree.HEAVY)).toEqual([
      "he's 2 * 3 years old",
      "no wait",
      "it's 4 * 5",
    ]);
    expect(chunkMessage("the user_id thing. then a_b later. done", HumanizerDegree.HEAVY)).toEqual([
      "the user_id thing",
      "then a_b later",
      "done",
    ]);
  });

  it("still protects a real span that follows rejected markers", () => {
    expect(chunkMessage("* first item\n* second item\n*third. span*", HumanizerDegree.HEAVY)).toEqual([
      "* first item",
      "* second item",
      "*third. span*",
    ]);
    // The rejected bullet marker sits in the same sentence as the real span, so the two share one
    // message: what the rescan buys is that "real. span" is held whole instead of splitting there.
    expect(chunkMessage("* item *real. span*", HumanizerDegree.HEAVY)).toEqual(["* item *real. span*"]);
    // Underscore emphasis is still held whole in text the chunker receives, even though the stream
    // hold ignores "_" so identifiers and kaomoji cannot stall a reply.
    expect(chunkMessage("_emphasised. aside_", HumanizerDegree.HEAVY)).toEqual(["_emphasised. aside_"]);
  });

  it("keeps a span whole when a spaceless script glues the marker to its text", () => {
    const japanese = "ふん*顔をそむける。でも嬉しい*わけじゃない";
    expect(chunkMessage(japanese, HumanizerDegree.HEAVY)).toEqual([japanese]);
    expect(chunkMessage("他說*重點。在這*啦", HumanizerDegree.HEAVY)).toEqual(["他說*重點。在這*啦"]);
    expect(chunkMessage("안녕*강조。이거*해요", HumanizerDegree.HEAVY)).toEqual(["안녕*강조。이거*해요"]);
    // A spaced script keeps the intraword rule, so a Latin word glued to the marker is not a span.
    expect(chunkMessage("word*emph. span*word", HumanizerDegree.HEAVY)).toEqual(["word*emph", "span*word"]);
  });

  it("does not treat an emoticon's bare parens as a parenthetical aside", () => {
    expect(chunkMessage("ugh :( that sucks. anyway. glad you're back :)", HumanizerDegree.HEAVY)).toEqual([
      "ugh :( that sucks",
      "anyway",
      "glad you're back :)",
    ]);
    // The rejected face opener is skipped, so the real aside after it is still protected: without
    // that protection the "sure." period would split this into two messages.
    expect(chunkMessage("hmm :( (really. sure.) ok", HumanizerDegree.HEAVY)).toEqual(["hmm :( (really. sure.) ok"]);
    // A real aside keeps its protection, including the one whose closer follows a colon.
    expect(chunkMessage("sure (ok. fine) whatever", HumanizerDegree.HEAVY)).toEqual(["sure (ok. fine) whatever"]);
    expect(chunkMessage("(see note: it. is fine) ok", HumanizerDegree.HEAVY)).toEqual(["(see note: it. is fine) ok"]);
  });

  it("does not let a marker inside inline code become a span", () => {
    expect(chunkMessage("run `a. b` and *real. span* now", HumanizerDegree.HEAVY)).toEqual([
      "run `a. b` and *real. span* now",
    ]);
  });

  it("blanks inline code and URLs before an emphasis scan without shifting any offset", () => {
    const input = "use `*args` and https://x.dev/_next/a here";
    const masked = maskInlineCodeAndUrls(input);

    expect(masked).toHaveLength(input.length);
    expect(masked).not.toContain("*");
    expect(masked).not.toContain("_");
    expect(masked).toContain("use ");
    expect(masked).toContain("and");
    expect(masked).toContain("here");
  });
});

describe("chunkMessage emoji runs", () => {
  it("merges adjacent custom emojis only when their names share a three-character prefix", () => {
    const chunks = chunkMessage("<:JoeCaught_1:1><:JoeCaught_2:2>\n<:abcx:3><:abdx:4><:tom:5><:tomori:6>", 1);

    expect(chunks).toEqual(["<:JoeCaught_1:1><:JoeCaught_2:2>", "<:abcx:3>", "<:abdx:4>", "<:tom:5><:tomori:6>"]);
  });
});
