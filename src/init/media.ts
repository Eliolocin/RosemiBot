import sharp from "sharp";
import { log } from "@/utils/misc/logger";

/**
 * libvips holds decoded bitmaps and its operation cache in native memory, which lands in
 * `process.memoryUsage().external` rather than the JS heap. Nothing in the cache-sweeping or
 * emergency-clear paths can reclaim it, and the memory guard only samples RSS, so an image
 * burst is invisible until it has already pushed the container toward its limit.
 *
 * Production sampling showed `arrayBuffers` swinging between 33 MB and 170 MB and `external`
 * between 82 MB and 316 MB against a 512 MB container budget, so the stock defaults (a 50 MB
 * operation cache and one worker thread per CPU) are too generous for this deployment.
 */
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_CACHE_MEMORY_MB = 16;
const DEFAULT_CACHE_ITEMS = 50;
const DEFAULT_CACHE_FILES = 0;

function readIntEnv(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    log.warn(`Ignoring ${name}="${raw}" (expected an integer >= ${minimum}); using ${fallback}`);
    return fallback;
  }

  return parsed;
}

/**
 * Applies process-global limits to sharp. Must run before any module performs image work,
 * because {@link sharp.concurrency} and {@link sharp.cache} configure a shared libvips instance.
 */
export function initMediaProcessing(): void {
  const concurrency = readIntEnv("SHARP_CONCURRENCY", DEFAULT_CONCURRENCY, 1);
  const cacheMemoryMb = readIntEnv("SHARP_CACHE_MEMORY_MB", DEFAULT_CACHE_MEMORY_MB, 0);
  const cacheItems = readIntEnv("SHARP_CACHE_ITEMS", DEFAULT_CACHE_ITEMS, 0);
  const cacheFiles = readIntEnv("SHARP_CACHE_FILES", DEFAULT_CACHE_FILES, 0);

  try {
    sharp.concurrency(concurrency);
    sharp.cache({ memory: cacheMemoryMb, items: cacheItems, files: cacheFiles });

    log.success(
      `Media processing configured (sharp concurrency: ${concurrency}, cache: ${cacheMemoryMb}MB / ${cacheItems} items / ${cacheFiles} files)`,
    );

    if (process.env.RUN_ENV === "production") {
      // Production defaults pino to `level: "error"`, so the line above is not emitted there and the
      // applied limits would be unverifiable from outside the process. `log.metric` is emitted at
      // every level and routes to TomoriBotMetrics_CL.
      log.metric("media_config", {
        sharp_concurrency: concurrency,
        sharp_cache_memory_mb: cacheMemoryMb,
        sharp_cache_items: cacheItems,
        sharp_cache_files: cacheFiles,
      });
    }
  } catch (error) {
    // Image features degrade rather than fail: leaving libvips on its defaults is worse for
    // memory but still functional, so this must not abort startup.
    log.error("Failed to configure sharp limits; continuing with libvips defaults", error, {
      errorType: "MediaProcessingConfigError",
    });
  }
}
