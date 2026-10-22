import { createHmac, timingSafeEqual } from "node:crypto";

export type PatreonWebhookHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

export type PatreonWebhookVerificationResult =
  | {
      valid: true;
      timestamp: Date | null;
    }
  | {
      valid: false;
      reason: "missing_signature" | "invalid_signature" | "invalid_timestamp" | "stale_timestamp";
    };

const PATREON_SIGNATURE_HEADER = "x-patreon-signature";
const PATREON_TIMESTAMP_HEADERS = [
  "x-patreon-timestamp",
  "x-patreon-request-timestamp",
  "x-patreon-delivery-timestamp",
] as const;
const HEX_MD5_LENGTH = 32;

export function getPatreonHeaderValue(headers: PatreonWebhookHeaders, headerName: string): string | null {
  const headerNameLower = headerName.toLowerCase();
  const directValue = headers[headerName] ?? headers[headerNameLower];
  const value =
    directValue ?? Object.entries(headers).find(([key]) => key.toLowerCase() === headerNameLower)?.[1] ?? null;

  if (!value) {
    return null;
  }

  if (typeof value !== "string") {
    return value[0]?.trim() || null;
  }

  return value.trim() || null;
}

export function computePatreonWebhookSignature(rawBody: Uint8Array, webhookSecret: string): string {
  return createHmac("md5", webhookSecret).update(rawBody).digest("hex");
}

function parsePatreonWebhookTimestamp(rawTimestamp: string): Date | null {
  if (/^\d+$/.test(rawTimestamp)) {
    const parsedNumber = Number.parseInt(rawTimestamp, 10);
    if (!Number.isSafeInteger(parsedNumber) || parsedNumber <= 0) {
      return null;
    }

    const timestampMillis = parsedNumber > 9_999_999_999 ? parsedNumber : parsedNumber * 1000;
    const timestampDate = new Date(timestampMillis);
    return Number.isNaN(timestampDate.getTime()) ? null : timestampDate;
  }

  const parsedDate = new Date(rawTimestamp);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function extractPatreonWebhookTimestamp(headers: PatreonWebhookHeaders): Date | null | "invalid" {
  for (const headerName of PATREON_TIMESTAMP_HEADERS) {
    const headerValue = getPatreonHeaderValue(headers, headerName);
    if (!headerValue) {
      continue;
    }

    return parsePatreonWebhookTimestamp(headerValue) ?? "invalid";
  }

  return null;
}

function signaturesMatch(expectedHex: string, suppliedHex: string): boolean {
  if (!/^[a-f0-9]+$/i.test(suppliedHex) || suppliedHex.length !== HEX_MD5_LENGTH) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedHex, "hex");
  const suppliedBuffer = Buffer.from(suppliedHex, "hex");
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export function verifyPatreonWebhookSignature(params: {
  rawBody: Uint8Array;
  headers: PatreonWebhookHeaders;
  webhookSecret: string;
  now: Date;
  timestampToleranceSeconds: number;
}): PatreonWebhookVerificationResult {
  const suppliedSignature = getPatreonHeaderValue(params.headers, PATREON_SIGNATURE_HEADER);
  if (!suppliedSignature) {
    return { valid: false, reason: "missing_signature" };
  }

  const expectedSignature = computePatreonWebhookSignature(params.rawBody, params.webhookSecret);
  if (!signaturesMatch(expectedSignature, suppliedSignature.toLowerCase())) {
    return { valid: false, reason: "invalid_signature" };
  }

  const timestamp = extractPatreonWebhookTimestamp(params.headers);
  if (timestamp === "invalid") {
    return { valid: false, reason: "invalid_timestamp" };
  }

  if (timestamp) {
    const ageMillis = Math.abs(params.now.getTime() - timestamp.getTime());
    if (ageMillis > params.timestampToleranceSeconds * 1000) {
      return { valid: false, reason: "stale_timestamp" };
    }
  }

  return {
    valid: true,
    timestamp,
  };
}
