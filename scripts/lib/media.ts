/**
 * Shared helpers for the tracked-media tooling.
 *
 * Both `check-media-size` (the read-only gate) and `compress-media` (the
 * in-place optimizer) reason about the same set of files and the same byte
 * budget, so the scope definition and the budget live here to keep them in
 * lockstep. The budget and the encoder settings are constants rather than
 * environment overrides so every checkout enforces the same ceiling; raise
 * them here when legitimate art genuinely cannot fit.
 */
import { existsSync, statSync } from "node:fs";
import { spawnSync } from "bun";

/** Per-file byte budget enforced by the gate. */
export const DEFAULT_LIMIT_BYTES = 1024 * 1024;

/** Long-edge cap (px) applied only when a file must be downscaled to fit the budget. */
export const DEFAULT_MAX_DIMENSION = 768;

/** File extensions treated as media (lower-cased, no leading dot). */
export const MEDIA_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "tiff",
  "ico",
  "avif",
  "mp4",
  "webm",
  "mov",
  "mkv",
  "mp3",
  "wav",
  "ogg",
  "flac",
  "m4a",
]);

/**
 * Path prefixes (forward-slash, repo-relative) that are in scope for the gate.
 * Anything outside these prefixes is ignored even if it is tracked media.
 */
export const SCOPE_PREFIXES = ["src/db/seed/catalog/personas/", "assets/img/"];

/** Prefix identifying Default Persona art, flagged with extra emphasis in output. */
export const PERSONA_PREFIX = "src/db/seed/catalog/personas/";

/**
 * Prefix for historical release cards. These are NOT in the gate scope (excluded
 * on purpose), but `compress-media` still normalizes them to WebP, so they are
 * web-viewed showcase art where WebP wins hugely over PNG.
 */
export const RELEASE_PREFIX = ".github/release/";

/** WebP quality used when normalizing static release cards. */
export const DEFAULT_RELEASE_WEBP_QUALITY = 90;

/** Human-readable byte size, e.g. 1572864 -> "1.50 MB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/** Lower-cased extension of a path without the leading dot, or "" if none. */
export function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

/**
 * List every git-tracked file path (forward-slash, repo-relative). We scan only
 * tracked files so untracked scratch art and node_modules are never flagged.
 */
export function listTrackedFiles(): string[] {
  // -z gives NUL-separated paths so spaces/quoting never corrupt the list.
  const result = spawnSync(["git", "ls-files", "-z"], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`git ls-files failed: ${stderr || `exit code ${result.exitCode}`}`);
  }
  return result.stdout.toString().split("\0").filter(Boolean);
}

/**
 * List untracked, non-gitignored file paths within the given scope prefixes
 * (forward-slash, repo-relative). These are files present on disk but not yet
 * staged or committed because `git ls-files` alone misses them entirely.
 */
export function listUntrackedInScopePaths(prefixes: string[]): string[] {
  // --others = untracked files; --exclude-standard = respect .gitignore.
  // Passing the prefixes as pathspecs scopes the output without a repo-wide walk.
  const result = spawnSync(["git", "ls-files", "--others", "--exclude-standard", "-z", "--", ...prefixes], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`git ls-files --others failed: ${stderr || `exit code ${result.exitCode}`}`);
  }
  return result.stdout.toString().split("\0").filter(Boolean);
}

/** One in-scope tracked media file with its current on-disk size. */
export type MediaFile = { path: string; size: number; isPersona: boolean };

/**
 * Return every tracked or untracked (non-ignored) media file inside
 * SCOPE_PREFIXES, with its size. Including untracked files ensures that newly
 * added art is blocked before it is ever committed.
 */
export function listInScopeMedia(): MediaFile[] {
  const tracked = listTrackedFiles().filter(
    (path) => SCOPE_PREFIXES.some((prefix) => path.startsWith(prefix)) && MEDIA_EXTENSIONS.has(extensionOf(path)),
  );
  const untracked = listUntrackedInScopePaths(SCOPE_PREFIXES).filter((path) => MEDIA_EXTENSIONS.has(extensionOf(path)));

  // Merge, deduplicate by path (a file staged but not committed appears in both).
  const seen = new Set<string>();
  return [...tracked, ...untracked]
    .filter((path) => !seen.has(path) && seen.add(path))
    .filter((path) => existsSync(path))
    .map((path) => ({ path, size: statSync(path).size, isPersona: path.startsWith(PERSONA_PREFIX) }));
}

/** Compression policy for a file: shrink-in-place vs the release card policy. */
export type CompressStrategy = "lossless-fit" | "release-card";

/** A media file `compress-media` will act on, tagged with the strategy to apply. */
export type CompressTarget = MediaFile & { strategy: CompressStrategy };

/**
 * Return every tracked or untracked (non-ignored) media file `compress-media`
 * operates on. This is a SUPERSET of the gate scope: gate-scoped files (personas
 * + assets) get "lossless-fit", while release cards get "release-card". The gate itself
 * never sees release cards. Untracked files in scope prefixes are included so
 * newly added art can be compressed before it is ever committed.
 */
export function listCompressTargets(): CompressTarget[] {
  const isInScope = (path: string) =>
    SCOPE_PREFIXES.some((prefix) => path.startsWith(prefix)) || path.startsWith(RELEASE_PREFIX);

  const tracked = listTrackedFiles().filter((path) => MEDIA_EXTENSIONS.has(extensionOf(path)) && isInScope(path));
  // Include untracked files across both gate scopes and release cards so new art can be compressed before commit.
  const untracked = listUntrackedInScopePaths([...SCOPE_PREFIXES, RELEASE_PREFIX]).filter((path) =>
    MEDIA_EXTENSIONS.has(extensionOf(path)),
  );

  const seen = new Set<string>();
  return [...tracked, ...untracked]
    .filter((path) => !seen.has(path) && seen.add(path))
    .filter((path) => existsSync(path))
    .map((path) => ({
      path,
      size: statSync(path).size,
      isPersona: path.startsWith(PERSONA_PREFIX),
      strategy: (path.startsWith(RELEASE_PREFIX) ? "release-card" : "lossless-fit") as CompressStrategy,
    }));
}
