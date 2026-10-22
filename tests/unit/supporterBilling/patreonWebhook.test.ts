import { describe, expect, it, spyOn } from "bun:test";
import { log } from "@/utils/misc/logger";
import type {
  RecordWebhookEventParams,
  RecordWebhookEventReceiptResult,
  SupporterBillingConfig,
  SupporterEntitlementRow,
  SupporterIdentityRow,
  SupporterWebhookEventRow,
  SupporterWebhookEventStatus,
  UpsertSupporterEntitlementParams,
} from "@/modules/supporter-billing";
import type { PatreonMemberStateSnapshot } from "@/modules/supporter-billing/patreon/mapping";
import { mapPatreonMemberPayloadToSupporterState } from "@/modules/supporter-billing/patreon/mapping";
import { persistPatreonMemberState } from "@/modules/supporter-billing/patreon/persistence";
import {
  runPatreonEntitlementReconcile,
  refreshPatreonEntitlementForIdentity,
  startPatreonReconcileJob,
  type PatreonReconcileResult,
} from "@/modules/supporter-billing/patreon/reconcile";
import {
  handlePatreonWebhookRawBody,
  type HandlePatreonWebhookOptions,
} from "@/modules/supporter-billing/patreon/webhook";
import {
  computePatreonWebhookSignature,
  type PatreonWebhookHeaders,
  verifyPatreonWebhookSignature,
} from "@/modules/supporter-billing/patreon/webhookVerifier";

const now = new Date("2026-01-15T00:00:00.000Z");
const webhookSecret = "test-patreon-webhook-secret";

const validSupporterConfig: SupporterBillingConfig = {
  patreon: {
    campaignId: "campaign_test",
    oauthClientIdEnv: "TOMORI_SUPPORTER_PATREON_CLIENT_ID",
    oauthClientSecretEnv: "TOMORI_SUPPORTER_PATREON_CLIENT_SECRET",
    webhookSecretEnv: "TOMORI_SUPPORTER_PATREON_WEBHOOK_SECRET",
    creatorRefreshTokenEnv: "TOMORI_SUPPORTER_PATREON_CREATOR_REFRESH_TOKEN",
    manageUrl: "https://www.patreon.com/test",
  },
  jobs: {
    reconcileIntervalSeconds: 300,
    manualRefreshCooldownSeconds: 30,
  },
  tiers: {
    test_tier: {
      displayNameKey: "supporter.tiers.test",
      patreonTierIds: ["tier_test"],
      monthlyBudgetMicros: 100000,
      defaultModelByCapability: { text: "test/provider-model" },
    },
  },
};

const enabledEnv = {
  TOMORI_SUPPORTER_PATREON_WEBHOOK_SECRET: webhookSecret,
  TOMORI_SUPPORTER_PERIOD_FALLBACK_HOURS: "24",
};

function makeIdentity(overrides: Partial<SupporterIdentityRow> = {}): SupporterIdentityRow {
  return {
    supporter_identity_id: 10,
    discord_user_id: "discord_user_1",
    patreon_user_id: "patreon_user_test",
    patreon_member_id: "member_test",
    patreon_campaign_id: "campaign_test",
    linked_at: now,
    last_oauth_at: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeMemberPayload(
  overrides: {
    memberId?: string;
    userId?: string;
    campaignId?: string;
    patronStatus?: string | null;
    tierIds?: string[];
    lastChargeDate?: string | null;
    nextChargeDate?: string | null;
    lastChargeStatus?: string | null;
    willPayAmountCents?: number | null;
  } = {},
): unknown {
  const tierIds = overrides.tierIds ?? ["tier_test"];
  return {
    data: {
      id: overrides.memberId ?? "member_test",
      type: "member",
      attributes: {
        last_charge_status: overrides.lastChargeStatus,
        will_pay_amount_cents: overrides.willPayAmountCents,
        patron_status: overrides.patronStatus === undefined ? "active_patron" : overrides.patronStatus,
        last_charge_date:
          overrides.lastChargeDate === undefined ? "2026-01-01T00:00:00.000Z" : overrides.lastChargeDate,
        next_charge_date:
          overrides.nextChargeDate === undefined ? "2026-02-01T00:00:00.000Z" : overrides.nextChargeDate,
      },
      relationships: {
        campaign: {
          data: {
            id: overrides.campaignId ?? "campaign_test",
            type: "campaign",
          },
        },
        user: {
          data: {
            id: overrides.userId ?? "patreon_user_test",
            type: "user",
          },
        },
        currently_entitled_tiers: {
          data: tierIds.map((tierId) => ({ id: tierId, type: "tier" })),
        },
      },
    },
    included: [
      {
        id: overrides.campaignId ?? "campaign_test",
        type: "campaign",
      },
      {
        id: overrides.userId ?? "patreon_user_test",
        type: "user",
      },
      ...tierIds.map((tierId) => ({ id: tierId, type: "tier" })),
    ],
  };
}

function encodeJsonPayload(payload: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(payload), "utf8");
}

function signedHeaders(
  rawBody: Uint8Array,
  eventType: string,
  extra: PatreonWebhookHeaders = {},
): PatreonWebhookHeaders {
  return {
    "x-patreon-event": eventType,
    "x-patreon-signature": computePatreonWebhookSignature(rawBody, webhookSecret),
    ...extra,
  };
}

class MemoryWebhookEventRepository {
  public readonly rows = new Map<string, SupporterWebhookEventRow>();
  private nextId = 1;

  async recordReceiptForProcessing(params: RecordWebhookEventParams): Promise<RecordWebhookEventReceiptResult> {
    const existingRow = this.rows.get(params.idempotencyKey);
    if (existingRow) {
      return {
        status: "duplicate",
        event: existingRow,
      };
    }

    const row: SupporterWebhookEventRow = {
      webhook_event_id: this.nextId,
      patreon_event_id: params.patreonEventId,
      event_type: params.eventType,
      received_at: params.receivedAt ?? now,
      processed_at: null,
      status: params.status ?? "received",
      error_message: null,
      idempotency_key: params.idempotencyKey,
      payload_hash: params.payloadHash,
    };
    this.nextId += 1;
    this.rows.set(params.idempotencyKey, row);
    return {
      status: "recorded",
      event: row,
    };
  }

  async markProcessed(
    webhookEventId: number,
    status: Exclude<SupporterWebhookEventStatus, "received">,
    errorMessage: string | null,
    processedAt: Date,
  ): Promise<SupporterWebhookEventRow | null> {
    const matchingEntry = Array.from(this.rows.entries()).find(([, row]) => row.webhook_event_id === webhookEventId);
    if (!matchingEntry) {
      return null;
    }

    const [idempotencyKey, row] = matchingEntry;
    const updatedRow = {
      ...row,
      processed_at: processedAt,
      status,
      error_message: errorMessage,
    };
    this.rows.set(idempotencyKey, updatedRow);
    return updatedRow;
  }
}

class MemoryIdentityLookupRepository {
  public constructor(private readonly identities: SupporterIdentityRow[]) {}

  async loadByPatreonMemberId(patreonMemberId: string): Promise<SupporterIdentityRow | null> {
    return this.identities.find((identity) => identity.patreon_member_id === patreonMemberId) ?? null;
  }

  async loadByPatreonUserIdAndCampaignId(
    patreonUserId: string,
    patreonCampaignId: string,
  ): Promise<SupporterIdentityRow | null> {
    return (
      this.identities.find(
        (identity) => identity.patreon_user_id === patreonUserId && identity.patreon_campaign_id === patreonCampaignId,
      ) ?? null
    );
  }
}

class MemoryPatreonMemberStatePersistenceRepositories {
  public identity = makeIdentity();
  public entitlement: SupporterEntitlementRow | null = null;

  public readonly repositories = {
    identityRepository: {
      updatePatreonSnapshot: async (params: {
        supporterIdentityId: number;
        patreonUserId: string;
        patreonMemberId: string;
        patreonCampaignId: string;
      }) => {
        this.identity = {
          ...this.identity,
          supporter_identity_id: params.supporterIdentityId,
          patreon_user_id: params.patreonUserId,
          patreon_member_id: params.patreonMemberId,
          patreon_campaign_id: params.patreonCampaignId,
          updated_at: now,
        };
        return this.identity;
      },
    },
    entitlementRepository: {
      loadByIdentityId: async () => this.entitlement,
      upsertSnapshot: async (params: UpsertSupporterEntitlementParams) => {
        this.entitlement = {
          supporter_entitlement_id: 20,
          supporter_identity_id: params.supporterIdentityId,
          tier_key: params.tierKey,
          patreon_tier_id: params.patreonTierId,
          patron_status: params.patronStatus,
          is_active: params.isActive,
          cancel_at_period_end: params.cancelAtPeriodEnd ?? false,
          period_start: params.periodStart,
          period_end: params.periodEnd,
          last_verified_at: params.lastVerifiedAt,
          last_successful_charge_at: params.lastSuccessfulChargeAt ?? null,
          next_charge_at: params.nextChargeAt ?? null,
          source: params.source,
          created_at: now,
          updated_at: now,
        };
        return this.entitlement;
      },
    },
  };
}

describe("Patreon webhook signature verification", () => {
  it("verifies Patreon HMAC-MD5 signatures over the raw body", () => {
    const rawBody = encodeJsonPayload(makeMemberPayload());
    const signature = computePatreonWebhookSignature(rawBody, webhookSecret);

    expect(
      verifyPatreonWebhookSignature({
        rawBody,
        headers: { "x-patreon-signature": signature },
        webhookSecret,
        now,
        timestampToleranceSeconds: 300,
      }),
    ).toEqual({ valid: true, timestamp: null });
    expect(
      verifyPatreonWebhookSignature({
        rawBody,
        headers: { "x-patreon-signature": "0".repeat(32) },
        webhookSecret,
        now,
        timestampToleranceSeconds: 300,
      }),
    ).toEqual({ valid: false, reason: "invalid_signature" });
  });

  it("enforces freshness when Patreon supplies a timestamp header", () => {
    const rawBody = encodeJsonPayload(makeMemberPayload());
    const signature = computePatreonWebhookSignature(rawBody, webhookSecret);

    expect(
      verifyPatreonWebhookSignature({
        rawBody,
        headers: {
          "x-patreon-signature": signature,
          "x-patreon-timestamp": String(Math.floor(now.getTime() / 1000) - 301),
        },
        webhookSecret,
        now,
        timestampToleranceSeconds: 300,
      }),
    ).toEqual({ valid: false, reason: "stale_timestamp" });
  });
});

describe("Patreon webhook handling", () => {
  it("refreshes current membership when a fallback payload repeats after intervening changes", async () => {
    const canceledPayload = makeMemberPayload({ willPayAmountCents: 0 });
    const activePayload = makeMemberPayload({ willPayAmountCents: 100 });
    let currentPayload = canceledPayload;
    const rawBody = encodeJsonPayload(canceledPayload);
    const webhookRepository = new MemoryWebhookEventRepository();
    const memory = new MemoryPatreonMemberStatePersistenceRepositories();
    const persist = (options: Parameters<typeof persistPatreonMemberState>[0]) =>
      persistPatreonMemberState({ ...options, repositories: memory.repositories });
    const options = {
      config: validSupporterConfig,
      env: enabledEnv,
      now,
      repositories: {
        identityRepository: new MemoryIdentityLookupRepository([makeIdentity()]),
        webhookEventRepository: webhookRepository,
      },
      persistMemberState: persist,
      fetchCampaignMembers: async () => [currentPayload],
    };
    const deliver = (overrides: Partial<HandlePatreonWebhookOptions> = {}) =>
      handlePatreonWebhookRawBody(rawBody, signedHeaders(rawBody, "members:pledge:delete"), {
        ...options,
        ...overrides,
      });
    const refreshCurrent = () => refreshPatreonEntitlementForIdentity({ ...options, identity: makeIdentity() });

    expect((await deliver()).status).toBe("processed");
    expect(memory.entitlement?.cancel_at_period_end).toBe(true);
    currentPayload = activePayload;
    await refreshCurrent();
    expect(memory.entitlement?.cancel_at_period_end).toBe(false);

    currentPayload = canceledPayload;
    const failed = await deliver({
      fetchCampaignMembers: async () => {
        throw new Error("provider failure");
      },
    });
    expect(failed.statusCode).toBe(500);
    expect(memory.entitlement?.cancel_at_period_end).toBe(false);
    expect(Array.from(webhookRepository.rows.values())[0].status).toBe("processed");
    expect((await deliver()).status).toBe("duplicate");
    expect(memory.entitlement?.cancel_at_period_end).toBe(true);

    currentPayload = activePayload;
    await refreshCurrent();
    expect((await deliver()).status).toBe("duplicate");
    expect(memory.entitlement?.cancel_at_period_end).toBe(false);
    expect(memory.entitlement?.period_end).toEqual(new Date("2026-02-01T00:00:00.000Z"));
    expect(webhookRepository.rows.size).toBe(1);
  });

  it("processes distinct event types with identical payloads while rejecting same-event retries", async () => {
    const rawBody = encodeJsonPayload(makeMemberPayload());
    const webhookRepository = new MemoryWebhookEventRepository();
    const memory = new MemoryPatreonMemberStatePersistenceRepositories();
    const statuses: string[] = [];
    for (const eventType of ["members:create", "members:pledge:create", "members:pledge:create"]) {
      const response = await handlePatreonWebhookRawBody(rawBody, signedHeaders(rawBody, eventType), {
        config: validSupporterConfig,
        env: enabledEnv,
        now,
        repositories: {
          identityRepository: new MemoryIdentityLookupRepository([makeIdentity()]),
          webhookEventRepository: webhookRepository,
        },
        fetchCampaignMembers: async () => [makeMemberPayload()],
        persistMemberState: async (options) => {
          return await persistPatreonMemberState({ ...options, repositories: memory.repositories });
        },
      });
      statuses.push(response.status);
    }
    expect(statuses).toEqual(["processed", "processed", "duplicate"]);
    expect(Array.from(webhookRepository.rows.values()).map((row) => row.event_type)).toEqual([
      "members:create",
      "members:pledge:create",
    ]);
  });

  it("records provider event IDs before side effects and ignores duplicate deliveries", async () => {
    const rawBody = encodeJsonPayload(makeMemberPayload());
    const webhookRepository = new MemoryWebhookEventRepository();
    const identityRepository = new MemoryIdentityLookupRepository([makeIdentity()]);
    let persistedCount = 0;

    const headers = signedHeaders(rawBody, "members:update", { "x-patreon-event-id": "event_test" });
    const firstResponse = await handlePatreonWebhookRawBody(rawBody, headers, {
      config: validSupporterConfig,
      env: enabledEnv,
      now,
      repositories: {
        identityRepository,
        webhookEventRepository: webhookRepository,
      },
      persistMemberState: async () => {
        persistedCount += 1;
        return {
          identity: makeIdentity(),
          entitlement: { supporter_entitlement_id: 20 } as SupporterEntitlementRow,
        };
      },
    });
    const secondResponse = await handlePatreonWebhookRawBody(rawBody, headers, {
      config: validSupporterConfig,
      env: enabledEnv,
      now,
      repositories: {
        identityRepository,
        webhookEventRepository: webhookRepository,
      },
      persistMemberState: async () => {
        persistedCount += 1;
        throw new Error("duplicate should not persist");
      },
    });

    expect(firstResponse.status).toBe("processed");
    expect(secondResponse.status).toBe("duplicate");
    expect(persistedCount).toBe(1);
    expect(Array.from(webhookRepository.rows.values())[0].idempotency_key).toBe("event:event_test");
  });

  it("rejects invalid signatures before storing webhook rows", async () => {
    const rawBody = encodeJsonPayload(makeMemberPayload());
    const webhookRepository = new MemoryWebhookEventRepository();

    const response = await handlePatreonWebhookRawBody(
      rawBody,
      { "x-patreon-event": "members:update", "x-patreon-signature": "0".repeat(32) },
      {
        config: validSupporterConfig,
        env: enabledEnv,
        now,
        repositories: {
          identityRepository: new MemoryIdentityLookupRepository([makeIdentity()]),
          webhookEventRepository: webhookRepository,
        },
      },
    );

    expect(response.status).toBe("invalid_signature");
    expect(webhookRepository.rows.size).toBe(0);
  });

  it("does not grant access for malformed, wrong-campaign, or unsupported events", async () => {
    const webhookRepository = new MemoryWebhookEventRepository();
    const identityRepository = new MemoryIdentityLookupRepository([makeIdentity()]);
    let persistedCount = 0;
    const persistMemberState = async () => {
      persistedCount += 1;
      throw new Error("rejected events should not persist");
    };
    const malformedBody = Buffer.from("{not-json", "utf8");

    const malformedResponse = await handlePatreonWebhookRawBody(
      malformedBody,
      signedHeaders(malformedBody, "members:update"),
      {
        config: validSupporterConfig,
        env: enabledEnv,
        now,
        repositories: {
          identityRepository,
          webhookEventRepository: webhookRepository,
        },
        persistMemberState,
      },
    );
    const wrongCampaignBody = encodeJsonPayload(makeMemberPayload({ campaignId: "campaign_other" }));
    const wrongCampaignResponse = await handlePatreonWebhookRawBody(
      wrongCampaignBody,
      signedHeaders(wrongCampaignBody, "members:update"),
      {
        config: validSupporterConfig,
        env: enabledEnv,
        now,
        repositories: {
          identityRepository,
          webhookEventRepository: webhookRepository,
        },
        persistMemberState,
      },
    );
    const unsupportedBody = encodeJsonPayload(makeMemberPayload());
    const unsupportedResponse = await handlePatreonWebhookRawBody(
      unsupportedBody,
      signedHeaders(unsupportedBody, "posts:publish"),
      {
        config: validSupporterConfig,
        env: enabledEnv,
        now,
        repositories: {
          identityRepository,
          webhookEventRepository: webhookRepository,
        },
        persistMemberState,
      },
    );

    expect(malformedResponse.status).toBe("malformed");
    expect(wrongCampaignResponse.status).toBe("ignored");
    expect(unsupportedResponse.status).toBe("ignored");
    expect(persistedCount).toBe(0);
  });
});

describe("Patreon entitlement member-state persistence", () => {
  it("preserves canceled paid access without tier metadata, refuses unverified extensions, and honors payment failures", async () => {
    const map = (overrides: Parameters<typeof makeMemberPayload>[0], deleted = false) => {
      const result = mapPatreonMemberPayloadToSupporterState({
        config: validSupporterConfig,
        memberResponse: makeMemberPayload(overrides),
        now,
        fallbackHours: 24,
        forceInactiveReason: deleted ? "deleted" : undefined,
      });
      if (!result.valid) throw new Error("Expected a mapped membership");
      return result.snapshot;
    };
    const paid = map({ lastChargeStatus: "Paid", willPayAmountCents: 100 });
    const cancelled = map({
      patronStatus: "former_patron",
      lastChargeStatus: "Paid",
      willPayAmountCents: 0,
      nextChargeDate: null,
      tierIds: [],
    });
    for (const initialPaidPeriod of [true, false]) {
      const memory = new MemoryPatreonMemberStatePersistenceRepositories();
      const save = (snapshot: PatreonMemberStateSnapshot) =>
        persistPatreonMemberState({
          config: validSupporterConfig,
          identity: memory.identity,
          snapshot,
          source: "reconcile",
          verifiedAt: now,
          repositories: memory.repositories,
        });
      if (initialPaidPeriod) await save(paid);
      for (const candidate of [
        cancelled,
        map({ lastChargeStatus: "Paid", willPayAmountCents: 0, nextChargeDate: null }),
      ]) {
        for (let attempt = 0; attempt < 2; attempt++) {
          const saved = await save(candidate);
          expect(saved.entitlement.is_active).toBe(initialPaidPeriod);
          expect(saved.entitlement.cancel_at_period_end).toBe(true);
          expect(saved.entitlement.period_end).toEqual(initialPaidPeriod ? paid.periodEnd : null);
        }
      }
      if (initialPaidPeriod) {
        for (const failure of [
          map({ lastChargeStatus: "Declined", willPayAmountCents: 0 }),
          map({ lastChargeStatus: "Refunded", willPayAmountCents: 0 }),
          map({ lastChargeStatus: "Paid" }, true),
        ]) {
          expect((await save(failure)).entitlement.is_active).toBe(false);
        }
      }
    }
  });

  it("activates, renews, and deactivates entitlement and membership dates", async () => {
    const memory = new MemoryPatreonMemberStatePersistenceRepositories();
    const activeSnapshot: PatreonMemberStateSnapshot = {
      patreonUserId: "patreon_user_test",
      patreonMemberId: "member_test",
      patreonCampaignId: "campaign_test",
      patronStatus: "active_patron",
      tierKey: "test_tier",
      patreonTierId: "tier_test",
      periodStart: new Date("2026-01-01T00:00:00.000Z"),
      periodEnd: new Date("2026-02-01T00:00:00.000Z"),
      periodDateSource: "patreon",
      isActive: true,
      inactiveReason: null,
      lastSuccessfulChargeAt: null,
      nextChargeAt: new Date("2026-02-01T00:00:00.000Z"),
    };

    const activation = await persistPatreonMemberState({
      config: validSupporterConfig,
      identity: memory.identity,
      snapshot: activeSnapshot,
      source: "webhook",
      verifiedAt: now,
      repositories: memory.repositories,
    });
    const renewal = await persistPatreonMemberState({
      config: validSupporterConfig,
      identity: memory.identity,
      snapshot: {
        ...activeSnapshot,
        periodStart: new Date("2026-02-01T00:00:00.000Z"),
        periodEnd: new Date("2026-03-01T00:00:00.000Z"),
      },
      source: "webhook",
      verifiedAt: now,
      repositories: memory.repositories,
    });
    const deactivation = await persistPatreonMemberState({
      config: validSupporterConfig,
      identity: memory.identity,
      snapshot: {
        ...activeSnapshot,
        patronStatus: "declined_patron",
        periodStart: null,
        periodEnd: null,
        periodDateSource: "none",
        isActive: false,
        inactiveReason: "inactive",
      },
      source: "webhook",
      verifiedAt: now,
      repositories: memory.repositories,
    });

    expect(activation.entitlement.is_active).toBe(true);
    expect(activation.entitlement.source).toBe("webhook");
    expect(renewal.entitlement.period_start).toEqual(new Date("2026-02-01T00:00:00.000Z"));
    expect(renewal.entitlement.period_end).toEqual(new Date("2026-03-01T00:00:00.000Z"));
    expect(deactivation.entitlement.is_active).toBe(false);
    expect(deactivation.entitlement.period_end).toEqual(renewal.entitlement.period_end);
  });
});

describe("Patreon entitlement reconcile", () => {
  it("waits for membership refresh to settle before key recovery, including when Patreon is unavailable", async () => {
    for (const fails of [false, true]) {
      let tick: (() => void) | undefined;
      const events: string[] = [];
      const refresh = Promise.withResolvers<PatreonReconcileResult>();
      const recovered = Promise.withResolvers<void>();
      const createTimer = globalThis.setInterval;
      const timers: {
        setInterval: (callback: () => void, delay: number) => ReturnType<typeof globalThis.setInterval>;
      } = globalThis;
      const timer = spyOn(timers, "setInterval").mockImplementation((callback) => {
        tick = callback;
        return createTimer(() => {}, 300_000);
      });
      const info = spyOn(log, "info").mockImplementation(() => {});
      const error = spyOn(log, "error").mockImplementation(async () => {});
      const job = startPatreonReconcileJob({
        config: validSupporterConfig,
        runEntitlementReconcile: async () => {
          events.push("refresh_started");
          return await refresh.promise;
        },
        runMemberKeyReconcile: async () => {
          events.push("key_recovery");
          recovered.resolve();
        },
        runMaintenance: async () => ({ purgedOAuthStates: 0, purgedWebhookEvents: 0, purgedUsageStatistics: 0 }),
      });
      try {
        if (!tick) throw new Error("Missing reconcile timer");
        tick();
        expect(events).toEqual(["refresh_started"]);
        if (fails) refresh.reject(new Error("synthetic-patreon-outage"));
        else
          refresh.resolve({
            checkedIdentities: 0,
            fetchedMembers: 0,
            activatedOrRenewed: 0,
            deactivated: 0,
            failed: 0,
          });
        await recovered.promise;
        expect(events).toEqual(["refresh_started", "key_recovery"]);
      } finally {
        refresh.resolve({ checkedIdentities: 0, fetchedMembers: 0, activatedOrRenewed: 0, deactivated: 0, failed: 0 });
        job.stop();
        timer.mockRestore();
        info.mockRestore();
        error.mockRestore();
      }
    }
  });

  it("repairs missed webhooks by reconciling current Patreon member state", async () => {
    const oldIdentity = makeIdentity({ patreon_member_id: "member_old" });
    const persistedSnapshots: PatreonMemberStateSnapshot[] = [];
    const result = await runPatreonEntitlementReconcile({
      config: validSupporterConfig,
      env: enabledEnv,
      now,
      repositories: {
        identityRepository: {
          listIdentitiesForPatreonReconcile: async () => [oldIdentity],
        },
      },
      fetchCampaignMembers: async () => [makeMemberPayload({ memberId: "member_new", userId: "patreon_user_test" })],
      persistMemberState: async (options) => {
        expect(options.source).toBe("reconcile");
        persistedSnapshots.push(options.snapshot);
        return {
          identity: oldIdentity,
          entitlement: {
            supporter_entitlement_id: 20,
            is_active: options.snapshot.isActive,
          } as SupporterEntitlementRow,
        };
      },
    });

    expect(result).toMatchObject({
      checkedIdentities: 1,
      fetchedMembers: 1,
      activatedOrRenewed: 1,
      deactivated: 0,
      failed: 0,
    });
    expect(persistedSnapshots[0].patreonMemberId).toBe("member_new");
    expect(persistedSnapshots[0].isActive).toBe(true);
  });

  it("fails closed when reconcile cannot find a current Patreon member", async () => {
    const persistedSnapshots: PatreonMemberStateSnapshot[] = [];
    const result = await runPatreonEntitlementReconcile({
      config: validSupporterConfig,
      env: enabledEnv,
      now,
      repositories: {
        identityRepository: {
          listIdentitiesForPatreonReconcile: async () => [makeIdentity()],
        },
      },
      fetchCampaignMembers: async () => [],
      persistMemberState: async (options) => {
        persistedSnapshots.push(options.snapshot);
        return {
          identity: makeIdentity(),
          entitlement: {
            supporter_entitlement_id: 20,
            is_active: options.snapshot.isActive,
          } as SupporterEntitlementRow,
        };
      },
    });

    expect(result.deactivated).toBe(1);
    expect(persistedSnapshots[0]).toMatchObject({
      patronStatus: "not_found",
      isActive: false,
    });
  });
});
