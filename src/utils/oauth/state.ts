import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export interface OAuthStatePayload {
  v: 1;
  flow: string;
  subject: string;
  nonce: string;
  expiresAt: number;
  locale?: string;
}

export interface OAuthStateNonceRepository {
  recordStateNonce(params: {
    nonceHash: string;
    flow: string;
    subject: string;
    expiresAt: Date;
    createdAt?: Date;
  }): Promise<unknown>;
  consumeStateNonce(params: {
    nonceHash: string;
    flow: string;
    subject: string;
    consumedAt?: Date;
  }): Promise<unknown | null>;
}

type OAuthStateValidationFailureReason = "malformed" | "invalid_signature" | "expired";
type OAuthStateConsumptionFailureReason = OAuthStateValidationFailureReason | "replay";

export type OAuthStateValidationResult =
  | {
      valid: true;
      payload: OAuthStatePayload;
      nonceHash: string;
    }
  | {
      valid: false;
      reason: OAuthStateValidationFailureReason;
    };

export type OAuthStateConsumptionResult =
  | {
      valid: true;
      payload: OAuthStatePayload;
      nonceHash: string;
    }
  | {
      valid: false;
      reason: OAuthStateConsumptionFailureReason;
    };

export interface CreateOAuthStateOptions {
  flow: string;
  subject: string;
  signerSecret: string;
  ttlSeconds: number;
  locale?: string;
  now?: Date;
  nonce?: string;
}

export interface CreateAndPersistOAuthStateOptions extends CreateOAuthStateOptions {
  stateRepository: OAuthStateNonceRepository;
}

const oauthStateWireSchema = z
  .object({
    v: z.literal(1),
    flow: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
    s: z.string().trim().min(1),
    n: z.string().trim().min(16),
    e: z.number().int().positive(),
    l: z.string().trim().min(1).max(32).optional(),
  })
  .strict();

function normalizeLocale(locale: string | undefined): string | undefined {
  const trimmedLocale = locale?.trim();
  return trimmedLocale ? trimmedLocale.slice(0, 32) : undefined;
}

function encodeBase64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64UrlToString(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signStatePayload(encodedPayload: string, signerSecret: string): string {
  return createHmac("sha256", signerSecret).update(encodedPayload).digest("base64url");
}

function signaturesMatch(actualSignature: string, expectedSignature: string): boolean {
  try {
    const actualBuffer = Buffer.from(actualSignature, "base64url");
    const expectedBuffer = Buffer.from(expectedSignature, "base64url");
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

export function hashOAuthNonce(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

export function createSignedOAuthState(options: CreateOAuthStateOptions): {
  state: string;
  payload: OAuthStatePayload;
  nonceHash: string;
} {
  const now = options.now ?? new Date();
  const nonce = options.nonce ?? randomBytes(32).toString("base64url");
  const payload: OAuthStatePayload = {
    v: 1,
    flow: options.flow,
    subject: options.subject,
    nonce,
    expiresAt: now.getTime() + options.ttlSeconds * 1000,
  };
  const locale = normalizeLocale(options.locale);
  if (locale) {
    payload.locale = locale;
  }
  const encodedPayload = encodeBase64Url(
    JSON.stringify({
      v: payload.v,
      flow: payload.flow,
      s: payload.subject,
      n: payload.nonce,
      e: payload.expiresAt,
      l: payload.locale,
    }),
  );
  const signature = signStatePayload(encodedPayload, options.signerSecret);

  return {
    state: `${encodedPayload}.${signature}`,
    payload,
    nonceHash: hashOAuthNonce(nonce),
  };
}

export function validateSignedOAuthState(
  state: string,
  signerSecret: string,
  now: Date = new Date(),
  expectedFlow?: string,
): OAuthStateValidationResult {
  if (state.length > 4096) return { valid: false, reason: "malformed" };
  const [encodedPayload, signature, extraPart] = state.split(".");
  if (!encodedPayload || !signature || extraPart !== undefined) {
    return { valid: false, reason: "malformed" };
  }

  const expectedSignature = signStatePayload(encodedPayload, signerSecret);
  if (!signaturesMatch(signature, expectedSignature)) {
    return { valid: false, reason: "invalid_signature" };
  }

  let parsedPayload: OAuthStatePayload;
  try {
    const wire = oauthStateWireSchema.parse(JSON.parse(decodeBase64UrlToString(encodedPayload)));
    parsedPayload = {
      v: wire.v,
      flow: wire.flow,
      subject: wire.s,
      nonce: wire.n,
      expiresAt: wire.e,
      ...(wire.l ? { locale: wire.l } : {}),
    };
  } catch {
    return { valid: false, reason: "malformed" };
  }

  if (expectedFlow !== undefined && parsedPayload.flow !== expectedFlow) {
    return { valid: false, reason: "malformed" };
  }

  if (parsedPayload.expiresAt <= now.getTime()) {
    return { valid: false, reason: "expired" };
  }

  return {
    valid: true,
    payload: parsedPayload,
    nonceHash: hashOAuthNonce(parsedPayload.nonce),
  };
}

export async function createAndPersistOAuthState(options: CreateAndPersistOAuthStateOptions): Promise<{
  state: string;
  payload: OAuthStatePayload;
  nonceHash: string;
}> {
  const created = createSignedOAuthState(options);
  const createdAt = options.now ?? new Date();

  await options.stateRepository.recordStateNonce({
    nonceHash: created.nonceHash,
    subject: created.payload.subject,
    flow: created.payload.flow,
    expiresAt: new Date(created.payload.expiresAt),
    createdAt,
  });

  return created;
}

export async function validateAndConsumeOAuthState(
  state: string,
  signerSecret: string,
  stateRepository: OAuthStateNonceRepository,
  now: Date = new Date(),
  expectedFlow?: string,
): Promise<OAuthStateConsumptionResult> {
  const validation = validateSignedOAuthState(state, signerSecret, now, expectedFlow);
  if (!validation.valid) {
    return validation;
  }

  const consumedState = await stateRepository.consumeStateNonce({
    nonceHash: validation.nonceHash,
    subject: validation.payload.subject,
    flow: validation.payload.flow,
    consumedAt: now,
  });

  if (!consumedState) {
    return { valid: false, reason: "replay" };
  }

  return validation;
}
