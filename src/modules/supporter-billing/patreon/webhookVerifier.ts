import { createHmac, timingSafeEqual } from "node:crypto";

export type PatreonWebhookHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

export type PatreonWebhookVerificationResult =
  | {
      valid: true;
    }
  | {
      valid: false;
      reason: "missing_signature" | "invalid_signature";
    };

const PATREON_SIGNATURE_HEADER = "x-patreon-signature";
const HEX_MD5_LENGTH = 32;

function getPatreonHeaderValue(headers: PatreonWebhookHeaders, headerName: string): string | null {
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
}): PatreonWebhookVerificationResult {
  const suppliedSignature = getPatreonHeaderValue(params.headers, PATREON_SIGNATURE_HEADER);
  if (!suppliedSignature) {
    return { valid: false, reason: "missing_signature" };
  }

  const expectedSignature = computePatreonWebhookSignature(params.rawBody, params.webhookSecret);
  if (!signaturesMatch(expectedSignature, suppliedSignature.toLowerCase())) {
    return { valid: false, reason: "invalid_signature" };
  }

  return { valid: true };
}
