import type {
  SupporterEntitlementRow,
  SupporterIdentityRow,
  SupporterServerSponsorshipRow,
} from "@/modules/supporter-billing/db";

export interface SponsoredServerSummary {
  sponsorshipId: number;
  serverId: number;
  serverDiscId: string;
  label: string;
  iconUrl?: string | null;
}

interface SubscribeIdentityRepository {
  loadByDiscordUserId(discordUserId: string): Promise<SupporterIdentityRow | null>;
}

interface SubscribeEntitlementRepository {
  loadByIdentityId(supporterIdentityId: number): Promise<SupporterEntitlementRow | null>;
}

export interface SubscribeSponsorshipRepository {
  loadActiveSponsorshipsForSponsorIdentity(sponsorIdentityId: number): Promise<SupporterServerSponsorshipRow[]>;
}

export interface SubscribePanelDependencies {
  identityRepository?: SubscribeIdentityRepository;
  entitlementRepository?: SubscribeEntitlementRepository;
  sponsorshipRepository?: SubscribeSponsorshipRepository;
  resolveServerLabel?: (serverDiscId: string) => string;
  resolveServerIcon?: (serverDiscId: string) => string | null;
}

export type SubscribePanelState =
  | {
      kind: "unlinked";
    }
  | {
      kind: "inactive";
      identity: SupporterIdentityRow;
      entitlement: SupporterEntitlementRow;
      sponsoredServers: SponsoredServerSummary[];
    }
  | {
      kind: "active";
      identity: SupporterIdentityRow;
      entitlement: SupporterEntitlementRow;
      sponsoredServers: SponsoredServerSummary[];
    }
  | {
      kind: "error";
      reason: "inconsistent" | "unavailable";
    };
