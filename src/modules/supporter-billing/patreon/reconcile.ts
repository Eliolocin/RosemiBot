import {
  getPatreonCreatorAccessToken,
  rejectPatreonCreatorAccessToken,
} from "@/modules/supporter-billing/patreon/creatorTokens";
import { z } from "zod";
import type { SupporterBillingConfig } from "@/modules/supporter-billing/config";
import {
  supporterIdentityRepository,
  type SupporterIdentityRepository,
  type SupporterIdentityRow,
} from "@/modules/supporter-billing/db";
import {
  mapPatreonMemberPayloadToSupporterState,
  type PatreonMemberStateSnapshot,
} from "@/modules/supporter-billing/patreon/mapping";
import {
  type PersistPatreonMemberStateOptions,
  type PersistPatreonMemberStateResult,
  persistPatreonMemberState,
} from "@/modules/supporter-billing/patreon/persistence";
import { PatreonApiError } from "@/modules/supporter-billing/patreon/oauth";
import { runSupporterBillingMaintenance } from "@/modules/supporter-billing/runtime/maintenance";
import { reconcileMemberKeys } from "@/modules/supporter-billing/openrouter/memberKeys";
import {
  getPatreonHttpTimeoutMs,
  getPatreonReconcileMaxPages,
  getPatreonUsagePeriodFallbackHours,
  PATREON_API_BASE_URL,
  PATREON_USER_AGENT,
} from "@/modules/supporter-billing/patreon/settings";
import { log } from "@/utils/misc/logger";
import type { OAuthFetch } from "@/utils/oauth/oauthFetch";

type EnvRecord = Readonly<Record<string, string | undefined>>;
type FetchLike = OAuthFetch;

export interface PatreonReconcileRepositories {
  identityRepository: Pick<SupporterIdentityRepository, "listIdentitiesForPatreonReconcile">;
}

export interface RunPatreonReconcileOptions {
  config: SupporterBillingConfig;
  env?: EnvRecord;
  now?: Date;
  repositories?: PatreonReconcileRepositories;
  fetchCampaignMembers?: () => Promise<unknown[]>;
  persistMemberState?: (options: PersistPatreonMemberStateOptions) => Promise<PersistPatreonMemberStateResult>;
}

export interface RefreshPatreonEntitlementForIdentityOptions {
  config: SupporterBillingConfig;
  identity: SupporterIdentityRow;
  env?: EnvRecord;
  now?: Date;
  fetchMember?: () => Promise<unknown | null>;
  source?: "reconcile" | "webhook";
  persistMemberState?: (options: PersistPatreonMemberStateOptions) => Promise<PersistPatreonMemberStateResult>;
}

export interface PatreonReconcileResult {
  checkedIdentities: number;
  fetchedMembers: number;
  activatedOrRenewed: number;
  deactivated: number;
  failed: number;
}

export interface PatreonIdentityRefreshResult {
  fetchedMembers: number;
  matchedMember: boolean;
  snapshot: PatreonMemberStateSnapshot;
  persistResult: PersistPatreonMemberStateResult;
}

export interface PatreonReconcileJobHandle {
  stop: () => void;
}

const patreonCampaignMembersPageSchema = z
  .object({
    data: z.array(z.unknown()),
    included: z.array(z.unknown()).optional(),
    links: z
      .object({
        next: z.string().trim().min(1).nullable().optional(),
      })
      .passthrough()
      .optional(),
    meta: z
      .object({
        pagination: z
          .object({
            cursors: z
              .object({
                next: z.string().trim().min(1).nullable().optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

function buildMemberUrl(path: string): URL {
  const url = new URL(path, `${PATREON_API_BASE_URL}/`);
  url.searchParams.set("include", "campaign,user,currently_entitled_tiers");
  url.searchParams.set(
    "fields[member]",
    "patron_status,last_charge_date,last_charge_status,next_charge_date,pledge_relationship_start,will_pay_amount_cents",
  );
  url.searchParams.set("fields[tier]", "title");
  url.searchParams.set("fields[campaign]", "creation_name");
  url.searchParams.set("fields[user]", "full_name");
  return url;
}

function makeMemberResponsesFromPage(page: z.infer<typeof patreonCampaignMembersPageSchema>): unknown[] {
  const included = page.included ?? [];
  return page.data.map((member) => ({
    data: member,
    included,
  }));
}

function nextMembersPageUrl(currentUrl: URL, page: z.infer<typeof patreonCampaignMembersPageSchema>): URL | null {
  // The creator access token is attached to every page request, so a `links.next`
  // value from the response body must never point the fetch at a non-Patreon host.
  if (page.links?.next) {
    const nextUrl = parsePatreonOriginUrl(page.links.next);
    if (nextUrl) {
      return nextUrl;
    }
    throw new PatreonApiError("Patreon members pagination link was invalid");
  }

  const nextCursor = page.meta?.pagination?.cursors?.next;
  if (!nextCursor) {
    return null;
  }

  const nextUrl = new URL(currentUrl.toString());
  nextUrl.searchParams.set("page[cursor]", nextCursor);
  return nextUrl;
}

function parsePatreonOriginUrl(rawUrl: string): URL | null {
  try {
    const parsedUrl = new URL(rawUrl);
    return parsedUrl.origin === new URL(PATREON_API_BASE_URL).origin ? parsedUrl : null;
  } catch {
    return null;
  }
}

export async function fetchPatreonCampaignMemberPayloads(options: {
  config: SupporterBillingConfig;
  env?: EnvRecord;
  fetchImpl?: FetchLike;
  accessToken?: string;
  timeoutMs?: number;
  maxPages?: number;
}): Promise<unknown[]> {
  const env = options.env ?? process.env;
  let accessToken =
    options.accessToken ??
    (await getPatreonCreatorAccessToken({ config: options.config, env, fetchImpl: options.fetchImpl }));
  let refreshedAfterRejection = false;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? getPatreonHttpTimeoutMs(env);
  const maxPages = options.maxPages ?? getPatreonReconcileMaxPages(env);
  const memberPayloads: unknown[] = [];
  let nextUrl: URL | null = buildMemberUrl(
    `campaigns/${encodeURIComponent(options.config.patreon.campaignId)}/members`,
  );
  nextUrl.searchParams.set("page[count]", "1000");
  let pageCount = 0;

  while (nextUrl && pageCount < maxPages) {
    pageCount += 1;
    const response = await fetchImpl(nextUrl.toString(), {
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": PATREON_USER_AGENT,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.status === 401 && !options.accessToken && !refreshedAfterRejection) {
      await response.body?.cancel();
      await rejectPatreonCreatorAccessToken(options.config, accessToken, env);
      accessToken = await getPatreonCreatorAccessToken({ config: options.config, env, fetchImpl: options.fetchImpl });
      refreshedAfterRejection = true;
      pageCount -= 1;
      continue;
    }
    if (!response.ok) {
      throw new PatreonApiError("Patreon campaign member fetch failed", response.status);
    }

    const parsedPage = patreonCampaignMembersPageSchema.safeParse(await response.json());
    if (!parsedPage.success) {
      throw new PatreonApiError("Patreon campaign member response was invalid", response.status);
    }

    memberPayloads.push(...makeMemberResponsesFromPage(parsedPage.data));
    nextUrl = nextMembersPageUrl(nextUrl, parsedPage.data);
  }

  if (nextUrl) throw new PatreonApiError("Patreon campaign member pagination limit exceeded");
  return memberPayloads;
}

function makeMissingMemberInactiveSnapshot(identity: SupporterIdentityRow): PatreonMemberStateSnapshot {
  return {
    patreonUserId: identity.patreon_user_id,
    patreonMemberId: identity.patreon_member_id,
    patreonCampaignId: identity.patreon_campaign_id,
    patronStatus: "not_found",
    tierKey: null,
    patreonTierId: null,
    periodStart: null,
    periodEnd: null,
    periodDateSource: "none",
    isActive: false,
    inactiveReason: "not_found",
    lastSuccessfulChargeAt: null,
    nextChargeAt: null,
  };
}

function mapCampaignMemberPayloadsToStates(params: {
  config: SupporterBillingConfig;
  memberPayloads: unknown[];
  now: Date;
  env: EnvRecord;
}): PatreonMemberStateSnapshot[] {
  return params.memberPayloads.flatMap((payload) => {
    const mapped = mapPatreonMemberPayloadToSupporterState({
      config: params.config,
      memberResponse: payload,
      now: params.now,
      fallbackHours: getPatreonUsagePeriodFallbackHours(params.env),
    });

    if (!mapped.valid) throw new PatreonApiError("Patreon campaign member response was invalid");
    return [mapped.snapshot];
  });
}

function indexMemberStates(states: readonly PatreonMemberStateSnapshot[]): {
  byMemberId: Map<string, PatreonMemberStateSnapshot>;
  byUserId: Map<string, PatreonMemberStateSnapshot>;
} {
  const byMemberId = new Map<string, PatreonMemberStateSnapshot>();
  const byUserId = new Map<string, PatreonMemberStateSnapshot>();

  for (const state of states) {
    byMemberId.set(state.patreonMemberId, state);
    byUserId.set(state.patreonUserId, state);
  }

  return { byMemberId, byUserId };
}

async function loadCampaignMemberPayloads(params: {
  config: SupporterBillingConfig;
  env: EnvRecord;
  fetchCampaignMembers?: () => Promise<unknown[]>;
}): Promise<unknown[]> {
  return await (
    params.fetchCampaignMembers ??
    (() =>
      fetchPatreonCampaignMemberPayloads({
        config: params.config,
        env: params.env,
      }))
  )();
}

const authoritativeMemberSchema = z.object({
  data: z.object({
    id: z.string().min(1),
    type: z.literal("member"),
    attributes: z.object({
      patron_status: z.enum(["active_patron", "former_patron", "declined_patron"]).nullable(),
      last_charge_status: z.string().min(1).nullable(),
      last_charge_date: z.iso.datetime({ offset: true }).nullable(),
      next_charge_date: z.iso.datetime({ offset: true }).nullable(),
      pledge_relationship_start: z.iso.datetime({ offset: true }).nullable(),
      will_pay_amount_cents: z.number().int().nonnegative().nullable(),
    }),
    relationships: z.object({
      campaign: z.object({ data: z.object({ id: z.string().min(1), type: z.literal("campaign") }) }),
      user: z.object({ data: z.object({ id: z.string().min(1), type: z.literal("user") }) }),
      currently_entitled_tiers: z.object({
        data: z.array(z.object({ id: z.string().min(1), type: z.literal("tier") })),
      }),
    }),
  }),
});

export async function fetchPatreonMemberPayload(options: {
  config: SupporterBillingConfig;
  memberId: string;
  env?: EnvRecord;
  fetchImpl?: FetchLike;
  accessToken?: string;
}): Promise<unknown | null> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  let token = options.accessToken ?? (await getPatreonCreatorAccessToken({ ...options, env }));
  const url = buildMemberUrl(`members/${encodeURIComponent(options.memberId)}`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchImpl(url.toString(), {
      redirect: "manual",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": PATREON_USER_AGENT },
      signal: AbortSignal.timeout(getPatreonHttpTimeoutMs(env)),
    });
    if (response.status === 401 && !options.accessToken && attempt === 0) {
      await response.body?.cancel();
      await rejectPatreonCreatorAccessToken(options.config, token, env);
      token = await getPatreonCreatorAccessToken({ ...options, env });
      continue;
    }
    if (response.status === 404 || response.status === 410) return null;
    if (!response.ok) throw new PatreonApiError("Patreon member fetch failed", response.status);
    const payload: unknown = await response.json();
    if (!authoritativeMemberSchema.safeParse(payload).success)
      throw new PatreonApiError("Patreon member response was invalid");
    return payload;
  }
  throw new PatreonApiError("Patreon member fetch failed");
}

export async function refreshPatreonEntitlementForIdentity(
  options: RefreshPatreonEntitlementForIdentityOptions,
): Promise<PatreonIdentityRefreshResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const payload = await (
    options.fetchMember ??
    (() =>
      fetchPatreonMemberPayload({
        config: options.config,
        memberId: options.identity.patreon_member_id,
        env,
      }))
  )();
  let snapshot: PatreonMemberStateSnapshot;
  if (payload === null) {
    snapshot = makeMissingMemberInactiveSnapshot(options.identity);
  } else {
    if (!authoritativeMemberSchema.safeParse(payload).success)
      throw new PatreonApiError("Patreon member response was invalid");
    const mapped = mapPatreonMemberPayloadToSupporterState({
      config: options.config,
      memberResponse: payload,
      now,
      fallbackHours: getPatreonUsagePeriodFallbackHours(env),
    });
    if (
      !mapped.valid ||
      mapped.snapshot.patreonMemberId !== options.identity.patreon_member_id ||
      mapped.snapshot.patreonUserId !== options.identity.patreon_user_id ||
      mapped.snapshot.patreonCampaignId !== options.identity.patreon_campaign_id
    )
      throw new PatreonApiError("Patreon member response did not match linked membership");
    snapshot = mapped.snapshot;
  }
  const persistResult = await (options.persistMemberState ?? persistPatreonMemberState)({
    config: options.config,
    identity: options.identity,
    snapshot,
    source: options.source ?? "reconcile",
    verifiedAt: now,
    env,
  });
  return { fetchedMembers: payload === null ? 0 : 1, matchedMember: payload !== null, snapshot, persistResult };
}

export async function runPatreonEntitlementReconcile(
  options: RunPatreonReconcileOptions,
): Promise<PatreonReconcileResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const identityRepository = options.repositories?.identityRepository ?? supporterIdentityRepository;
  const identities = await identityRepository.listIdentitiesForPatreonReconcile();
  const memberPayloads = await loadCampaignMemberPayloads({
    config: options.config,
    env,
    fetchCampaignMembers: options.fetchCampaignMembers,
  });
  const memberStates = mapCampaignMemberPayloadsToStates({
    config: options.config,
    memberPayloads,
    now,
    env,
  });
  const indexedStates = indexMemberStates(memberStates);
  const result: PatreonReconcileResult = {
    checkedIdentities: identities.length,
    fetchedMembers: memberPayloads.length,
    activatedOrRenewed: 0,
    deactivated: 0,
    failed: 0,
  };

  for (const identity of identities) {
    const memberState =
      indexedStates.byMemberId.get(identity.patreon_member_id) ??
      indexedStates.byUserId.get(identity.patreon_user_id) ??
      makeMissingMemberInactiveSnapshot(identity);

    try {
      const persisted = await (options.persistMemberState ?? persistPatreonMemberState)({
        config: options.config,
        identity,
        snapshot: memberState,
        source: "reconcile",
        verifiedAt: now,
        env,
      });

      if (persisted.entitlement.is_active) {
        result.activatedOrRenewed += 1;
      } else {
        result.deactivated += 1;
      }
    } catch {
      result.failed += 1;
    }
  }

  return result;
}

export function startPatreonReconcileJob(options: {
  config: SupporterBillingConfig;
  env?: EnvRecord;
  runMaintenance?: typeof runSupporterBillingMaintenance;
  runEntitlementReconcile?: typeof runPatreonEntitlementReconcile;
  runMemberKeyReconcile?: typeof reconcileMemberKeys;
}): PatreonReconcileJobHandle {
  const intervalMs = options.config.jobs.reconcileIntervalSeconds * 1000;
  const runMaintenanceHook = options.runMaintenance ?? runSupporterBillingMaintenance;
  const runEntitlementReconcileHook = options.runEntitlementReconcile ?? runPatreonEntitlementReconcile;
  const runMemberKeyReconcileHook = options.runMemberKeyReconcile ?? reconcileMemberKeys;
  let running = false;
  const runTick = (): void => {
    if (running) return;
    running = true;
    const reconcile = runEntitlementReconcileHook({
      config: options.config,
      env: options.env,
    })
      .then((result) => {
        log.info(
          `Supporter Patreon reconcile checked ${result.checkedIdentities} identity row(s), ` +
            `activated or renewed ${result.activatedOrRenewed}, deactivated ${result.deactivated}, ` +
            `failed ${result.failed}`,
        );
      })
      .catch((error) => {
        void log.error("Supporter Patreon reconcile failed", error);
      })
      .finally(async () => {
        try {
          await runMemberKeyReconcileHook({ config: options.config, env: options.env });
        } catch {
          void log.error("Supporter member-key reconciliation failed", { errorType: "MemberKeyError" });
        }
      });

    const maintenance = runMaintenanceHook()
      .then((maintenance) => {
        if (maintenance.purgedOAuthStates > 0 || maintenance.purgedWebhookEvents > 0) {
          log.info(
            `Supporter billing maintenance purged ${maintenance.purgedOAuthStates} OAuth state(s) and ${maintenance.purgedWebhookEvents} webhook event(s)`,
          );
        }
      })
      .catch((error) => {
        void log.error("Supporter billing periodic maintenance failed", error);
      });
    void Promise.allSettled([reconcile, maintenance]).finally(() => {
      running = false;
    });
  };
  const timer = setInterval(runTick, intervalMs);
  timer.unref();

  return {
    stop: () => clearInterval(timer),
  };
}
