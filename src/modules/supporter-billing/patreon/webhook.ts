import { log } from "@/utils/misc/logger";
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
import type {
  PersistPatreonMemberStateOptions,
  PersistPatreonMemberStateResult,
} from "@/modules/supporter-billing/patreon/persistence";
import { getPatreonWebhookSecret } from "@/modules/supporter-billing/patreon/settings";
import {
  type PatreonWebhookHeaders,
  verifyPatreonWebhookSignature,
} from "@/modules/supporter-billing/patreon/webhookVerifier";

type EnvRecord = Readonly<Record<string, string | undefined>>;

export type PatreonWebhookHandlingStatus =
  | "processed"
  | "duplicate"
  | "ignored"
  | "invalid_signature"
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
  fetchMember?: () => Promise<unknown | null>;
}

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
  const verification = verifyPatreonWebhookSignature({ rawBody, headers, webhookSecret });
  if (!verification.valid) return makeWebhookResponse("invalid_signature", 401);

  const payloadHash = hashWebhookPayload(rawBody);
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(rawBody).toString("utf8"));
  } catch {
    const repositories = options.repositories ?? {
      identityRepository: supporterIdentityRepository,
      webhookEventRepository: supporterWebhookEventRepository,
    };
    const eventType = "member_change";
    const receipt = await repositories.webhookEventRepository.recordReceiptForProcessing({
      patreonEventId: null,
      eventType,
      idempotencyKey: `payload:${payloadHash}`,
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
  const receipt = await repositories.webhookEventRepository.recordReceiptForProcessing({
    patreonEventId: null,
    eventType: "member_change",
    idempotencyKey: `payload:${payloadHash}`,
    payloadHash,
    receivedAt: now,
  });
  const memberMapping = mapPatreonMemberPayloadToSupporterState({
    config: options.config,
    memberResponse: payload,
    now,
    fallbackHours: options.fallbackHours ?? 24,
  });

  if (!memberMapping.valid) {
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
    await repositories.webhookEventRepository.markProcessed(
      receipt.event.webhook_event_id,
      "ignored",
      "unlinked_membership",
      now,
    );
    return makeWebhookResponse("ignored", 202);
  }

  try {
    await refreshPatreonEntitlementForIdentity({
      config: options.config,
      identity,
      env,
      now,
      source: "webhook",
      fetchMember: options.fetchMember,
      persistMemberState: options.persistMemberState,
    });
    await repositories.webhookEventRepository.markProcessed(receipt.event.webhook_event_id, "processed", null, now);
    return makeWebhookResponse(receipt.status === "duplicate" ? "duplicate" : "processed", 200);
  } catch {
    log.warn("Patreon webhook current-state refresh failed", {
      metadata: { receiptId: receipt.event.webhook_event_id },
    });
    await repositories.webhookEventRepository.markProcessed(
      receipt.event.webhook_event_id,
      "failed",
      "Patreon webhook side effects failed",
      now,
    );
    return makeWebhookResponse("server_error", 500);
  }
}
