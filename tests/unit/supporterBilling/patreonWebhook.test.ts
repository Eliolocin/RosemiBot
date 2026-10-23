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
  fetchPatreonCampaignMemberPayloads,
  fetchPatreonMemberPayload,
  refreshPatreonEntitlementForIdentity,
  runPatreonEntitlementReconcile,
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
        last_charge_status: overrides.lastChargeStatus === undefined ? "Paid" : overrides.lastChargeStatus,
        pledge_relationship_start: "2026-01-01T00:00:00.000Z",
        will_pay_amount_cents: overrides.willPayAmountCents === undefined ? 100 : overrides.willPayAmountCents,
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
  it("verifies the body signature without trusting unsigned timestamp metadata", () => {
    const rawBody = encodeJsonPayload(makeMemberPayload());
    for (const timestamp of ["invalid", "1", now.toISOString()]) {
      expect(
        verifyPatreonWebhookSignature({
          rawBody,
          webhookSecret,
          headers: signedHeaders(rawBody, "members:update", { "x-patreon-timestamp": timestamp }),
        }),
      ).toEqual({ valid: true });
    }
    expect(
      verifyPatreonWebhookSignature({ rawBody, webhookSecret, headers: { "x-patreon-signature": "0".repeat(32) } }),
    ).toEqual({ valid: false, reason: "invalid_signature" });
  });
});

describe("Patreon webhook handling", () => {
  function setup() {
    const memory = new MemoryPatreonMemberStatePersistenceRepositories();
    const webhookRepository = new MemoryWebhookEventRepository();
    const options: HandlePatreonWebhookOptions = {
      config: validSupporterConfig,
      env: enabledEnv,
      now,
      repositories: {
        identityRepository: new MemoryIdentityLookupRepository([makeIdentity()]),
        webhookEventRepository: webhookRepository,
      },
      persistMemberState: (options) => persistPatreonMemberState({ ...options, repositories: memory.repositories }),
      fetchMember: async () => makeMemberPayload(),
    };
    let observation = 0;
    const handle = (body: Uint8Array, headers: PatreonWebhookHeaders) => {
      options.now = new Date(now.getTime() + observation++);
      return handlePatreonWebhookRawBody(body, headers, options);
    };
    return { memory, webhookRepository, options, handle };
  }

  it("uses current member state on first, duplicate, and failed retries despite mutable headers", async () => {
    const { memory, webhookRepository, options, handle } = setup();
    const rawBody = encodeJsonPayload(makeMemberPayload());
    let current: unknown = makeMemberPayload({ willPayAmountCents: 0 });
    let fail = false;
    let fetched = 0;
    options.fetchMember = async () => {
      fetched += 1;
      if (fail) throw new Error("synthetic-provider-outage");
      return current;
    };
    const deliver = (event: string, id: string) =>
      handle(rawBody, signedHeaders(rawBody, event, { "x-patreon-event-id": id, "x-patreon-timestamp": "1" }));
    expect((await deliver("members:delete", "first")).status).toBe("processed");
    expect(memory.entitlement?.is_active).toBe(true);
    expect(memory.entitlement?.cancel_at_period_end).toBe(true);
    current = makeMemberPayload();
    expect((await deliver("posts:publish", "changed")).status).toBe("duplicate");
    expect(memory.entitlement?.cancel_at_period_end).toBe(false);
    fail = true;
    expect((await deliver("members:update", "retry")).statusCode).toBe(500);
    expect(memory.entitlement?.is_active).toBe(true);
    fail = false;
    current = makeMemberPayload({ patronStatus: "declined_patron", lastChargeStatus: "Declined" });
    expect((await deliver("members:create", "retry-again")).status).toBe("duplicate");
    expect(memory.entitlement?.is_active).toBe(false);
    expect(fetched).toBe(4);
    expect(webhookRepository.rows.size).toBe(1);
    expect([...webhookRepository.rows.values()][0].patreon_event_id).toBeNull();
  });

  it("keys both receipt paths by event type and payload hash so schema upgrades keep deduplicating", async () => {
    const { webhookRepository, handle } = setup();
    const rawBody = encodeJsonPayload(makeMemberPayload());
    expect((await handle(rawBody, signedHeaders(rawBody, "members:update"))).status).toBe("processed");
    const malformed = Buffer.from("{invalid");
    expect((await handle(malformed, signedHeaders(malformed, "members:update"))).statusCode).toBe(400);
    const receipts = [...webhookRepository.rows.values()];
    expect([...webhookRepository.rows.keys()]).toEqual(
      receipts.map((receipt) => `payload:${receipt.event_type}:${receipt.payload_hash}`),
    );
  });

  it("does not revive a failed old receipt after newer authoritative state deactivates membership", async () => {
    const { memory, options, handle } = setup();
    const old = encodeJsonPayload(makeMemberPayload());
    options.fetchMember = async () => {
      throw new Error("synthetic-outage");
    };
    expect((await handle(old, signedHeaders(old, "members:update"))).statusCode).toBe(500);
    const current = makeMemberPayload({ patronStatus: "declined_patron", lastChargeStatus: "Declined" });
    options.fetchMember = async () => current;
    const newer = encodeJsonPayload(current);
    expect((await handle(newer, signedHeaders(newer, "members:update"))).statusCode).toBe(200);
    expect((await handle(old, signedHeaders(old, "members:update"))).statusCode).toBe(200);
    expect(memory.entitlement?.is_active).toBe(false);
  });

  it("rejects invalid signatures and malformed or unrelated signed bodies before remote work", async () => {
    const { options, webhookRepository, handle } = setup();
    let fetched = 0;
    options.fetchMember = async () => {
      fetched += 1;
      return makeMemberPayload();
    };
    const rawBody = encodeJsonPayload(makeMemberPayload());
    expect((await handle(rawBody, { "x-patreon-signature": "0".repeat(32) })).statusCode).toBe(401);
    expect(webhookRepository.rows.size).toBe(0);
    for (const body of [
      Buffer.from("{invalid"),
      encodeJsonPayload({ data: {} }),
      encodeJsonPayload(makeMemberPayload({ campaignId: "other" })),
      encodeJsonPayload(makeMemberPayload({ memberId: "other", userId: "other" })),
    ]) {
      expect((await handle(body, signedHeaders(body, "members:update"))).statusCode).toBeGreaterThanOrEqual(200);
    }
    expect(fetched).toBe(0);
  });

  it("leaves benefits untouched and returns retryable failure for malformed and wrong-owner API responses", async () => {
    const { options, memory, handle } = setup();
    const rawBody = encodeJsonPayload(makeMemberPayload());
    const deliver = () => handle(rawBody, signedHeaders(rawBody, "members:update"));
    await deliver();
    for (const invalid of [
      { data: {} },
      makeMemberPayload({ memberId: "other" }),
      makeMemberPayload({ userId: "other" }),
      makeMemberPayload({ campaignId: "other" }),
    ]) {
      options.fetchMember = async () => invalid;
      expect((await deliver()).statusCode).toBe(500);
      expect(memory.entitlement?.is_active).toBe(true);
    }
    options.fetchMember = async () => null;
    expect((await deliver()).statusCode).toBe(200);
    expect(memory.entitlement?.is_active).toBe(false);
  });
});

describe("Patreon authoritative member fetch", () => {
  it("requests a single member with explicit fields and creator authorization", async () => {
    const requests: URL[] = [];
    const payload = await fetchPatreonMemberPayload({
      config: validSupporterConfig,
      memberId: "member_test",
      accessToken: "synthetic-token",
      fetchImpl: async (input, init) => {
        requests.push(new URL(String(input)));
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer synthetic-token");
        expect(init?.redirect).toBe("manual");
        return Response.json(makeMemberPayload());
      },
    });
    expect(payload).toEqual(makeMemberPayload());
    expect(requests[0].pathname).toBe("/api/oauth2/v2/members/member_test");
    expect(requests[0].searchParams.get("include")?.split(",")).toContain("user");
    expect(requests[0].searchParams.get("fields[member]")?.split(",")).toContain("last_charge_status");
  });

  it("distinguishes confirmed missing members from API outages and malformed responses", async () => {
    for (const status of [404, 410]) {
      expect(
        await fetchPatreonMemberPayload({
          config: validSupporterConfig,
          memberId: "member_test",
          accessToken: "synthetic-token",
          fetchImpl: async () => new Response(null, { status }),
        }),
      ).toBeNull();
    }
    for (const response of [
      new Response(null, { status: 503 }),
      new Response(null, { status: 403 }),
      Response.json({ data: {} }),
    ]) {
      await expect(
        fetchPatreonMemberPayload({
          config: validSupporterConfig,
          memberId: "member_test",
          accessToken: "synthetic-token",
          fetchImpl: async () => response,
        }),
      ).rejects.toThrow();
    }
  });

  it("rejects incomplete campaign scans before entitlement persistence", async () => {
    let persisted = 0;
    for (const page of [
      { data: [], meta: { pagination: { cursors: { next: "more" } } } },
      { data: [], links: { next: "https://untrusted.example/members" } },
    ]) {
      await expect(
        runPatreonEntitlementReconcile({
          config: validSupporterConfig,
          repositories: { identityRepository: { listIdentitiesForPatreonReconcile: async () => [makeIdentity()] } },
          fetchCampaignMembers: () =>
            fetchPatreonCampaignMemberPayloads({
              config: validSupporterConfig,
              accessToken: "synthetic-token",
              maxPages: 1,
              fetchImpl: async () => Response.json(page),
            }),
          persistMemberState: async () => {
            persisted += 1;
            throw new Error("unreachable");
          },
        }),
      ).rejects.toThrow();
    }
    expect(persisted).toBe(0);
  });
});

describe("Patreon entitlement member-state persistence", () => {
  it("keeps a newer authoritative result when a concurrent old response finishes last at the same timestamp", async () => {
    const memory = new MemoryPatreonMemberStatePersistenceRepositories();
    const older = Promise.withResolvers<unknown>();
    const persist = (options: Parameters<typeof persistPatreonMemberState>[0]) =>
      persistPatreonMemberState({ ...options, repositories: memory.repositories });
    const pending = refreshPatreonEntitlementForIdentity({
      config: validSupporterConfig,
      identity: memory.identity,
      now,
      fetchMember: () => older.promise,
      persistMemberState: persist,
    });
    await refreshPatreonEntitlementForIdentity({
      config: validSupporterConfig,
      identity: memory.identity,
      now,
      fetchMember: async () => makeMemberPayload({ patronStatus: "declined_patron", lastChargeStatus: "Declined" }),
      persistMemberState: persist,
    });
    older.resolve(makeMemberPayload());
    await pending;
    expect(memory.entitlement?.is_active).toBe(false);
    expect(memory.entitlement?.patron_status).toBe("declined_patron");
  });

  it("preserves canceled paid access without tier metadata, refuses unverified extensions, and honors payment failures", async () => {
    let observation = 0;
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
          verifiedAt: new Date(now.getTime() + observation++),
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
    let observation = 0;
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
      verifiedAt: new Date(now.getTime() + observation++),
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
      verifiedAt: new Date(now.getTime() + observation++),
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
      verifiedAt: new Date(now.getTime() + observation++),
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

  it("skips overlapping ticks through entitlement work, key cleanup, and maintenance, then clears failure guards", async () => {
    let tick: (() => void) | undefined;
    const createTimer = globalThis.setInterval;
    const timers: { setInterval: (callback: () => void, delay: number) => ReturnType<typeof globalThis.setInterval> } =
      globalThis;
    const timer = spyOn(timers, "setInterval").mockImplementation((callback) => {
      tick = callback;
      return createTimer(() => {}, 300_000);
    });
    const maintenance = Promise.withResolvers<void>();
    const keys = Promise.withResolvers<void>();
    let entitlementCalls = 0;
    let keyCalls = 0;
    let maintenanceCalls = 0;
    const error = spyOn(log, "error").mockImplementation(async () => {});
    const job = startPatreonReconcileJob({
      config: validSupporterConfig,
      runEntitlementReconcile: async () => {
        entitlementCalls += 1;
        throw new Error("synthetic-outage");
      },
      runMemberKeyReconcile: async () => {
        keyCalls += 1;
        await keys.promise;
      },
      runMaintenance: async () => {
        maintenanceCalls += 1;
        await maintenance.promise;
        throw new Error("synthetic-maintenance-outage");
      },
    });
    const flush = async () => {
      for (let count = 0; count < 20; count++) await Promise.resolve();
    };
    try {
      if (!tick) throw new Error("Missing reconcile timer");
      tick();
      tick();
      await flush();
      expect([entitlementCalls, keyCalls, maintenanceCalls]).toEqual([1, 1, 1]);
      keys.resolve();
      await flush();
      tick();
      expect(entitlementCalls).toBe(1);
      maintenance.resolve();
      await flush();
      tick();
      await flush();
      expect([entitlementCalls, keyCalls, maintenanceCalls]).toEqual([2, 2, 2]);
    } finally {
      keys.resolve();
      maintenance.resolve();
      await flush();
      job.stop();
      timer.mockRestore();
      error.mockRestore();
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
