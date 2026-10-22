import { createHash } from "node:crypto";
import { MemberKeyRepository } from "@/modules/supporter-billing/db/repositories/memberKeys";
import { supporterUsageStatisticsRepository } from "@/modules/supporter-billing/db/repositories";
import {
  createMemberKeyProvider,
  type MemberKeyProvider,
  normalizeMemberKeyLimit,
  MICROS_PER_DOLLAR,
} from "@/modules/supporter-billing/openrouter/management";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import type { SupporterFundingContext } from "@/modules/supporter-billing/runtime/types";
import { estimateSupporterRequestCost } from "@/modules/supporter-billing/runtime/spendEstimates";
import { readBoundedResponse } from "@/utils/security/boundedResponse";
import { z } from "zod";

const USAGE_CACHE_MS = 5_000;

interface KeySpend {
  baseline: number;
  completed: number;
  usage: number;
  usageReadAt: number;
}

export interface SupporterSpendHold {
  reportCost(cost: number | null | undefined): void;
  release(retainEstimate?: boolean): void;
}

function credentialDigest(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

// Pending holds are process-local; use shared admission before running inference in multiple worker processes.
export class SupporterSpendGuard {
  private readonly credentials = new Map<string, { funding: SupporterFundingContext; keyHash: string }>();
  private readonly keys = new Map<string, KeySpend>();
  private readonly pending = new Map<number, number>();
  private readonly admissions = new Map<number, Promise<unknown>>();

  constructor(
    private readonly memberKeys = new MemberKeyRepository(),
    private readonly statistics = supporterUsageStatisticsRepository,
    private readonly provider: () => Pick<MemberKeyProvider, "get"> = createMemberKeyProvider,
  ) {}

  registerCredential(apiKey: string, funding: SupporterFundingContext, keyHash: string): void {
    this.credentials.set(credentialDigest(apiKey), { funding, keyHash });
  }

  observedSpend(hash: string): number {
    const state = this.keys.get(hash);
    return state ? Math.max(state.usage, state.baseline + state.completed) : 0;
  }

  pendingSpend(identityId: number): number {
    return this.pending.get(identityId) ?? 0;
  }

  async begin(apiKey: string, estimate: () => Promise<number>): Promise<SupporterSpendHold | undefined> {
    const credential = this.credentials.get(credentialDigest(apiKey));
    if (!credential) return undefined;
    const { funding } = credential;
    const identityId = funding.sponsorIdentityId;
    const previous = this.admissions.get(identityId) ?? Promise.resolve();
    const admission = previous
      .catch(() => undefined)
      .then(async () => {
        try {
          const row = await this.memberKeys.loadByIdentityId(identityId);
          if (
            !row ||
            row.disabled ||
            row.pending_action ||
            row.key_hash !== credential.keyHash ||
            !row.key_created_at ||
            row.applied_limit === null
          )
            throw this.denied(funding, "billing_unavailable");
          const logged = await this.statistics.totalSince(identityId, row.key_created_at);
          let state = this.keys.get(row.key_hash);
          if (!state) {
            state = { baseline: logged, completed: 0, usage: 0, usageReadAt: 0 };
            this.keys.set(row.key_hash, state);
          }
          if (Date.now() - state.usageReadAt >= USAGE_CACHE_MS) {
            const remote = await this.provider().get(row.key_hash);
            if (!remote || remote.disabled) throw this.denied(funding, "billing_unavailable");
            state.usage = Math.max(state.usage, remote.usage);
            state.usageReadAt = Date.now();
          }
          state.baseline = Math.max(state.baseline, logged - state.completed, state.usage - state.completed);
          if (Math.max(logged, this.observedSpend(row.key_hash)) + this.pendingSpend(identityId) >= row.applied_limit)
            throw this.denied(funding, "allowance_exhausted");
          const estimated = await estimate();
          if (!Number.isFinite(estimated) || estimated < 0) throw this.denied(funding, "model_unavailable");
          const cost = Math.ceil(estimated * MICROS_PER_DOLLAR) / MICROS_PER_DOLLAR;
          const spent = Math.max(logged, this.observedSpend(row.key_hash));
          const pending = this.pendingSpend(identityId);
          if (spent + pending >= row.applied_limit || cost > row.applied_limit - spent - pending)
            throw this.denied(funding, "allowance_exhausted");
          this.pending.set(identityId, normalizeMemberKeyLimit(pending + cost));
          let reported: number | undefined;
          let held = cost;
          let released = false;
          return {
            reportCost: (value: number | null | undefined) => {
              if (released || typeof value !== "number" || !Number.isFinite(value) || value < 0) return;
              state.completed += value - (reported ?? 0);
              const remaining = Math.max(0, normalizeMemberKeyLimit(cost - value));
              this.pending.set(identityId, normalizeMemberKeyLimit(this.pendingSpend(identityId) + remaining - held));
              held = remaining;
              reported = value;
            },
            release: (retainEstimate = false) => {
              if (released) return;
              released = true;
              if (reported === undefined && retainEstimate) state.completed += cost;
              const remaining = Math.max(0, normalizeMemberKeyLimit(this.pendingSpend(identityId) - held));
              if (remaining === 0) this.pending.delete(identityId);
              else this.pending.set(identityId, remaining);
            },
          };
        } catch (error) {
          if (error instanceof SupporterRequestDeniedError) throw error;
          throw this.denied(funding, "billing_unavailable");
        }
      });
    this.admissions.set(identityId, admission);
    try {
      return await admission;
    } finally {
      if (this.admissions.get(identityId) === admission) this.admissions.delete(identityId);
    }
  }

  private denied(
    funding: SupporterFundingContext,
    reason: "billing_unavailable" | "model_unavailable" | "allowance_exhausted",
  ) {
    return new SupporterRequestDeniedError(
      reason,
      funding.renewalAt ? { periodEnd: funding.renewalAt } : undefined,
      funding.capability,
      funding.fundingScope,
    );
  }
}

export const supporterSpendGuard = new SupporterSpendGuard();

export async function beginSupporterRequest(apiKey: string, path: string, body: Record<string, unknown>) {
  return supporterSpendGuard.begin(apiKey, () => estimateSupporterRequestCost(path, body));
}

const JSON_RESPONSE_MAX_BYTES = 64 * 1024 * 1024;
const reportedCostSchema = z.object({
  usage: z.object({ cost: z.number().finite().nonnegative().nullish() }).nullish(),
  error: z.unknown().optional(),
});

export async function fetchWithSupporterSpend(
  input: string | URL | Request,
  init?: RequestInit,
  fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = fetch,
): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const send = () => (init === undefined ? fetchImpl(input) : fetchImpl(input, init));
  const authorization = new Headers(init?.headers ?? request?.headers).get("Authorization");
  const apiKey = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if ((init?.method ?? request?.method)?.toUpperCase() !== "POST") return send();
  const signal = init?.signal ?? request?.signal;
  signal?.throwIfAborted();
  const hold = await supporterSpendGuard.begin(apiKey, async () => {
    const body = typeof init?.body === "string" ? init.body : await request?.clone().text();
    return estimateSupporterRequestCost(
      request?.url ?? String(input),
      JSON.parse(body ?? "") as Record<string, unknown>,
    );
  });
  if (!hold) return send();
  let retainEstimate = false;
  try {
    if (signal?.aborted) {
      hold.reportCost(0);
      signal.throwIfAborted();
    }
    const response = await send();
    if (!response.ok) hold.reportCost(0);
    const body = await readBoundedResponse(response, JSON_RESPONSE_MAX_BYTES, signal ?? undefined);
    if (response.ok) {
      try {
        const parsed = reportedCostSchema.safeParse(JSON.parse(body.toString("utf8")));
        if (parsed.success) {
          hold.reportCost(parsed.data.usage?.cost);
          retainEstimate = parsed.data.error === undefined;
        }
      } catch {}
    }
    return new Response(new Uint8Array(body), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } finally {
    hold.release(retainEstimate);
  }
}
