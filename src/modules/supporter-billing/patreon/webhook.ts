import { createHash } from "node:crypto";
import type { SupporterBillingConfig } from "@/modules/supporter-billing/config";
import {
  supporterIdentityRepository,
  supporterWebhookEventRepository,
  type SupporterIdentityRepository,
  type SupporterWebhookEventRepository,
  type SupporterIdentityRow,
} from "@/modules/supporter-billing/db";
import { mapPatreonMemberPayloadToSupporterState } from "@/modules/supporter-billing/patreon/mapping";
import { refreshPatreonEntitlementForIdentity } from "@/modules/supporter-billing/patreon/reconcile";
import { log } from "@/utils/misc/logger";
import {
  type PersistPatreonMemberStateOptions,
  type PersistPatreonMemberStateResult,
  persistPatreonMemberState,
} from "@/modules/supporter-billing/patreon/persistence";
import {
  getPatreonUsagePeriodFallbackHours,
  getPatreonWebhookSecret,
  getPatreonWebhookTimestampToleranceSeconds,
} from "@/modules/supporter-billing/patreon/settings";
import {
  getPatreonHeaderValue,
  type PatreonWebhookHeaders,
  verifyPatreonWebhookSignature,
} from "@/modules/supporter-billing/patreon/webhookVerifier";

type EnvRecord = Readonly<Record<string, string | undefined>>;

export type PatreonWebhookHandlingStatus =
  | "processed"
  | "duplicate"
  | "ignored"
  | "invalid_signature"
  | "stale_timestamp"
  | "malformed"
  | "server_error";

export interface PatreonWebhookHandlingResponse {
  status: PatreonWebhookHandlingStatus;
  statusCode: number;
  body: string;
}

export interface PatreonWebhookRepositories {
  identityRepository: Pick<SupporterIdentityRepository, "loadByPatreonMemberId" | "loadByPatreonUserIdAndCampaignId">;
  webhookEventRepository: Pick<SupporterWebhookEventRepository, "markProcessed" | "recordReceiptForProcessing">;
}

export interface HandlePatreonWebhookOptions {
  config: SupporterBillingConfig;
  env?: EnvRecord;
  now?: Date;
  fallbackHours?: number;
  repositories?: PatreonWebhookRepositories;
  persistMemberState?: (options: PersistPatreonMemberStateOptions) => Promise<PersistPatreonMemberStateResult>;
  fetchCampaignMembers?: () => Promise<unknown[]>;
}

const SUPPORTED_PATREON_MEMBER_EVENTS = new Set([
  "members:create",
  "members:update",
  "members:delete",
  "members:pledge:create",
  "members:pledge:update",
  "members:pledge:delete",
]);

const PATREON_EVENT_HEADER = "x-patreon-event";
const PATREON_EVENT_ID_HEADERS = ["x-patreon-event-id", "x-patreon-delivery", "x-patreon-webhook-event-id"] as const;

function makeWebhookResponse(status: PatreonWebhookHandlingStatus, statusCode: number): PatreonWebhookHandlingResponse {
  return {
    status,
    statusCode,
    body: status,
  };
}

function hashWebhookPayload(rawBody: Uint8Array): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

function getEventType(headers: PatreonWebhookHeaders, payload: unknown = null): string {
  const headerEventType = getPatreonHeaderValue(headers, PATREON_EVENT_HEADER);
  if (headerEventType) {
    return headerEventType;
  }

  if (typeof payload === "object" && payload !== null && "event_type" in payload) {
    const eventType = (payload as { event_type?: unknown }).event_type;
    return typeof eventType === "string" && eventType.trim() ? eventType.trim() : "unknown";
  }

  return "unknown";
}

function getTopLevelStringProperty(payload: unknown, propertyName: string): string | null {
  if (typeof payload !== "object" || payload === null || !(propertyName in payload)) {
    return null;
  }

  const value = (payload as Record<string, unknown>)[propertyName];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function extractPatreonEventId(headers: PatreonWebhookHeaders, payload: unknown): string | null {
  for (const headerName of PATREON_EVENT_ID_HEADERS) {
    const headerValue = getPatreonHeaderValue(headers, headerName);
    if (headerValue) {
      return headerValue;
    }
  }

  return (
    getTopLevelStringProperty(payload, "event_id") ??
    getTopLevelStringProperty(payload, "webhook_event_id") ??
    getTopLevelStringProperty(payload, "id")
  );
}

function makeWebhookIdempotencyKey(patreonEventId: string | null, eventType: string, payloadHash: string): string {
  return patreonEventId ? `event:${patreonEventId}` : `payload:${eventType}:${payloadHash}`;
}

async function resolveLinkedIdentity(
  snapshot: {
    patreonMemberId: string;
    patreonUserId: string;
    patreonCampaignId: string;
  },
  identityRepository: PatreonWebhookRepositories["identityRepository"],
): Promise<SupporterIdentityRow | null> {
  const identityByMember = await identityRepository.loadByPatreonMemberId(snapshot.patreonMemberId);
  if (identityByMember) {
    return identityByMember;
  }

  return await identityRepository.loadByPatreonUserIdAndCampaignId(snapshot.patreonUserId, snapshot.patreonCampaignId);
}

export async function handlePatreonWebhookRawBody(
  rawBody: Uint8Array,
  headers: PatreonWebhookHeaders,
  options: HandlePatreonWebhookOptions,
): Promise<PatreonWebhookHandlingResponse> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const webhookSecret = getPatreonWebhookSecret(options.config, env);
  const verification = verifyPatreonWebhookSignature({
    rawBody,
    headers,
    webhookSecret,
    now,
    timestampToleranceSeconds: getPatreonWebhookTimestampToleranceSeconds(env),
  });

  if (!verification.valid) {
    if (verification.reason === "stale_timestamp" || verification.reason === "invalid_timestamp") {
      return makeWebhookResponse("stale_timestamp", 401);
    }

    return makeWebhookResponse("invalid_signature", 401);
  }

  const payloadHash = hashWebhookPayload(rawBody);
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(rawBody).toString("utf8"));
  } catch {
    const repositories = options.repositories ?? {
      identityRepository: supporterIdentityRepository,
      webhookEventRepository: supporterWebhookEventRepository,
    };
    const eventType = getEventType(headers);
    const receipt = await repositories.webhookEventRepository.recordReceiptForProcessing({
      patreonEventId: null,
      eventType,
      idempotencyKey: makeWebhookIdempotencyKey(null, eventType, payloadHash),
      payloadHash,
      receivedAt: now,
    });
    if (receipt.status === "duplicate" && receipt.event.status !== "failed" && receipt.event.status !== "received") {
      return makeWebhookResponse("duplicate", 200);
    }
    await repositories.webhookEventRepository.markProcessed(
      receipt.event.webhook_event_id,
      "failed",
      "Malformed Patreon webhook JSON",
      now,
    );
    return makeWebhookResponse("malformed", 400);
  }

  const repositories = options.repositories ?? {
    identityRepository: supporterIdentityRepository,
    webhookEventRepository: supporterWebhookEventRepository,
  };
  const eventType = getEventType(headers, payload);
  const patreonEventId = extractPatreonEventId(headers, payload);
  const idempotencyKey = makeWebhookIdempotencyKey(patreonEventId, eventType, payloadHash);
  const receipt = await repositories.webhookEventRepository.recordReceiptForProcessing({
    patreonEventId,
    eventType,
    idempotencyKey,
    payloadHash,
    receivedAt: now,
  });

  const refreshDuplicate = receipt.status === "duplicate" && receipt.event.status === "processed" && !patreonEventId;
  if (
    receipt.status === "duplicate" &&
    receipt.event.status !== "failed" &&
    receipt.event.status !== "received" &&
    !refreshDuplicate
  ) {
    return makeWebhookResponse("duplicate", 200);
  }

  if (!SUPPORTED_PATREON_MEMBER_EVENTS.has(eventType)) {
    await repositories.webhookEventRepository.markProcessed(receipt.event.webhook_event_id, "ignored", null, now);
    return makeWebhookResponse("ignored", 202);
  }

  const memberMapping = mapPatreonMemberPayloadToSupporterState({
    config: options.config,
    memberResponse: payload,
    now,
    fallbackHours: options.fallbackHours ?? getPatreonUsagePeriodFallbackHours(env),
    forceInactiveReason: eventType === "members:delete" ? "deleted" : undefined,
    cancelAtPeriodEnd: eventType === "members:pledge:delete" ? true : undefined,
  });

  if (!memberMapping.valid) {
    if (refreshDuplicate) return makeWebhookResponse("duplicate", 200);
    const status = memberMapping.reason === "wrong_campaign" ? "ignored" : "failed";
    await repositories.webhookEventRepository.markProcessed(
      receipt.event.webhook_event_id,
      status,
      memberMapping.reason,
      now,
    );
    return makeWebhookResponse(
      memberMapping.reason === "wrong_campaign" ? "ignored" : "malformed",
      memberMapping.reason === "wrong_campaign" ? 202 : 400,
    );
  }

  const identity = await resolveLinkedIdentity(memberMapping.snapshot, repositories.identityRepository);
  if (!identity) {
    if (refreshDuplicate) return makeWebhookResponse("duplicate", 200);
    await repositories.webhookEventRepository.markProcessed(
      receipt.event.webhook_event_id,
      "ignored",
      "unlinked_membership",
      now,
    );
    return makeWebhookResponse("ignored", 202);
  }

  if (refreshDuplicate) {
    // Patreon can reuse a body after an intervening membership change, so fallback duplicates require current state.
    try {
      await refreshPatreonEntitlementForIdentity({
        config: options.config,
        identity,
        env,
        now,
        fetchCampaignMembers: options.fetchCampaignMembers,
        persistMemberState: options.persistMemberState,
      });
      log.metric("supporter_webhook_fallback_refresh", {
        receiptId: receipt.event.webhook_event_id,
        result: "refreshed",
      });
      return makeWebhookResponse("duplicate", 200);
    } catch {
      log.metric("supporter_webhook_fallback_refresh", { receiptId: receipt.event.webhook_event_id, result: "failed" });
      return makeWebhookResponse("server_error", 500);
    }
  }

  try {
    await (options.persistMemberState ?? persistPatreonMemberState)({
      config: options.config,
      identity,
      snapshot: memberMapping.snapshot,
      source: "webhook",
      verifiedAt: now,
      env,
    });
    await repositories.webhookEventRepository.markProcessed(receipt.event.webhook_event_id, "processed", null, now);
    return makeWebhookResponse("processed", 200);
  } catch {
    await repositories.webhookEventRepository.markProcessed(
      receipt.event.webhook_event_id,
      "failed",
      "Patreon webhook side effects failed",
      now,
    );
    return makeWebhookResponse("server_error", 500);
  }
}
