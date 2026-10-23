/**
 * Tracked-media optimizer with per-scope strategies.
 *
 * Two policies, chosen by path (see scripts/lib/media.ts):
 *
 *  • personas/** + assets/img/**  → "lossless-fit"
 *      Re-encode losslessly (max deflate + adaptive filtering, metadata stripped)
 *      at native resolution. These are already near-optimally encoded, so a file is
 *      only downscaled (long edge capped at DEFAULT_MAX_DIMENSION, default 768px) when
 *      lossless alone cannot reach DEFAULT_LIMIT_BYTES. Color stays Δ0; only
 *      resolution drops, and only when necessary. Same format in/out.
 *
 *  • .github/release/**  → "release-card"
 *      Release cards are web-viewed showcase art where WebP crushes PNG. A static
 *      PNG/JPEG card is converted to WebP (DEFAULT_RELEASE_WEBP_QUALITY, default 90) at full
 *      resolution, the old file is removed, and sibling release-notes.md references
 *      are rewritten. A GIF stays a GIF because its author chose the format for the release
 *      post; it is replaced only by a smaller re-encode. Files that are ALREADY WebP are left
 *      untouched because re-encoding a lossy format every run would accumulate generational
 *      artifacts.
 *      NOTE: published GitHub release bodies hotlink raw/release and must be updated
 *      separately (the command prints the exact `gh release edit` reminder per tag).
 *
 * The budget and the encoder settings are constants in scripts/lib/media.ts, not environment
 * overrides, so every contributor computes the same result. None of them are tunable per run.
 *
 * A lossless-fit file is only overwritten when the result is actually smaller, so
 * the command is idempotent and safe to re-run.
 *
 * Usage:
 *   bun run compress-media                 # process every in-scope media file
 *   bun run compress-media --dry-run       # report what would change, write nothing
 *   bun run compress-media personas/shy    # only paths containing this substring
 */
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import sharp from "sharp";
import {
  type CompressTarget,
  DEFAULT_LIMIT_BYTES,
  DEFAULT_MAX_DIMENSION,
  DEFAULT_RELEASE_WEBP_QUALITY,
  formatBytes,
  listCompressTargets,
  RELEASE_PREFIX,
} from "../lib/media";

config({ quiet: true });

/** Smallest long-edge we will downscale to before giving up (keeps art recognizable). */
const MIN_DIMENSION = 96;

/** Lossless PNG encoder settings: NO `effort`/`palette` (those trigger lossy quantisation). */
const PNG_LOSSLESS = { compressionLevel: 9, adaptiveFiltering: true } as const;

/** Lowercased extension without the dot. */
const extOf = (p: string) => p.slice(p.lastIndexOf(".") + 1).toLowerCase();

/** Encode a sharp pipeline losslessly in the file's own format; null if unsupported. */
async function encodeLossless(pipeline: ReturnType<typeof sharp>, ext: string): Promise<Buffer | null> {
  switch (ext) {
    case "png":
      return await pipeline.png(PNG_LOSSLESS).toBuffer();
    case "webp":
      return await pipeline.webp({ lossless: true, effort: 6 }).toBuffer();
    case "gif":
      return await pipeline.gif().toBuffer();
    default:
      return null;
  }
}

/** Result of acting on one file. `newPath` differs from the source only on a WebP conversion. */
type Outcome = {
  path: string;
  newPath: string;
  oldSize: number;
  newSize: number;
  written: boolean;
  note: string;
  /** Tag (e.g. "v0.7.990") whose published release body still needs updating, if any. */
  releaseTagToUpdate?: string;
  /** Sibling markdown files whose references were rewritten. */
  refsUpdated?: string[];
};

/**
 * "lossless-fit": lossless@native first, then lossless at progressively smaller
 * caps until it fits the budget. Writes only when smaller than the original.
 */
async function runLosslessFit(file: CompressTarget, limit: number, maxDim: number, dryRun: boolean): Promise<Outcome> {
  const ext = extOf(file.path);
  const input = Buffer.from(await Bun.file(file.path).arrayBuffer());
  const isMultiFrameExt = ext === "gif" || ext === "webp";

  // Lossless at native resolution: preferred (full quality).
  const native = await encodeLossless(sharp(input, { animated: isMultiFrameExt }), ext);
  if (!native) {
    return {
      path: file.path,
      newPath: file.path,
      oldSize: file.size,
      newSize: file.size,
      written: false,
      note: `no optimizer for .${ext}`,
    };
  }

  let chosen = native;
  let downscaledTo: number | null = null;

  if (native.length > limit) {
    const meta = await sharp(input, { animated: isMultiFrameExt }).metadata();
    const frameHeight = meta.pageHeight ?? meta.height ?? 0;
    const nativeLongEdge = Math.max(meta.width ?? 0, frameHeight);
    let cap = Math.min(maxDim, nativeLongEdge);
    while (cap >= MIN_DIMENSION) {
      const resized = await encodeLossless(
        sharp(input, { animated: isMultiFrameExt }).resize(cap, cap, {
          fit: "inside",
          withoutEnlargement: true,
          kernel: "lanczos3",
        }),
        ext,
      );
      if (resized && resized.length < chosen.length) {
        chosen = resized;
        downscaledTo = cap;
      }
      if (resized && resized.length <= limit) break;
      cap = Math.floor(cap * 0.85); // shrink ~15% and retry
    }
  }

  // Only adopt when it genuinely shrinks the file (keeps re-runs idempotent).
  const improved = chosen.length < file.size;
  if (improved && !dryRun) writeFileSync(file.path, chosen);

  const newSize = improved ? chosen.length : file.size;
  const res = downscaledTo ? `@${downscaledTo}px` : "@native";
  const note = !improved ? "already optimal" : `lossless ${res}${newSize > limit ? " — STILL over budget" : ""}`;
  return { path: file.path, newPath: file.path, oldSize: file.size, newSize, written: improved && !dryRun, note };
}

/** Replace `oldName` with `newName` in every sibling .md file; returns the files changed. */
function rewriteSiblingReferences(filePath: string, oldName: string, newName: string, dryRun: boolean): string[] {
  const dir = filePath.slice(0, filePath.lastIndexOf("/"));
  const updated: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".md")) continue;
    const mdPath = `${dir}/${entry}`;
    const text = readFileSync(mdPath, "utf8");
    if (!text.includes(oldName)) continue;
    if (!dryRun) writeFileSync(mdPath, text.replaceAll(oldName, newName));
    updated.push(mdPath);
  }
  return updated;
}

/**
 * "release-card": keep a GIF in place unless a native re-encode is smaller; convert any other
 * non-WebP card to WebP at full resolution, remove the source, and rewrite sibling markdown
 * references. Already-WebP files are skipped to avoid lossy generational re-encoding.
 */
async function runReleaseCard(file: CompressTarget, quality: number, dryRun: boolean): Promise<Outcome> {
  const ext = extOf(file.path);
  const input = Buffer.from(await Bun.file(file.path).arrayBuffer());

  if (ext === "gif") {
    const encoded = await encodeLossless(sharp(input, { animated: true }), ext);
    const smaller = encoded && encoded.length < file.size ? encoded : null;
    if (smaller && !dryRun) writeFileSync(file.path, smaller);
    return {
      path: file.path,
      newPath: file.path,
      oldSize: file.size,
      newSize: smaller?.length ?? file.size,
      written: smaller !== null && !dryRun,
      note: smaller ? "gif re-encoded @native" : "already optimal",
    };
  }

  // Already WebP, so leave it alone (re-encoding lossy WebP each run degrades it).
  if (ext === "webp") {
    return {
      path: file.path,
      newPath: file.path,
      oldSize: file.size,
      newSize: file.size,
      written: false,
      note: "already webp",
    };
  }

  // Convert to WebP at native resolution (showcase art is viewed full-size).
  const webp = await sharp(input).webp({ quality, effort: 6 }).toBuffer();
  const newPath = file.path.replace(/\.[^.]+$/, ".webp");
  const oldName = file.path.slice(file.path.lastIndexOf("/") + 1);
  const newName = newPath.slice(newPath.lastIndexOf("/") + 1);

  let refsUpdated: string[] = [];
  if (!dryRun) {
    writeFileSync(newPath, webp); // write the .webp ...
    rmSync(file.path); //            ... and drop the old format
    refsUpdated = rewriteSiblingReferences(file.path, oldName, newName, false);
  } else {
    refsUpdated = rewriteSiblingReferences(file.path, oldName, newName, true);
  }

  // Derive the release tag so we can remind the user to fix the published body.
  const tag = file.path.slice(RELEASE_PREFIX.length).split("/")[0];

  const note = `→ webp q${quality} @native`;

  return {
    path: file.path,
    newPath,
    oldSize: file.size,
    newSize: webp.length,
    written: !dryRun,
    note,
    releaseTagToUpdate: tag,
    refsUpdated,
  };
}

async function main(): Promise<void> {
  const limit = DEFAULT_LIMIT_BYTES;
  const maxDim = DEFAULT_MAX_DIMENSION;
  const webpQuality = DEFAULT_RELEASE_WEBP_QUALITY;
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const filters = args.filter((a) => !a.startsWith("--"));

  let candidates = listCompressTargets();
  if (filters.length > 0) {
    candidates = candidates.filter((file) => filters.some((f) => file.path.includes(f)));
  }
  if (candidates.length === 0) {
    console.log("[compress-media] no in-scope media matched.");
    return;
  }

  console.log(
    `[compress-media] ${dryRun ? "DRY RUN — " : ""}processing ${candidates.length} file(s) · budget ${formatBytes(limit)} · downscale cap ${maxDim}px · release WebP q${webpQuality}\n`,
  );

  const outcomes: Outcome[] = [];
  for (const file of candidates) {
    outcomes.push(
      file.strategy === "release-card"
        ? await runReleaseCard(file, webpQuality, dryRun)
        : await runLosslessFit(file, limit, maxDim, dryRun),
    );
  }

  let totalBefore = 0;
  let totalAfter = 0;
  const stillOver: Outcome[] = [];
  const releaseTags = new Set<string>();
  for (const o of outcomes) {
    totalBefore += o.oldSize;
    totalAfter += o.newSize;
    const saved = o.oldSize - o.newSize;
    const label = o.newPath === o.path ? o.path : `${o.path} → ${o.newPath.slice(o.newPath.lastIndexOf("/") + 1)}`;
    if (saved <= 0 && !o.written) {
      console.log(`  [=] ${label} — ${formatBytes(o.oldSize)} (${o.note})`);
    } else {
      const pct = ((saved / o.oldSize) * 100).toFixed(0);
      const verb = o.written ? "→" : "would →";
      console.log(`  [↓] ${label} — ${formatBytes(o.oldSize)} ${verb} ${formatBytes(o.newSize)} (-${pct}%, ${o.note})`);
    }
    if (o.refsUpdated?.length)
      console.log(`      ↳ refs ${dryRun ? "to update" : "updated"}: ${o.refsUpdated.join(", ")}`);
    if (o.releaseTagToUpdate) releaseTags.add(o.releaseTagToUpdate);
    // Budget only applies to lossless-fit (gate) files, not WebP release cards.
    if (o.newPath === o.path && o.newSize > limit && o.note.includes("lossless")) stillOver.push(o);
  }

  const totalSaved = totalBefore - totalAfter;
  console.log(
    `\n[compress-media] ${formatBytes(totalBefore)} → ${formatBytes(totalAfter)} (saved ${formatBytes(totalSaved)})${dryRun ? " — DRY RUN, nothing written" : ""}`,
  );

  if (releaseTags.size > 0) {
    console.log(
      `\n⚠ Converted release cards. Their PUBLISHED GitHub release bodies hotlink raw/release and must be updated:`,
    );
    for (const tag of [...releaseTags].sort()) {
      console.log(`  - ${tag}: update the image link (→ .webp) via \`gh release edit ${tag} ...\``);
    }
    console.log("  Then commit + push the .webp to main so the links resolve.");
  }

  if (stillOver.length > 0) {
    console.log(`\n⚠ ${stillOver.length} file(s) still exceed the ${formatBytes(limit)} budget:`);
    for (const o of stillOver) console.log(`  - ${o.path} — ${formatBytes(o.newSize)} (${o.note})`);
    console.log(
      "  These files cannot shrink further under the current constants in scripts/lib/media.ts. Lower DEFAULT_MAX_DIMENSION, raise DEFAULT_LIMIT_BYTES, or hand-edit these.",
    );
  }
}

main().catch((err) => {
  console.error("[compress-media] failed:", err);
  process.exit(1);
});
