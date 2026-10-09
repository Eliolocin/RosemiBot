import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Storage } from "@google-cloud/storage";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { CustomExpressionMedia } from "@/types/db/schema";
import { extractCloudObjectKeyFromUrl, type CloudObjectStorageConfig } from "@/utils/storage/cloudObjectStorage";
import { log } from "@/utils/misc/logger";

const STORAGE_PREFIX = "custom-expressions";
const LOCAL_ROOT = path.resolve(process.cwd(), "data", STORAGE_PREFIX);

function cloudConfig(): CloudObjectStorageConfig | null {
  const backend = process.env.EXPRESSION_STORAGE_BACKEND?.trim() || "local";
  if (backend === "local") return null;
  const bucket = process.env.EXPRESSION_STORAGE_BUCKET?.trim();
  if (!bucket) throw new Error("EXPRESSION_STORAGE_BUCKET is required for cloud expression storage");
  if (backend === "gcs") {
    return { backend, bucket, prefix: STORAGE_PREFIX, publicBaseUrl: `https://storage.googleapis.com/${bucket}` };
  }
  if (backend !== "s3") throw new Error("Unsupported EXPRESSION_STORAGE_BACKEND");
  const region = process.env.AWS_REGION?.trim() || "us-east-1";
  return {
    backend,
    bucket,
    prefix: STORAGE_PREFIX,
    region,
    endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
    publicBaseUrl: `https://${bucket}.s3.${region}.amazonaws.com`,
  };
}

function s3Client(config: Extract<CloudObjectStorageConfig, { backend: "s3" }>): S3Client {
  return new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
  });
}

function ownerPrefix(serverId: number, id: string): string {
  if (!Number.isSafeInteger(serverId) || serverId < 1 || !/^[0-9a-f-]{36}$/u.test(id))
    throw new Error("Invalid expression storage scope");
  return `${STORAGE_PREFIX}/${serverId}/${id}/`;
}

function ownedKey(reference: string, serverId: number, id: string, config: CloudObjectStorageConfig | null): string {
  const key = config ? extractCloudObjectKeyFromUrl(config, reference) : reference;
  if (
    !key?.startsWith(ownerPrefix(serverId, id)) ||
    !/^[0-9a-f-]{36}\.(png|jpe?g|webp|gif|mp4)$/u.test(key.slice(ownerPrefix(serverId, id).length))
  ) {
    throw new Error("Expression media reference is outside its owner");
  }
  return key;
}

function localPath(key: string): string {
  return path.join(LOCAL_ROOT, key.slice(STORAGE_PREFIX.length + 1));
}

export async function storeExpressionMedia(
  serverId: number,
  id: string,
  buffer: Buffer,
  mimeType: string,
  extension: NonNullable<CustomExpressionMedia["extension"]>,
): Promise<string> {
  const key = `${ownerPrefix(serverId, id)}${randomUUID()}.${extension}`;
  const config = cloudConfig();
  const reference = config ? `${config.publicBaseUrl}/${key}` : key;
  try {
    if (!config) {
      const target = localPath(key);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, buffer, { flag: "wx" });
    } else if (config.backend === "gcs") {
      await new Storage().bucket(config.bucket).file(key).save(buffer, { contentType: mimeType, resumable: false });
    } else {
      await s3Client(config).send(
        new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: buffer, ContentType: mimeType }),
      );
    }
  } catch (error) {
    await deleteExpressionMedia(reference, serverId, id);
    throw error;
  }
  return reference;
}

export async function loadExpressionMedia(reference: string, serverId: number, id: string): Promise<Buffer> {
  const config = cloudConfig();
  const key = ownedKey(reference, serverId, id, config);
  if (!config) return fs.readFile(localPath(key));
  if (config.backend === "gcs") {
    const [buffer] = await new Storage().bucket(config.bucket).file(key).download();
    return buffer;
  }
  const result = await s3Client(config).send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
  if (!result.Body) throw new Error("Stored expression media is missing");
  return Buffer.from(await result.Body.transformToByteArray());
}

export async function deleteExpressionMedia(reference: string, serverId: number, id: string): Promise<void> {
  let key: string | undefined;
  try {
    const config = cloudConfig();
    key = ownedKey(reference, serverId, id, config);
    if (!config) await fs.rm(localPath(key), { force: true });
    else if (config.backend === "gcs")
      await new Storage().bucket(config.bucket).file(key).delete({ ignoreNotFound: true });
    else await s3Client(config).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  } catch (error) {
    log.warn("Expression media cleanup failed", {
      metadata: {
        serverId,
        expressionId: id,
        objectKey: key,
        errorType: error instanceof Error ? error.name : "unknown",
      },
    });
  }
}
