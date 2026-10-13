import { isIP } from "node:net";
import type * as MatrixAppserviceBridge from "matrix-appservice-bridge";

export const MATRIX_TEXT_MSG_TYPE = "m.room" + ".message";
export const MATRIX_MEMBER_EVENT_TYPE = "m.room" + ".member";
export const MATRIX_ENCRYPTION_STATE_TYPE = "m.room" + ".encryption";
export const MATRIX_ENCRYPTED_EVENT_TYPE = "m.room" + ".encrypted";
export const MATRIX_LINK_CACHE_TTL_MS = 5 * 60_000;
export const MATRIX_TYPING_TIMEOUT_MS = 60000;
export const MATRIX_MAX_TRACKED_SENT_EVENTS = 500;

const BYTES_PER_MIB = 1024 * 1024;
const DEFAULT_APPSERVICE_PORT = 9993;
// Only the homeserver calls the listener, and it usually runs on the same host.
const DEFAULT_APPSERVICE_BIND_HOST = "127.0.0.1";
const DEFAULT_MAX_ATTACHMENT_MB = 8;
// Each relayed file is held whole in memory between download and upload.
const MAX_ATTACHMENT_MB_CEILING = 100;
const DEFAULT_MEDIA_TIMEOUT_MS = 15_000;
const MIN_MEDIA_TIMEOUT_MS = 1_000;
const MAX_MEDIA_TIMEOUT_MS = 120_000;
const BIND_HOSTNAME_PATTERN = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/;

/**
 * Deployment settings the bridge validates once at startup, so a malformed value disables the
 * bridge instead of turning a limit comparison into `NaN`.
 */
export interface MatrixSettings {
  port: number;
  bindHost: string;
  maxAttachmentBytes: number;
  mediaTimeoutMs: number;
}

export class MatrixConfigError extends Error {}

export type SentPersonaReplyEvent = {
  personaName: string;
  replySnippet?: string;
};

let matrixBridge: MatrixAppserviceBridge.Bridge | null = null;
let matrixSettings: MatrixSettings | null = null;

export const channelLinkCache = new Map<string, { roomId: string | null; cachedAt: number }>();
export const roomLinkCache = new Map<string, { channelDiscId: string | null; cachedAt: number }>();
export const unencryptedRoomCache = new Map<string, number>();
export const provisionedIntents = new Map<string, { avatarUrl: string | null }>();
export const ensuredRoomMemberships = new Set<string>();
export const sentEventPersonas = new Map<string, SentPersonaReplyEvent>();
export const matrixDisplayNameToId = new Map<string, string>();
export const pendingMatrixReplyChannels = new Set<string>();

export function getMatrixBridge(): MatrixAppserviceBridge.Bridge | null {
  return matrixBridge;
}

export function setMatrixBridge(bridge: MatrixAppserviceBridge.Bridge | null): void {
  matrixBridge = bridge;
}

/**
 * @throws {MatrixConfigError} Before startup has validated the settings. Every caller runs behind
 * the configured-bridge check, so reaching this means a new caller skipped that check.
 */
export function getMatrixSettings(): MatrixSettings {
  if (!matrixSettings) {
    throw new MatrixConfigError("Matrix settings are read before the bridge validated them");
  }
  return matrixSettings;
}

export function setMatrixSettings(settings: MatrixSettings | null): void {
  matrixSettings = settings;
}

function readNumberSetting(
  name: string,
  fallback: number,
  isAccepted: (value: number) => boolean,
  expectation: string,
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !isAccepted(parsed)) {
    throw new MatrixConfigError(`${name}="${raw}" must be ${expectation}`);
  }
  return parsed;
}

function readBindHost(): string {
  const raw = process.env.MATRIX_APPSERVICE_BIND_HOST?.trim();
  if (!raw) return DEFAULT_APPSERVICE_BIND_HOST;
  if (isIP(raw) === 0 && !BIND_HOSTNAME_PATTERN.test(raw)) {
    throw new MatrixConfigError(`MATRIX_APPSERVICE_BIND_HOST="${raw}" must be an IP address or hostname`);
  }
  return raw;
}

/**
 * @throws {MatrixConfigError} Naming the first malformed, non-positive, or out-of-range variable.
 */
export function parseMatrixSettings(): MatrixSettings {
  const port = readNumberSetting(
    "MATRIX_APPSERVICE_PORT",
    DEFAULT_APPSERVICE_PORT,
    (value) => Number.isInteger(value) && value >= 1 && value <= 65_535,
    "a whole number from 1 to 65535",
  );
  const maxAttachmentMb = readNumberSetting(
    "MATRIX_MAX_ATTACHMENT_MB",
    DEFAULT_MAX_ATTACHMENT_MB,
    (value) => value > 0 && value <= MAX_ATTACHMENT_MB_CEILING,
    `greater than 0 and at most ${MAX_ATTACHMENT_MB_CEILING}`,
  );
  const mediaTimeoutMs = readNumberSetting(
    "MATRIX_MEDIA_TIMEOUT_MS",
    DEFAULT_MEDIA_TIMEOUT_MS,
    (value) => Number.isInteger(value) && value >= MIN_MEDIA_TIMEOUT_MS && value <= MAX_MEDIA_TIMEOUT_MS,
    `a whole number from ${MIN_MEDIA_TIMEOUT_MS} to ${MAX_MEDIA_TIMEOUT_MS}`,
  );

  return {
    port,
    bindHost: readBindHost(),
    maxAttachmentBytes: Math.floor(maxAttachmentMb * BYTES_PER_MIB),
    mediaTimeoutMs,
  };
}
