/**
 * Voice sample storage utilities.
 *
 * Production stores samples in GCS (if VOICE_SAMPLE_GCS_BUCKET is set) or S3 (if VOICE_SAMPLE_S3_BUCKET is set).
 * Non-production stores samples on the local filesystem under data/voice-samples.
 */

import { Storage } from "@google-cloud/storage";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { promises as fs } from "node:fs";
import path from "node:path";
import { safeDownload } from "@/utils/security/safeDownload";
import { extractCloudObjectKeyFromUrl } from "@/utils/storage/cloudObjectStorage";
import { log } from "@/utils/misc/logger";

type VoiceSampleStoreOptions = {
  serverId: number;
  sampleId: number;
  buffer: Buffer;
};

type VoiceSampleStorageConfig =
  | { backend: "gcs"; bucket: string; prefix: string; publicBaseUrl: string }
  | { backend: "s3"; bucket: string; prefix: string; publicBaseUrl: string; region: string; endpoint?: string };

const IS_PRODUCTION = process.env.RUN_ENV === "production";
const LOCAL_VOICE_SAMPLE_BASE_DIR = path.resolve(process.cwd(), "data", "voice-samples");
const LOCAL_VOICE_SAMPLE_ROOT_PREFIX = "data/voice-samples/";
const SPEECH_SAMPLE_MAX_MB = Math.max(1, Number.parseInt(process.env.SPEECH_SAMPLE_MAX_MB ?? "10", 10) || 10);
let cachedGcsStorage: Storage | null = null;
let cachedS3Client: S3Client | null = null;
let cachedS3Region: string | null = null;
let cachedS3Endpoint: string | undefined;

function getVoiceSampleStorageConfig(): VoiceSampleStorageConfig | null {
  if (!IS_PRODUCTION) {
    return null;
  }

  // GCS takes priority when VOICE_SAMPLE_GCS_BUCKET is set
  const gcsBucket = process.env.VOICE_SAMPLE_GCS_BUCKET?.trim();
  if (gcsBucket) {
    const prefix = (process.env.VOICE_SAMPLE_GCS_PREFIX || "voice-samples").replace(/^\/+/, "").replace(/\/+$/, "");
    const publicBaseUrl =
      process.env.VOICE_SAMPLE_PUBLIC_BASE_URL?.trim() || `https://storage.googleapis.com/${gcsBucket}`;
    return { backend: "gcs", bucket: gcsBucket, prefix, publicBaseUrl };
  }

  // S3 fallback
  const s3Bucket = process.env.VOICE_SAMPLE_S3_BUCKET?.trim();
  if (!s3Bucket) {
    log.warn(
      "[Voice Sample Storage] Neither VOICE_SAMPLE_GCS_BUCKET nor VOICE_SAMPLE_S3_BUCKET is set; falling back to local storage.",
    );
    return null;
  }

  const region =
    process.env.VOICE_SAMPLE_S3_REGION?.trim() ||
    process.env.AVATAR_S3_REGION?.trim() ||
    process.env.AWS_REGION?.trim() ||
    "us-east-1";
  const endpoint = process.env.S3_ENDPOINT?.trim() || undefined;
  const prefix = (process.env.VOICE_SAMPLE_S3_PREFIX || "voice-samples").replace(/^\/+/, "").replace(/\/+$/, "");
  const publicBaseUrl =
    process.env.VOICE_SAMPLE_PUBLIC_BASE_URL?.trim() || `https://${s3Bucket}.s3.${region}.amazonaws.com`;

  return { backend: "s3", bucket: s3Bucket, prefix, publicBaseUrl, region, endpoint };
}

function getGcsStorage(): Storage {
  if (!cachedGcsStorage) {
    cachedGcsStorage = new Storage();
  }
  return cachedGcsStorage;
}

function getS3Client(region: string, endpoint?: string): S3Client {
  if (!cachedS3Client || cachedS3Region !== region || cachedS3Endpoint !== endpoint) {
    cachedS3Region = region;
    cachedS3Endpoint = endpoint;
    cachedS3Client = new S3Client({
      region,
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
  }
  return cachedS3Client;
}

function buildVoiceSampleObjectKey(config: VoiceSampleStorageConfig, options: VoiceSampleStoreOptions): string {
  return `${config.prefix}/servers/${options.serverId}/samples/${options.sampleId}.wav`;
}

function buildPublicUrl(config: VoiceSampleStorageConfig, key: string): string {
  const baseUrl = config.publicBaseUrl.replace(/\/+$/, "");
  return `${baseUrl}/${key}`;
}

function buildLocalStoredPath(options: VoiceSampleStoreOptions): string {
  return path.posix.join("data", "voice-samples", String(options.serverId), `${options.sampleId}.wav`);
}

function normalizeStoredPath(storedPath: string): string {
  return storedPath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function resolveLocalVoiceSamplePath(reference: string): string | null {
  const normalizedPath = normalizeStoredPath(reference);
  const pathFromCwd = normalizedPath.startsWith(LOCAL_VOICE_SAMPLE_ROOT_PREFIX)
    ? normalizedPath
    : path.posix.join(LOCAL_VOICE_SAMPLE_ROOT_PREFIX, normalizedPath);
  const resolvedPath = path.resolve(process.cwd(), pathFromCwd);
  const relativePath = path.relative(LOCAL_VOICE_SAMPLE_BASE_DIR, resolvedPath);

  if (relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))) {
    return resolvedPath;
  }

  log.warn(`[Voice Sample Storage] Rejected path outside data/voice-samples: ${reference}`);
  return null;
}

function extractKeyFromVoiceSampleUrl(config: VoiceSampleStorageConfig, url: string): string | null {
  return extractCloudObjectKeyFromUrl(config, url);
}

async function storeVoiceSampleLocally(options: VoiceSampleStoreOptions): Promise<string | null> {
  const storedPath = buildLocalStoredPath(options);
  const absolutePath = resolveLocalVoiceSamplePath(storedPath);
  if (!absolutePath) {
    return null;
  }

  try {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, options.buffer);
    log.success(`[Voice Sample Storage] Stored voice sample at ${storedPath}`);
    return normalizeStoredPath(storedPath);
  } catch (error) {
    log.warn(`[Voice Sample Storage] Failed to store voice sample locally`, error);
    return null;
  }
}

export async function storeVoiceSample(options: VoiceSampleStoreOptions): Promise<string | null> {
  if (IS_PRODUCTION) {
    const config = getVoiceSampleStorageConfig();
    if (config) {
      const key = buildVoiceSampleObjectKey(config, options);

      if (config.backend === "gcs") {
        try {
          await getGcsStorage()
            .bucket(config.bucket)
            .file(key)
            .save(options.buffer, {
              contentType: "audio/wav",
              metadata: { cacheControl: "public, max-age=31536000, immutable" },
            });
          const publicUrl = buildPublicUrl(config, key);
          log.success(`[Voice Sample Storage] Uploaded voice sample to GCS (${publicUrl})`);
          return publicUrl;
        } catch (error) {
          await log.error("[Voice Sample Storage] Failed to upload voice sample to GCS", error, {
            errorType: "GcsUploadError",
            metadata: { bucket: config.bucket, key },
          });
          return null;
        }
      }

      // S3 path
      try {
        await getS3Client(config.region, config.endpoint).send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: options.buffer,
            ContentType: "audio/wav",
            CacheControl: "public, max-age=31536000, immutable",
          }),
        );
        const publicUrl = buildPublicUrl(config, key);
        log.success(`[Voice Sample Storage] Uploaded voice sample to S3 (${publicUrl})`);
        return publicUrl;
      } catch (error) {
        await log.error("[Voice Sample Storage] Failed to upload voice sample to S3", error, {
          errorType: "S3UploadError",
          metadata: { bucket: config.bucket, key },
        });
        return null;
      }
    }
  }

  return storeVoiceSampleLocally(options);
}

export async function loadStoredVoiceSampleBuffer(reference: string, signal?: AbortSignal): Promise<Buffer | null> {
  signal?.throwIfAborted();
  const trimmedReference = reference.trim();
  if (!trimmedReference) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmedReference)) {
    const downloadResult = await safeDownload(trimmedReference, {
      maxSizeMB: SPEECH_SAMPLE_MAX_MB,
      timeoutMs: 30_000,
      externalSignal: signal,
    });

    if (!downloadResult.success || !downloadResult.buffer) {
      return null;
    }

    return downloadResult.buffer;
  }

  const absolutePath = resolveLocalVoiceSamplePath(trimmedReference);
  if (!absolutePath) {
    return null;
  }

  try {
    const stat = await fs.stat(absolutePath);
    if (stat.size > SPEECH_SAMPLE_MAX_MB * 1024 * 1024) return null;
    return await fs.readFile(absolutePath, { signal });
  } catch (error) {
    log.warn(`[Voice Sample Storage] Failed to load local voice sample ${trimmedReference}`, error);
    return null;
  }
}

export async function deleteStoredVoiceSample(reference: string): Promise<boolean> {
  const target = reference.trim();
  if (!target) {
    return false;
  }

  if (/^https?:\/\//i.test(target)) {
    if (!IS_PRODUCTION) {
      return false;
    }

    const config = getVoiceSampleStorageConfig();
    if (!config) {
      return false;
    }

    const key = extractKeyFromVoiceSampleUrl(config, target);
    if (!key) {
      return false;
    }

    if (config.backend === "gcs") {
      try {
        await getGcsStorage().bucket(config.bucket).file(key).delete();
        log.info(`[Voice Sample Storage] Deleted voice sample object ${key} from GCS`);
        return true;
      } catch (error) {
        await log.error(`[Voice Sample Storage] Failed to delete voice sample object ${key} from GCS`, error, {
          errorType: "GcsDeleteError",
          metadata: { bucket: config.bucket, key },
        });
        return false;
      }
    }

    // S3 path
    try {
      await getS3Client(config.region, config.endpoint).send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: key,
        }),
      );
      log.info(`[Voice Sample Storage] Deleted voice sample object ${key} from S3`);
      return true;
    } catch (error) {
      await log.error(`[Voice Sample Storage] Failed to delete voice sample object ${key} from S3`, error, {
        errorType: "S3DeleteError",
        metadata: { bucket: config.bucket, key },
      });
      return false;
    }
  }

  const absolutePath = resolveLocalVoiceSamplePath(target);
  if (!absolutePath) {
    return false;
  }

  try {
    await fs.unlink(absolutePath);
    log.info(`[Voice Sample Storage] Deleted local voice sample ${normalizeStoredPath(target)}`);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }

    log.warn(`[Voice Sample Storage] Failed to delete local voice sample ${target}`, error);
    return false;
  }
}
