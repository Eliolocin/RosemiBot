import {
  supporterEntitlementRepository,
  supporterIdentityRepository,
  supporterSponsorshipRepository,
  isSupporterEntitlementActive,
} from "@/modules/supporter-billing/db";
import type {
  SponsoredServerSummary,
  SubscribePanelDependencies,
  SubscribePanelState,
  SubscribeSponsorshipRepository,
} from "@/modules/supporter-billing/subscribe/types";

async function loadSponsoredServers(
  sponsorshipRepository: SubscribeSponsorshipRepository,
  sponsorIdentityId: number,
  resolveServerLabel?: (serverDiscId: string) => string,
  resolveServerIcon?: (serverDiscId: string) => string | null,
): Promise<SponsoredServerSummary[]> {
  const sponsorships = await sponsorshipRepository.loadActiveSponsorshipsForSponsorIdentity(sponsorIdentityId);

  return sponsorships.map((sponsorship) => {
    const resolvedLabel = resolveServerLabel?.(sponsorship.server_disc_id)?.trim();
    return {
      sponsorshipId: sponsorship.sponsorship_id,
      serverId: sponsorship.server_id,
      serverDiscId: sponsorship.server_disc_id,
      label: resolvedLabel || sponsorship.server_disc_id,
      iconUrl: resolveServerIcon?.(sponsorship.server_disc_id),
    };
  });
}

export async function loadSubscribePanelState(
  discordUserId: string,
  dependencies: SubscribePanelDependencies = {},
  at: Date = new Date(),
): Promise<SubscribePanelState> {
  const identityRepository = dependencies.identityRepository ?? supporterIdentityRepository;
  const entitlementRepository = dependencies.entitlementRepository ?? supporterEntitlementRepository;
  const sponsorshipRepository = dependencies.sponsorshipRepository ?? supporterSponsorshipRepository;

  try {
    const identity = await identityRepository.loadByDiscordUserId(discordUserId);
    if (!identity) {
      return { kind: "unlinked" };
    }

    const entitlement = await entitlementRepository.loadByIdentityId(identity.supporter_identity_id);
    if (!entitlement) {
      return {
        kind: "error",
        reason: "inconsistent",
      };
    }

    const sponsoredServers = await loadSponsoredServers(
      sponsorshipRepository,
      identity.supporter_identity_id,
      dependencies.resolveServerLabel,
      dependencies.resolveServerIcon,
    );

    if (!isSupporterEntitlementActive(entitlement, at)) {
      return {
        kind: "inactive",
        identity,
        entitlement,
        sponsoredServers,
      };
    }

    return {
      kind: "active",
      identity,
      entitlement,
      sponsoredServers,
    };
  } catch {
    return {
      kind: "error",
      reason: "unavailable",
    };
  }
}
