import { z } from "zod";
import type { SupporterBillingConfig, SupporterBillingTierConfig } from "@/modules/supporter-billing/config";

export interface EligiblePatreonSupporterSnapshot {
  discordUserId: string;
  patreonUserId: string;
  patreonMemberId: string;
  patreonCampaignId: string;
  tierKey: string;
  patreonTierId: string;
  patronStatus: string;
  cancelAtPeriodEnd?: boolean;
  periodStart: Date;
  periodEnd: Date;
  periodDateSource: "patreon" | "patreon_next_charge" | "fallback";
  lastSuccessfulChargeAt: Date | null;
  nextChargeAt: Date | null;
}

export type PatreonMembershipRejectionReason =
  | "invalid_payload"
  | "unlinked_membership"
  | "wrong_campaign"
  | "inactive"
  | "unconfigured_tier";

export type PatreonMemberInactiveReason =
  | "deleted"
  | "inactive"
  | "no_entitled_tier"
  | "unconfigured_tier"
  | "cancelled"
  | "not_found";

export interface PatreonMemberStateSnapshot {
  patreonUserId: string;
  patreonMemberId: string;
  patreonCampaignId: string;
  patronStatus: string;
  cancelAtPeriodEnd?: boolean;
  tierKey: string | null;
  patreonTierId: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  periodDateSource: EligiblePatreonSupporterSnapshot["periodDateSource"] | "none";
  isActive: boolean;
  inactiveReason: PatreonMemberInactiveReason | null;
  lastSuccessfulChargeAt: Date | null;
  nextChargeAt: Date | null;
}

export type PatreonMembershipMappingResult =
  | {
      eligible: true;
      snapshot: EligiblePatreonSupporterSnapshot;
    }
  | {
      eligible: false;
      reason: PatreonMembershipRejectionReason;
    };

export type PatreonMemberStateMappingResult =
  | {
      valid: true;
      snapshot: PatreonMemberStateSnapshot;
    }
  | {
      valid: false;
      reason: "invalid_payload" | "wrong_campaign";
    };

const resourceIdentifierSchema = z
  .object({
    id: z.string().trim().min(1),
    type: z.string().trim().min(1),
  })
  .passthrough();

const relationshipSchema = z
  .object({
    data: z.union([resourceIdentifierSchema, z.array(resourceIdentifierSchema), z.null()]).optional(),
  })
  .passthrough();

const resourceSchema = z
  .object({
    id: z.string().trim().min(1),
    type: z.string().trim().min(1),
    attributes: z
      .object({ will_pay_amount_cents: z.number().int().nonnegative().nullish() })
      .catchall(z.unknown())
      .optional(),
    relationships: z.record(z.string(), relationshipSchema).optional(),
  })
  .passthrough();

const identityResponseSchema = z
  .object({
    data: resourceSchema,
    included: z.array(resourceSchema).optional(),
  })
  .passthrough();

const memberResponseSchema = z
  .object({
    data: resourceSchema,
    included: z.array(resourceSchema).optional(),
  })
  .passthrough();

type PatreonResourceIdentifier = z.infer<typeof resourceIdentifierSchema>;
type PatreonResource = z.infer<typeof resourceSchema>;

function resourceKey(identifier: PatreonResourceIdentifier): string {
  return `${identifier.type}:${identifier.id}`;
}

function indexIncludedResources(resources: PatreonResource[]): Map<string, PatreonResource> {
  return new Map(resources.map((resource) => [resourceKey(resource), resource]));
}

function getRelationshipIdentifiers(resource: PatreonResource, relationshipName: string): PatreonResourceIdentifier[] {
  const relationshipData = resource.relationships?.[relationshipName]?.data;
  if (!relationshipData) {
    return [];
  }

  return Array.isArray(relationshipData) ? relationshipData : [relationshipData];
}

function getSingleRelationshipIdentifier(
  resource: PatreonResource,
  relationshipName: string,
): PatreonResourceIdentifier | null {
  const identifiers = getRelationshipIdentifiers(resource, relationshipName);
  return identifiers.length === 1 ? identifiers[0] : null;
}

function getStringAttribute(resource: PatreonResource, attributeName: string): string | null {
  const value = resource.attributes?.[attributeName];
  return typeof value === "string" && value.trim() ? value : null;
}

function getDateAttribute(resource: PatreonResource, attributeName: string): Date | null {
  const value = getStringAttribute(resource, attributeName);
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function membershipCancellation(resource: PatreonResource): boolean | undefined {
  const amount = resource.attributes?.will_pay_amount_cents;
  if (amount != null) return amount === 0;
  if (
    getStringAttribute(resource, "patron_status") === "former_patron" &&
    getStringAttribute(resource, "last_charge_status") === "Paid"
  )
    return true;
  return undefined;
}

function loadMembershipResources(
  identityResource: PatreonResource,
  includedResources: PatreonResource[],
): PatreonResource[] {
  const includedIndex = indexIncludedResources(includedResources);
  const relationshipMemberships = getRelationshipIdentifiers(identityResource, "memberships")
    .filter((identifier) => identifier.type === "member")
    .flatMap((identifier) => {
      const includedResource = includedIndex.get(resourceKey(identifier));
      return includedResource?.type === "member" ? [includedResource] : [];
    });

  return relationshipMemberships.length > 0
    ? relationshipMemberships
    : includedResources.filter((resource) => resource.type === "member");
}

function findTierConfigMatch(
  tierIds: string[],
  tiers: SupporterBillingConfig["tiers"],
): { tierKey: string; tierConfig: SupporterBillingTierConfig; patreonTierId: string } | null {
  const tierMatches = Object.entries(tiers).flatMap(([tierKey, tierConfig]) =>
    tierIds.flatMap((patreonTierId) =>
      tierConfig.patreonTierIds.includes(patreonTierId) ? [{ tierKey, tierConfig, patreonTierId }] : [],
    ),
  );

  if (tierMatches.length === 0) {
    return null;
  }

  return tierMatches.toSorted(
    (left, right) => right.tierConfig.monthlyBudgetMicros - left.tierConfig.monthlyBudgetMicros,
  )[0];
}

function resolvePatreonUsagePeriodDates(
  membershipResource: PatreonResource,
  now: Date,
  fallbackHours: number,
): {
  periodStart: Date;
  periodEnd: Date;
  source: EligiblePatreonSupporterSnapshot["periodDateSource"];
} {
  const lastChargeDate = getDateAttribute(membershipResource, "last_charge_date");
  const nextChargeDate = getDateAttribute(membershipResource, "next_charge_date");

  if (
    lastChargeDate &&
    nextChargeDate &&
    nextChargeDate.getTime() > lastChargeDate.getTime() &&
    nextChargeDate.getTime() > now.getTime()
  ) {
    return {
      periodStart: lastChargeDate,
      periodEnd: nextChargeDate,
      source: "patreon",
    };
  }

  if (nextChargeDate && nextChargeDate.getTime() > now.getTime()) {
    return {
      periodStart: now,
      periodEnd: nextChargeDate,
      source: "patreon_next_charge",
    };
  }

  return {
    periodStart: now,
    periodEnd: new Date(now.getTime() + fallbackHours * 60 * 60 * 1000),
    source: "fallback",
  };
}

export function mapPatreonIdentityToEligibleSupporter(params: {
  discordUserId: string;
  config: SupporterBillingConfig;
  identityResponse: unknown;
  now: Date;
  fallbackHours: number;
}): PatreonMembershipMappingResult {
  const parsedResponse = identityResponseSchema.safeParse(params.identityResponse);
  if (!parsedResponse.success || parsedResponse.data.data.type !== "user") {
    return { eligible: false, reason: "invalid_payload" };
  }

  const identityResource = parsedResponse.data.data;
  const includedResources = parsedResponse.data.included ?? [];
  const memberships = loadMembershipResources(identityResource, includedResources);
  if (memberships.length === 0) {
    return { eligible: false, reason: "unlinked_membership" };
  }

  const membershipsWithCampaign = memberships.flatMap((membership) => {
    const campaignIdentifier = getSingleRelationshipIdentifier(membership, "campaign");
    return campaignIdentifier?.type === "campaign" ? [{ membership, campaignId: campaignIdentifier.id }] : [];
  });
  if (membershipsWithCampaign.length === 0) {
    return { eligible: false, reason: "invalid_payload" };
  }

  const campaignMembership = membershipsWithCampaign.find(
    ({ campaignId }) => campaignId === params.config.patreon.campaignId,
  );
  if (!campaignMembership) {
    return { eligible: false, reason: "wrong_campaign" };
  }

  const patronStatus = getStringAttribute(campaignMembership.membership, "patron_status");
  const chargeStatus = getStringAttribute(campaignMembership.membership, "last_charge_status");
  const cancelAtPeriodEnd = membershipCancellation(campaignMembership.membership);
  if (
    (patronStatus !== "active_patron" && !(cancelAtPeriodEnd && patronStatus === "former_patron")) ||
    (chargeStatus !== null && chargeStatus !== "Paid")
  ) {
    return { eligible: false, reason: "inactive" };
  }

  const entitledTierIds = getRelationshipIdentifiers(campaignMembership.membership, "currently_entitled_tiers").flatMap(
    (tierIdentifier) => (tierIdentifier.type === "tier" ? [tierIdentifier.id] : []),
  );
  if (entitledTierIds.length === 0) {
    return { eligible: false, reason: "inactive" };
  }

  const tierMatch = findTierConfigMatch(entitledTierIds, params.config.tiers);
  if (!tierMatch) {
    return { eligible: false, reason: "unconfigured_tier" };
  }

  const periodDates = resolvePatreonUsagePeriodDates(campaignMembership.membership, params.now, params.fallbackHours);
  if (cancelAtPeriodEnd && periodDates.source === "fallback") return { eligible: false, reason: "inactive" };

  return {
    eligible: true,
    snapshot: {
      discordUserId: params.discordUserId,
      patreonUserId: identityResource.id,
      patreonMemberId: campaignMembership.membership.id,
      patreonCampaignId: campaignMembership.campaignId,
      tierKey: tierMatch.tierKey,
      patreonTierId: tierMatch.patreonTierId,
      patronStatus,
      cancelAtPeriodEnd,
      periodStart: periodDates.periodStart,
      periodEnd: periodDates.periodEnd,
      periodDateSource: periodDates.source,
      lastSuccessfulChargeAt: successfulChargeAt(campaignMembership.membership, params.now),
      nextChargeAt: periodDates.source === "fallback" ? null : periodDates.periodEnd,
    },
  };
}

export function mapPatreonMemberPayloadToSupporterState(params: {
  config: SupporterBillingConfig;
  memberResponse: unknown;
  now: Date;
  fallbackHours: number;
  forceInactiveReason?: PatreonMemberInactiveReason;
  cancelAtPeriodEnd?: boolean;
}): PatreonMemberStateMappingResult {
  const parsedResponse = memberResponseSchema.safeParse(params.memberResponse);
  if (!parsedResponse.success || parsedResponse.data.data.type !== "member") {
    return { valid: false, reason: "invalid_payload" };
  }

  const membershipResource = parsedResponse.data.data;
  const campaignIdentifier = getSingleRelationshipIdentifier(membershipResource, "campaign");
  const userIdentifier = getSingleRelationshipIdentifier(membershipResource, "user");
  if (campaignIdentifier?.type !== "campaign" || userIdentifier?.type !== "user") {
    return { valid: false, reason: "invalid_payload" };
  }

  if (campaignIdentifier.id !== params.config.patreon.campaignId) {
    return { valid: false, reason: "wrong_campaign" };
  }

  const patronStatus =
    params.forceInactiveReason === "deleted"
      ? "deleted"
      : (getStringAttribute(membershipResource, "patron_status") ?? "unknown");
  const entitledTierIds = getRelationshipIdentifiers(membershipResource, "currently_entitled_tiers").flatMap(
    (tierIdentifier) => (tierIdentifier.type === "tier" ? [tierIdentifier.id] : []),
  );
  const tierMatch = findTierConfigMatch(entitledTierIds, params.config.tiers);
  const cancelAtPeriodEnd = params.cancelAtPeriodEnd ?? membershipCancellation(membershipResource);
  const chargeStatus = getStringAttribute(membershipResource, "last_charge_status");
  const inactiveReason =
    params.forceInactiveReason ??
    ((patronStatus !== "active_patron" && !(cancelAtPeriodEnd && patronStatus === "former_patron")) ||
    (chargeStatus !== null && chargeStatus !== "Paid")
      ? "inactive"
      : entitledTierIds.length === 0
        ? cancelAtPeriodEnd
          ? "cancelled"
          : "no_entitled_tier"
        : tierMatch
          ? null
          : "unconfigured_tier");

  if (inactiveReason || !tierMatch) {
    return {
      valid: true,
      snapshot: {
        patreonUserId: userIdentifier.id,
        patreonMemberId: membershipResource.id,
        patreonCampaignId: campaignIdentifier.id,
        patronStatus,
        cancelAtPeriodEnd,
        tierKey: tierMatch?.tierKey ?? null,
        patreonTierId: tierMatch?.patreonTierId ?? null,
        periodStart: null,
        periodEnd: null,
        periodDateSource: "none",
        isActive: false,
        inactiveReason,
        lastSuccessfulChargeAt: successfulChargeAt(membershipResource, params.now),
        nextChargeAt: null,
      },
    };
  }

  const periodDates = resolvePatreonUsagePeriodDates(membershipResource, params.now, params.fallbackHours);

  return {
    valid: true,
    snapshot: {
      patreonUserId: userIdentifier.id,
      patreonMemberId: membershipResource.id,
      patreonCampaignId: campaignIdentifier.id,
      patronStatus,
      cancelAtPeriodEnd,
      tierKey: tierMatch.tierKey,
      patreonTierId: tierMatch.patreonTierId,
      periodStart: periodDates.periodStart,
      periodEnd: periodDates.periodEnd,
      periodDateSource: periodDates.source,
      isActive: true,
      inactiveReason: null,
      lastSuccessfulChargeAt: successfulChargeAt(membershipResource, params.now),
      nextChargeAt: periodDates.source === "fallback" ? null : periodDates.periodEnd,
    },
  };
}

function successfulChargeAt(resource: PatreonResource, now: Date): Date | null {
  const date = getDateAttribute(resource, "last_charge_date");
  return getStringAttribute(resource, "last_charge_status") === "Paid" && date && date <= now ? date : null;
}
