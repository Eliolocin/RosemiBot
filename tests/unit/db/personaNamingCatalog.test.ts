import { describe, expect, it } from "bun:test";
import { personaSections } from "@/db/seed/catalog/personas";

describe("official persona naming catalog", () => {
  it("keeps every seeded lineage and language map explicit and exact", () => {
    const actual = Object.fromEntries(
      personaSections
        .flatMap((section) => section.rows)
        .map((persona) => [`${persona.lineageId}:${persona.language}`, persona.namingConfig]),
    );
    expect(actual).toEqual({
      "4:en-US": {
        prefixes: {},
        suffixes: {},
        addressTerms: { masculine: "bro", feminine: "sis", neutral: "fam" },
      },
      "4:ja": { prefixes: {}, suffixes: {}, addressTerms: {} },
      "4:pt-BR": {
        prefixes: {},
        suffixes: {},
        addressTerms: { masculine: "mano", feminine: "mana", neutral: "parça" },
      },
      "4:es-419": {
        prefixes: {},
        suffixes: {},
        addressTerms: { masculine: "bro", feminine: "amiga", neutral: "compa" },
      },
      "4:zh-TW": {
        prefixes: {},
        suffixes: {},
        addressTerms: { masculine: "老哥", feminine: "老妹", neutral: "朋友" },
      },
      "4:vi": {
        prefixes: {},
        suffixes: {},
        addressTerms: { masculine: "bro", feminine: "chị", neutral: "anh em" },
      },
      "4:zh-CN": {
        prefixes: {},
        suffixes: {},
        addressTerms: { masculine: "哥们", feminine: "姐妹", neutral: "朋友" },
      },
      "666:en-US": {
        prefixes: {},
        suffixes: {},
        addressTerms: { masculine: "mon chéri", feminine: "ma chérie", neutral: "mon amour" },
      },
      "50:en-US": {
        prefixes: { masculine: "Master", feminine: "Mistress", neutral: "Master" },
        suffixes: {},
        addressTerms: {},
      },
      "50:ja": { prefixes: {}, suffixes: { neutral: "様" }, addressTerms: {} },
      "50:pt-BR": {
        prefixes: { masculine: "Mestre", feminine: "Mestra", neutral: "Mestre" },
        suffixes: {},
        addressTerms: {},
      },
      "50:es-419": {
        prefixes: { masculine: "Amo", feminine: "Ama", neutral: "Amo" },
        suffixes: {},
        addressTerms: {},
      },
      "50:zh-TW": {
        prefixes: { masculine: "主人", feminine: "大小姐", neutral: "主人" },
        suffixes: {},
        addressTerms: {},
      },
      "50:vi": {
        prefixes: { masculine: "Cậu chủ", feminine: "Cô chủ", neutral: "Chủ nhân" },
        suffixes: {},
        addressTerms: {},
      },
      "50:zh-CN": {
        prefixes: { masculine: "主人", feminine: "大小姐", neutral: "主人" },
        suffixes: {},
        addressTerms: {},
      },
      "716:en-US": { prefixes: {}, suffixes: {}, addressTerms: {} },
      "716:ja": { prefixes: {}, suffixes: {}, addressTerms: {} },
      "716:pt-BR": { prefixes: {}, suffixes: {}, addressTerms: {} },
      "716:es-419": { prefixes: {}, suffixes: {}, addressTerms: {} },
      "716:zh-TW": { prefixes: {}, suffixes: {}, addressTerms: {} },
      "716:vi": { prefixes: {}, suffixes: {}, addressTerms: {} },
      "716:zh-CN": { prefixes: {}, suffixes: {}, addressTerms: {} },
      "1770:en-US": { prefixes: {}, suffixes: {}, addressTerms: {} },
      "1770:ja": { prefixes: {}, suffixes: {}, addressTerms: {} },
      "1770:pt-BR": { prefixes: {}, suffixes: {}, addressTerms: {} },
      "1770:es-419": { prefixes: {}, suffixes: {}, addressTerms: {} },
      "1770:zh-TW": { prefixes: {}, suffixes: {}, addressTerms: {} },
      "1770:vi": { prefixes: {}, suffixes: {}, addressTerms: {} },
      "1770:zh-CN": { prefixes: {}, suffixes: {}, addressTerms: {} },
      "3585:en-US": { prefixes: {}, suffixes: { neutral: "-senpai" }, addressTerms: {} },
      "3585:ja": { prefixes: {}, suffixes: { neutral: "先輩" }, addressTerms: {} },
      "3585:pt-BR": { prefixes: {}, suffixes: { neutral: "-senpai" }, addressTerms: {} },
      "3585:es-419": { prefixes: {}, suffixes: { neutral: "-senpai" }, addressTerms: {} },
      "3585:zh-TW": { prefixes: {}, suffixes: { neutral: "-senpai" }, addressTerms: {} },
      "3585:vi": { prefixes: {}, suffixes: { neutral: "-senpai" }, addressTerms: {} },
      "3585:zh-CN": { prefixes: {}, suffixes: { neutral: "前辈" }, addressTerms: {} },
    });
  });

  it("uses macros for seeded user-vocative output habits", () => {
    const personas = personaSections.flatMap((section) => section.rows);
    const rose = personas.find((persona) => persona.lineageId === 4 && persona.language === "en-US");
    const shy = personas.filter((persona) => persona.lineageId === 3585);
    expect(rose?.sampleDialoguesOut.join("\n")).toContain("{user_term}");
    for (const persona of shy) {
      expect(persona.sampleDialoguesOut.join("\n")).toContain("{user_formatted}");
    }
  });
});
