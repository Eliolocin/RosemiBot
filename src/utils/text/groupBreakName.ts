/**
 * Visually identical webhook usernames that Discord still treats as distinct authors.
 *
 * Discord groups consecutive webhook messages by webhook + username, ignores the per-message
 * avatar, and strips zero-width characters from usernames, so an invisible marker cannot break
 * a group. Swapping one letter for its lookalike in the other alphabet (Latin `o` for Cyrillic
 * `о`) survives Unicode normalization because the two are different scripts, not compatibility
 * variants.
 *
 * Every reader recovers the clean name through {@link revealGroupBreakName}, which
 * `normalizeParticipantAlias` applies, so the swap must stay detectable: it only ever lands in a
 * word that is otherwise pure Latin or pure Cyrillic and long enough that the swapped letter is a
 * strict minority.
 */

// Restricted to pairs that render identically in Discord's UI font; looser pairs such as
// `y`/`у` or `K`/`К` differ in tail or stroke and would make the swap noticeable.
const LATIN_TO_CYRILLIC: Readonly<Record<string, string>> = {
  a: "а",
  c: "с",
  e: "е",
  i: "і",
  j: "ј",
  o: "о",
  p: "р",
  s: "ѕ",
  x: "х",
  A: "А",
  B: "В",
  C: "С",
  E: "Е",
  H: "Н",
  I: "І",
  J: "Ј",
  M: "М",
  O: "О",
  P: "Р",
  S: "Ѕ",
  T: "Т",
  X: "Х",
};

const CYRILLIC_TO_LATIN: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(LATIN_TO_CYRILLIC).map(([latin, cyrillic]) => [cyrillic, latin]),
);

// After the swap the word keeps at least two base letters against one swapped letter, so
// revealGroupBreakName can tell which alphabet is the original by majority alone.
const MIN_BASE_LETTERS = 3;

const WORD_PATTERN = /\p{L}+/gu;
const LATIN_LETTER = /\p{Script=Latin}/u;
const CYRILLIC_LETTER = /\p{Script=Cyrillic}/u;

function countAlphabets(word: string): { latin: number; cyrillic: number } {
  let latin = 0;
  let cyrillic = 0;
  for (const char of word) {
    if (LATIN_LETTER.test(char)) latin += 1;
    else if (CYRILLIC_LETTER.test(char)) cyrillic += 1;
  }
  return { latin, cyrillic };
}

function swapTableForSingleAlphabetWord(word: string): Readonly<Record<string, string>> | null {
  const { latin, cyrillic } = countAlphabets(word);
  if (cyrillic === 0 && latin >= MIN_BASE_LETTERS) return LATIN_TO_CYRILLIC;
  if (latin === 0 && cyrillic >= MIN_BASE_LETTERS) return CYRILLIC_TO_LATIN;
  return null;
}

/**
 * Returns `name` with one letter replaced by its lookalike from the other alphabet, or null when
 * no word qualifies (for example a kana or hanzi name, or one with only short words).
 *
 * Scans from the end of the name so the leading letters stay byte-identical: models read and
 * echo names left to right, and an untouched prefix keeps the name's opening tokens stable.
 *
 * @param name - The clean webhook username.
 * @returns The group-break variant, or null when the caller must use a visible fallback.
 */
export function toGroupBreakName(name: string): string | null {
  const words = [...name.matchAll(WORD_PATTERN)];
  for (let wordIndex = words.length - 1; wordIndex >= 0; wordIndex -= 1) {
    const match = words[wordIndex];
    const word = match[0];
    const table = swapTableForSingleAlphabetWord(word);
    if (!table) continue;

    // Every table key is a single BMP code unit, so UTF-16 indexing never splits a match.
    for (let charIndex = word.length - 1; charIndex >= 0; charIndex -= 1) {
      const lookalike = table[word[charIndex]];
      if (!lookalike) continue;
      const at = match.index + charIndex;
      return `${name.slice(0, at)}${lookalike}${name.slice(at + 1)}`;
    }
  }
  return null;
}

/**
 * Restores a name produced by {@link toGroupBreakName}. Within each word that mixes Latin and
 * Cyrillic letters, lookalikes from the minority alphabet are mapped to the majority one; a tie is
 * left untouched because neither side can be identified as the original.
 *
 * @param value - Any name, swapped or not.
 * @returns The name with group-break lookalikes folded back.
 */
export function revealGroupBreakName(value: string): string {
  if (!CYRILLIC_LETTER.test(value)) return value;

  return value.replace(WORD_PATTERN, (word) => {
    const { latin, cyrillic } = countAlphabets(word);
    if (latin === 0 || cyrillic === 0 || latin === cyrillic) return word;
    const table = latin > cyrillic ? CYRILLIC_TO_LATIN : LATIN_TO_CYRILLIC;
    return Array.from(word, (char) => table[char] ?? char).join("");
  });
}
