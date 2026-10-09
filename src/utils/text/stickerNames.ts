export function normalizeStickerNameForExact(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/^:(.*):$/u, "$1")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

export function normalizeStickerNameForLoose(input: string): string {
  return normalizeStickerNameForExact(input)
    .replace(/[_-]+/gu, " ")
    .replace(/["'`“”‘’]+/gu, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
