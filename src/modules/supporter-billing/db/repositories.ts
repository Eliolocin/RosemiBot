import { SUPPORTER_CAPABILITIES, type SupporterBillingConfig } from "@/modules/supporter-billing/config";
import { z } from "zod";
import { keyManager } from "@/utils/security/keyManager";
import type { OAuthTokenStore } from "@/utils/oauth/refreshCoordinator";
import type { SQL } from "bun";
import { sql as defaultSql } from "@/utils/db/client";
import {
  supporterEntitlementSchema,
  supporterIdentitySchema,
  supporterServerSponsorshipSchema,
  supporterWebhookEventSchema,
  type SupporterEntitlementRow,
  type SupporterEntitlementSource,
  type SupporterIdentityRow,
  type SupporterServerSponsorshipRow,
  type SupporterWebhookEventRow,
  type SupporterWebhookEventStatus,
} from "@/modules/supporter-billing/db/types";

export interface UpsertSupporterIdentityParams {
  discordUserId: string;
  patreonUserId: string;
  patreonMemberId: string;
  patreonCampaignId: string;
  linkedAt?: Date;
  lastOauthAt?: Date;
}

export interface UpdateSupporterIdentityPatreonSnapshotParams {
  supporterIdentityId: number;
  patreonUserId: string;
  patreonMemberId: string;
  patreonCampaignId: string;
}

export interface UpsertSupporterEntitlementParams {
  supporterIdentityId: number;
  tierKey: string;
  patreonTierId: string;
  patronStatus: string;
  isActive: boolean;
  cancelAtPeriodEnd?: boolean;
  periodStart: Date | null;
  periodEnd: Date | null;
  lastVerifiedAt: Date;
  lastSuccessfulChargeAt?: Date | null;
  nextChargeAt?: Date | null;
  source: SupporterEntitlementSource;
}

export interface WebhookEventPurgeResult {
  purgedEvents: number;
}

export interface StartActiveSponsorshipParams {
  serverId: number;
  serverDiscId: string;
  sponsorIdentityId: number;
  createdByDiscId: string;
  createdAt?: Date;
}

export interface RevokeActiveSponsorshipForSponsorParams {
  sponsorshipId: number;
  sponsorIdentityId: number;
  revokedAt?: Date;
}

export interface RevokeActiveSponsorshipParams {
  sponsorshipId: number;
  revokedAt?: Date;
}

export interface RevokeActiveSponsorshipForServerParams {
  serverId?: number;
  serverDiscId?: string;
  revokedAt?: Date;
}

export interface RecordWebhookEventParams {
  patreonEventId: string | null;
  eventType: string;
  idempotencyKey: string;
  payloadHash: string;
  receivedAt?: Date;
  status?: SupporterWebhookEventStatus;
}

export type RecordWebhookEventReceiptResult =
  | {
      status: "recorded";
      event: SupporterWebhookEventRow;
    }
  | {
      status: "duplicate";
      event: SupporterWebhookEventRow;
    };

function parseSupporterIdentity(row: unknown): SupporterIdentityRow {
  return supporterIdentitySchema.parse(row);
}

function parseSupporterEntitlement(row: unknown): SupporterEntitlementRow {
  return supporterEntitlementSchema.parse(row);
}

function parseSponsorship(row: unknown): SupporterServerSponsorshipRow {
  return supporterServerSponsorshipSchema.parse(row);
}

function parseWebhookEvent(row: unknown): SupporterWebhookEventRow {
  return supporterWebhookEventSchema.parse(row);
}

function assertPositiveInteger(value: number, fieldName: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
}

export class SupporterIdentityRepository {
  public constructor(private readonly client: SQL = defaultSql) {}

  async upsertIdentity(params: UpsertSupporterIdentityParams): Promise<SupporterIdentityRow> {
    const linkedAt = params.linkedAt ?? new Date();
    const lastOauthAt = params.lastOauthAt ?? linkedAt;

    const [row] = await this.client`
      INSERT INTO supporter_identities (
        discord_user_id,
        patreon_user_id,
        patreon_member_id,
        patreon_campaign_id,
        linked_at,
        last_oauth_at
      ) VALUES (
        ${params.discordUserId},
        ${params.patreonUserId},
        ${params.patreonMemberId},
        ${params.patreonCampaignId},
        ${linkedAt},
        ${lastOauthAt}
      )
      ON CONFLICT (discord_user_id) DO UPDATE SET
        patreon_user_id = EXCLUDED.patreon_user_id,
        patreon_member_id = EXCLUDED.patreon_member_id,
        patreon_campaign_id = EXCLUDED.patreon_campaign_id,
        last_oauth_at = EXCLUDED.last_oauth_at,
        updated_at = NOW()
      RETURNING
        supporter_identity_id,
        discord_user_id,
        patreon_user_id,
        patreon_member_id,
        patreon_campaign_id,
        linked_at,
        last_oauth_at,
        created_at,
        updated_at
    `;

    return parseSupporterIdentity(row);
  }

  async loadByDiscordUserId(discordUserId: string): Promise<SupporterIdentityRow | null> {
    const [row] = await this.client`
      SELECT
        supporter_identity_id,
        discord_user_id,
        patreon_user_id,
        patreon_member_id,
        patreon_campaign_id,
        linked_at,
        last_oauth_at,
        created_at,
        updated_at
      FROM supporter_identities
      WHERE discord_user_id = ${discordUserId}
    `;

    return row ? parseSupporterIdentity(row) : null;
  }

  async loadByUserId(userId: number): Promise<SupporterIdentityRow | null> {
    assertPositiveInteger(userId, "userId");
    const [row] = await this.client`
      SELECT identity.* FROM supporter_identities identity
      JOIN users ON users.user_disc_id = identity.discord_user_id
      WHERE users.user_id = ${userId}
    `;
    return row ? parseSupporterIdentity(row) : null;
  }

  async loadById(supporterIdentityId: number): Promise<SupporterIdentityRow | null> {
    assertPositiveInteger(supporterIdentityId, "supporterIdentityId");

    const [row] = await this.client`
      SELECT
        supporter_identity_id,
        discord_user_id,
        patreon_user_id,
        patreon_member_id,
        patreon_campaign_id,
        linked_at,
        last_oauth_at,
        created_at,
        updated_at
      FROM supporter_identities
      WHERE supporter_identity_id = ${supporterIdentityId}
    `;

    return row ? parseSupporterIdentity(row) : null;
  }

  async loadByPatreonMemberId(patreonMemberId: string): Promise<SupporterIdentityRow | null> {
    const [row] = await this.client`
      SELECT
        supporter_identity_id,
        discord_user_id,
        patreon_user_id,
        patreon_member_id,
        patreon_campaign_id,
        linked_at,
        last_oauth_at,
        created_at,
        updated_at
      FROM supporter_identities
      WHERE patreon_member_id = ${patreonMemberId}
    `;

    return row ? parseSupporterIdentity(row) : null;
  }

  async loadByPatreonUserIdAndCampaignId(
    patreonUserId: string,
    patreonCampaignId: string,
  ): Promise<SupporterIdentityRow | null> {
    const [row] = await this.client`
      SELECT
        supporter_identity_id,
        discord_user_id,
        patreon_user_id,
        patreon_member_id,
        patreon_campaign_id,
        linked_at,
        last_oauth_at,
        created_at,
        updated_at
      FROM supporter_identities
      WHERE patreon_user_id = ${patreonUserId}
        AND patreon_campaign_id = ${patreonCampaignId}
      ORDER BY updated_at DESC
      LIMIT 1
    `;

    return row ? parseSupporterIdentity(row) : null;
  }

  async listIdentitiesForPatreonReconcile(): Promise<SupporterIdentityRow[]> {
    const rows = await this.client`
      SELECT
        supporter_identity_id,
        discord_user_id,
        patreon_user_id,
        patreon_member_id,
        patreon_campaign_id,
        linked_at,
        last_oauth_at,
        created_at,
        updated_at
      FROM supporter_identities
      ORDER BY updated_at DESC, supporter_identity_id DESC
    `;

    return rows.map(parseSupporterIdentity);
  }

  async updatePatreonSnapshot(params: UpdateSupporterIdentityPatreonSnapshotParams): Promise<SupporterIdentityRow> {
    assertPositiveInteger(params.supporterIdentityId, "supporterIdentityId");

    const [row] = await this.client`
      UPDATE supporter_identities
      SET
        patreon_user_id = ${params.patreonUserId},
        patreon_member_id = ${params.patreonMemberId},
        patreon_campaign_id = ${params.patreonCampaignId},
        updated_at = NOW()
      WHERE supporter_identity_id = ${params.supporterIdentityId}
      RETURNING
        supporter_identity_id,
        discord_user_id,
        patreon_user_id,
        patreon_member_id,
        patreon_campaign_id,
        linked_at,
        last_oauth_at,
        created_at,
        updated_at
    `;

    return parseSupporterIdentity(row);
  }
}

export class SupporterEntitlementRepository {
  public constructor(private readonly client: SQL = defaultSql) {}

  async upsertSnapshot(params: UpsertSupporterEntitlementParams): Promise<SupporterEntitlementRow> {
    assertPositiveInteger(params.supporterIdentityId, "supporterIdentityId");

    const [row] = await this.client`
      INSERT INTO supporter_entitlements (
        supporter_identity_id,
        tier_key,
        patreon_tier_id,
        patron_status,
        is_active,
        cancel_at_period_end,
        period_start,
        period_end,
        last_verified_at,
        last_successful_charge_at,
        next_charge_at,
        source
      ) VALUES (
        ${params.supporterIdentityId},
        ${params.tierKey},
        ${params.patreonTierId},
        ${params.patronStatus},
        ${params.isActive},
        ${params.cancelAtPeriodEnd ?? false},
        ${params.periodStart},
        ${params.periodEnd},
        ${params.lastVerifiedAt},
        ${params.lastSuccessfulChargeAt ?? null},
        ${params.nextChargeAt ?? null},
        ${params.source}
      )
      ON CONFLICT (supporter_identity_id) DO UPDATE SET
        tier_key = EXCLUDED.tier_key,
        patreon_tier_id = EXCLUDED.patreon_tier_id,
        patron_status = EXCLUDED.patron_status,
        is_active = EXCLUDED.is_active,
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        period_start = EXCLUDED.period_start,
        period_end = EXCLUDED.period_end,
        last_verified_at = EXCLUDED.last_verified_at,
        last_successful_charge_at = EXCLUDED.last_successful_charge_at,
        next_charge_at = EXCLUDED.next_charge_at,
        source = EXCLUDED.source,
        updated_at = NOW()
      RETURNING
        supporter_entitlement_id,
        supporter_identity_id,
        tier_key,
        patreon_tier_id,
        patron_status,
        is_active,
        cancel_at_period_end,
        period_start,
        period_end,
        last_verified_at,
        last_successful_charge_at,
        next_charge_at,
        source,
        created_at,
        updated_at
    `;

    return parseSupporterEntitlement(row);
  }

  async loadByIdentityId(supporterIdentityId: number): Promise<SupporterEntitlementRow | null> {
    const [row] = await this.client`
      SELECT
        supporter_entitlement_id,
        supporter_identity_id,
        tier_key,
        patreon_tier_id,
        patron_status,
        is_active,
        cancel_at_period_end,
        period_start,
        period_end,
        last_verified_at,
        last_successful_charge_at,
        next_charge_at,
        source,
        created_at,
        updated_at
      FROM supporter_entitlements
      WHERE supporter_identity_id = ${supporterIdentityId}
    `;

    return row ? parseSupporterEntitlement(row) : null;
  }
}

export class SupporterSponsorshipRepository {
  public constructor(private readonly client: SQL = defaultSql) {}

  async loadActiveSponsorshipById(sponsorshipId: number): Promise<SupporterServerSponsorshipRow | null> {
    assertPositiveInteger(sponsorshipId, "sponsorshipId");

    const [row] = await this.client`
      SELECT
        sponsorship_id,
        server_id,
        server_disc_id,
        sponsor_identity_id,
        status,
        created_by_disc_id,
        created_at,
        revoked_at,
        updated_at
      FROM supporter_server_sponsorships
      WHERE sponsorship_id = ${sponsorshipId}
        AND status = 'active'
    `;

    return row ? parseSponsorship(row) : null;
  }

  async loadActiveSponsorshipForServer(serverId: number): Promise<SupporterServerSponsorshipRow | null> {
    const [row] = await this.client`
      SELECT
        sponsorship_id,
        server_id,
        server_disc_id,
        sponsor_identity_id,
        status,
        created_by_disc_id,
        created_at,
        revoked_at,
        updated_at
      FROM supporter_server_sponsorships
      WHERE server_id = ${serverId}
        AND status = 'active'
    `;

    return row ? parseSponsorship(row) : null;
  }

  async loadActiveSponsorshipsForSponsorIdentity(sponsorIdentityId: number): Promise<SupporterServerSponsorshipRow[]> {
    const rows = await this.client`
      SELECT
        sponsorship_id,
        server_id,
        server_disc_id,
        sponsor_identity_id,
        status,
        created_by_disc_id,
        created_at,
        revoked_at,
        updated_at
      FROM supporter_server_sponsorships
      WHERE sponsor_identity_id = ${sponsorIdentityId}
        AND status = 'active'
      ORDER BY created_at ASC, sponsorship_id ASC
    `;

    return rows.map(parseSponsorship);
  }

  async loadActiveSponsorshipForServerDiscId(serverDiscId: string): Promise<SupporterServerSponsorshipRow | null> {
    const [row] = await this.client`
      SELECT
        sponsorship_id,
        server_id,
        server_disc_id,
        sponsor_identity_id,
        status,
        created_by_disc_id,
        created_at,
        revoked_at,
        updated_at
      FROM supporter_server_sponsorships
      WHERE server_disc_id = ${serverDiscId}
        AND status = 'active'
      ORDER BY created_at DESC, sponsorship_id DESC
      LIMIT 1
    `;

    return row ? parseSponsorship(row) : null;
  }

  async startActiveSponsorship(params: StartActiveSponsorshipParams): Promise<SupporterServerSponsorshipRow> {
    assertPositiveInteger(params.serverId, "serverId");
    assertPositiveInteger(params.sponsorIdentityId, "sponsorIdentityId");

    const createdAt = params.createdAt ?? new Date();

    return await this.client.begin(async (tx: SQL) => {
      await tx`SELECT server_id FROM servers WHERE server_id = ${params.serverId} FOR UPDATE`;
      const active = await new SupporterSponsorshipRepository(tx).loadActiveSponsorshipForServer(params.serverId);
      if (active) {
        if (active.sponsor_identity_id !== params.sponsorIdentityId) throw new SponsorshipConflictError();
        return active;
      }

      const [row] = await tx`
        INSERT INTO supporter_server_sponsorships (
          server_id,
          server_disc_id,
          sponsor_identity_id,
          status,
          created_by_disc_id,
          created_at
        ) VALUES (
          ${params.serverId},
          ${params.serverDiscId},
          ${params.sponsorIdentityId},
          'active',
          ${params.createdByDiscId},
          ${createdAt}
        )
        RETURNING
          sponsorship_id,
          server_id,
          server_disc_id,
          sponsor_identity_id,
          status,
          created_by_disc_id,
          created_at,
          revoked_at,
          updated_at
      `;

      return parseSponsorship(row);
    });
  }

  async revokeActiveSponsorshipForSponsor(
    params: RevokeActiveSponsorshipForSponsorParams,
  ): Promise<SupporterServerSponsorshipRow | null> {
    assertPositiveInteger(params.sponsorshipId, "sponsorshipId");
    assertPositiveInteger(params.sponsorIdentityId, "sponsorIdentityId");

    const revokedAt = params.revokedAt ?? new Date();
    const [row] = await this.client`
      UPDATE supporter_server_sponsorships
      SET
        status = 'revoked',
        revoked_at = ${revokedAt},
        updated_at = NOW()
      WHERE sponsorship_id = ${params.sponsorshipId}
        AND sponsor_identity_id = ${params.sponsorIdentityId}
        AND status = 'active'
      RETURNING
        sponsorship_id,
        server_id,
        server_disc_id,
        sponsor_identity_id,
        status,
        created_by_disc_id,
        created_at,
        revoked_at,
        updated_at
    `;

    return row ? parseSponsorship(row) : null;
  }

  async revokeActiveSponsorship(params: RevokeActiveSponsorshipParams): Promise<SupporterServerSponsorshipRow | null> {
    assertPositiveInteger(params.sponsorshipId, "sponsorshipId");

    const revokedAt = params.revokedAt ?? new Date();
    const [row] = await this.client`
      UPDATE supporter_server_sponsorships
      SET
        status = 'revoked',
        revoked_at = ${revokedAt},
        updated_at = NOW()
      WHERE sponsorship_id = ${params.sponsorshipId}
        AND status = 'active'
      RETURNING
        sponsorship_id,
        server_id,
        server_disc_id,
        sponsor_identity_id,
        status,
        created_by_disc_id,
        created_at,
        revoked_at,
        updated_at
    `;

    return row ? parseSponsorship(row) : null;
  }

  async revokeActiveSponsorshipForServer(
    params: RevokeActiveSponsorshipForServerParams,
  ): Promise<SupporterServerSponsorshipRow | null> {
    if (params.serverId === undefined && !params.serverDiscId?.trim()) {
      throw new Error("serverId or serverDiscId is required");
    }
    if (params.serverId !== undefined) {
      assertPositiveInteger(params.serverId, "serverId");
    }

    const revokedAt = params.revokedAt ?? new Date();
    const rows =
      params.serverId !== undefined
        ? await this.client`
            UPDATE supporter_server_sponsorships
            SET
              status = 'revoked',
              revoked_at = ${revokedAt},
              updated_at = NOW()
            WHERE server_id = ${params.serverId}
              AND status = 'active'
            RETURNING
              sponsorship_id,
              server_id,
              server_disc_id,
              sponsor_identity_id,
              status,
              created_by_disc_id,
              created_at,
              revoked_at,
              updated_at
          `
        : await this.client`
            UPDATE supporter_server_sponsorships
            SET
              status = 'revoked',
              revoked_at = ${revokedAt},
              updated_at = NOW()
            WHERE server_disc_id = ${params.serverDiscId}
              AND status = 'active'
            RETURNING
              sponsorship_id,
              server_id,
              server_disc_id,
              sponsor_identity_id,
              status,
              created_by_disc_id,
              created_at,
              revoked_at,
              updated_at
          `;
    const [row] = rows;

    return row ? parseSponsorship(row) : null;
  }
}

export class SupporterWebhookEventRepository {
  public constructor(private readonly client: SQL = defaultSql) {}

  async recordReceipt(params: RecordWebhookEventParams): Promise<SupporterWebhookEventRow> {
    const result = await this.recordReceiptForProcessing(params);
    return result.event;
  }

  async recordReceiptForProcessing(params: RecordWebhookEventParams): Promise<RecordWebhookEventReceiptResult> {
    const receivedAt = params.receivedAt ?? new Date();
    const status = params.status ?? "received";

    const [row] = await this.client`
      INSERT INTO supporter_webhook_events (
        patreon_event_id,
        event_type,
        received_at,
        status,
        idempotency_key,
        payload_hash
      ) VALUES (
        ${params.patreonEventId},
        ${params.eventType},
        ${receivedAt},
        ${status},
        ${params.idempotencyKey},
        ${params.payloadHash}
      )
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING
        webhook_event_id,
        patreon_event_id,
        event_type,
        received_at,
        processed_at,
        status,
        error_message,
        idempotency_key,
        payload_hash
    `;

    if (row) {
      return {
        status: "recorded",
        event: parseWebhookEvent(row),
      };
    }

    const duplicateEvent = await this.loadByIdempotencyKey(params.idempotencyKey);
    if (!duplicateEvent) {
      throw new Error("Webhook idempotency conflict did not return an existing event");
    }

    return {
      status: "duplicate",
      event: duplicateEvent,
    };
  }

  async loadByIdempotencyKey(idempotencyKey: string): Promise<SupporterWebhookEventRow | null> {
    const [row] = await this.client`
      SELECT
        webhook_event_id,
        patreon_event_id,
        event_type,
        received_at,
        processed_at,
        status,
        error_message,
        idempotency_key,
        payload_hash
      FROM supporter_webhook_events
      WHERE idempotency_key = ${idempotencyKey}
    `;

    return row ? parseWebhookEvent(row) : null;
  }

  async markProcessed(
    webhookEventId: number,
    status: Exclude<SupporterWebhookEventStatus, "received">,
    errorMessage: string | null = null,
    processedAt: Date = new Date(),
  ): Promise<SupporterWebhookEventRow | null> {
    const [row] = await this.client`
      UPDATE supporter_webhook_events
      SET
        status = ${status},
        processed_at = ${processedAt},
        error_message = ${errorMessage}
      WHERE webhook_event_id = ${webhookEventId}
      RETURNING
        webhook_event_id,
        patreon_event_id,
        event_type,
        received_at,
        processed_at,
        status,
        error_message,
        idempotency_key,
        payload_hash
    `;

    return row ? parseWebhookEvent(row) : null;
  }

  /**
   * F9: bound growth of the webhook-event idempotency table. Each row is a duplicate-delivery
   * receipt, so `cutoff` MUST be well past Patreon's retry/replay window (default 30 days),
   * because deleting a row younger than that would let a replayed delivery re-process. Deletes by
   * `received_at` so the retention window is measured from intake.
   */
  async purgeAgedEvents(cutoff: Date): Promise<WebhookEventPurgeResult> {
    const rows = await this.client`
      DELETE FROM supporter_webhook_events
      WHERE received_at <= ${cutoff}
      RETURNING webhook_event_id
    `;

    return { purgedEvents: rows.length };
  }
}

export interface RecordSupporterUsageParams {
  supporterIdentityId: number;
  fundingScope: "personal" | "server";
  serverId: number | null;
  capability: string;
  modelCodename: string;
  costUsd: number;
  providerRequestId: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export class SponsorshipConflictError extends Error {
  constructor() {
    super("An active sponsorship must be removed before another sponsor can take over");
    this.name = "SponsorshipConflictError";
  }
}

const usageAggregateSchema = z.object({
  funding_scope: z.enum(["personal", "server"]),
  server_disc_id: z.string().nullable(),
  model_codename: z.string(),
  capability: z.enum(SUPPORTER_CAPABILITIES),
  cost_usd: z.number().finite().nonnegative(),
  generations: z.coerce.number().int().nonnegative(),
  input_tokens: z.coerce.number().int().nonnegative().nullable(),
  output_tokens: z.coerce.number().int().nonnegative().nullable(),
});
export type SupporterUsageAggregate = z.infer<typeof usageAggregateSchema>;

export class SupporterUsageStatisticsRepository {
  public constructor(private readonly client: SQL = defaultSql) {}

  async totalSince(supporterIdentityId: number, since: Date): Promise<number> {
    const [row] = await this.client<{ total: number }[]>`SELECT (
      COALESCE((SELECT SUM(cost_usd) FROM supporter_usage_statistics
        WHERE supporter_identity_id = ${supporterIdentityId} AND recorded_at >= ${since}), 0)
      + COALESCE((SELECT retained_cost FROM supporter_member_keys
        WHERE supporter_identity_id = ${supporterIdentityId} AND key_created_at >= ${since}), 0)
      )::float8 AS total`;
    return z.number().finite().nonnegative().parse(row?.total);
  }

  async aggregatePeriod(supporterIdentityId: number, start: Date, end: Date): Promise<SupporterUsageAggregate[]> {
    // Token totals intentionally omit missing counts so incomplete historical rows do not hide reported usage.
    const rows = await this.client<
      unknown[]
    >`SELECT usage.funding_scope, servers.server_disc_id, usage.model_codename, usage.capability,
      SUM(usage.cost_usd)::float8 AS cost_usd, COUNT(*) AS generations,
      SUM(usage.input_tokens) AS input_tokens,
      SUM(usage.output_tokens) AS output_tokens
      FROM supporter_usage_statistics usage LEFT JOIN servers ON servers.server_id = usage.server_id
      WHERE usage.supporter_identity_id = ${supporterIdentityId}
        AND usage.recorded_at >= ${start} AND usage.recorded_at < ${end}
      GROUP BY usage.funding_scope, servers.server_disc_id, usage.model_codename, usage.capability`;
    return rows.map((row) => usageAggregateSchema.parse(row));
  }

  async purgeAgedStatistics(cutoff: Date): Promise<number> {
    return this.client.begin(async (tx: SQL) => {
      await tx`SELECT member_key_id FROM supporter_member_keys ORDER BY member_key_id FOR UPDATE`;
      const [result] = await tx<{ count: number }[]>`WITH deleted AS (DELETE FROM supporter_usage_statistics usage
        WHERE usage.recorded_at < ${cutoff} AND NOT EXISTS (
          SELECT 1 FROM supporter_entitlements entitlement
          WHERE entitlement.supporter_identity_id = usage.supporter_identity_id
            AND entitlement.period_start IS NOT NULL AND entitlement.period_end IS NOT NULL
            AND usage.recorded_at >= entitlement.period_start AND usage.recorded_at < entitlement.period_end
            AND entitlement.period_end > NOW()
        ) RETURNING supporter_identity_id, cost_usd, recorded_at), retained AS (
          UPDATE supporter_member_keys keys SET retained_cost = retained_cost + (
            SELECT COALESCE(SUM(cost_usd), 0) FROM deleted
            WHERE supporter_identity_id = keys.supporter_identity_id AND recorded_at >= keys.key_created_at
          ) WHERE EXISTS (SELECT 1 FROM deleted WHERE supporter_identity_id = keys.supporter_identity_id)
        ) SELECT COUNT(*)::int AS count FROM deleted`;
      return result?.count ?? 0;
    });
  }

  /** @returns False when a row for the same provider request already exists. */
  async record(params: RecordSupporterUsageParams): Promise<boolean> {
    const rows = await this.client`
      INSERT INTO supporter_usage_statistics (
        supporter_identity_id,
        funding_scope,
        server_id,
        capability,
        model_codename,
        cost_usd,
        provider_request_id,
        input_tokens,
        output_tokens
      ) VALUES (
        ${params.supporterIdentityId},
        ${params.fundingScope},
        ${params.serverId},
        ${params.capability},
        ${params.modelCodename},
        ${params.costUsd},
        ${params.providerRequestId},
        ${params.inputTokens ?? null},
        ${params.outputTokens ?? null}
      )
      ON CONFLICT (provider_request_id) WHERE provider_request_id IS NOT NULL DO NOTHING
      RETURNING usage_statistic_id
    `;
    return rows.length > 0;
  }
}

export const supporterIdentityRepository = new SupporterIdentityRepository();
export const supporterEntitlementRepository = new SupporterEntitlementRepository();
export const supporterSponsorshipRepository = new SupporterSponsorshipRepository();
export const supporterWebhookEventRepository = new SupporterWebhookEventRepository();
export const supporterUsageStatisticsRepository = new SupporterUsageStatisticsRepository();

interface CreatorTokenRow {
  client_id: string;
  refresh_token: Buffer;
  refresh_token_key_version: number;
  access_token: Buffer | null;
  access_token_key_version: number | null;
  access_expires_at: Date | null;
  refresh_blocked_at: Date | null;
  refresh_retry_after: Date | null;
}

export function createPatreonCreatorTokenStore(options: {
  config: SupporterBillingConfig;
  env?: Readonly<Record<string, string | undefined>>;
  client?: SQL;
}): OAuthTokenStore {
  const env = options.env ?? process.env;
  const client = options.client ?? defaultSql;
  const campaignId = options.config.patreon.campaignId;
  const clientId = env[options.config.patreon.oauthClientIdEnv]?.trim();
  const clientSecret = env[options.config.patreon.oauthClientSecretEnv]?.trim();
  return {
    withLock: (operation) =>
      client.begin(async (tx) => {
        if (!clientId || !clientSecret) throw new Error("Patreon client credentials are unavailable.");
        const seed = env[options.config.patreon.creatorRefreshTokenEnv]?.trim();
        if (seed) {
          await tx`
          INSERT INTO supporter_patreon_creator_tokens (campaign_id, client_id, refresh_token, refresh_token_key_version)
          VALUES (${campaignId}, ${clientId}, pgp_sym_encrypt(${seed}, ${keyManager.getCurrentKey()}, 'compress-algo=1, cipher-algo=aes256'), ${keyManager.getCurrentVersion()})
          ON CONFLICT (campaign_id) DO NOTHING
        `;
        }
        return operation({
          load: async () => {
            const [row] = await tx<CreatorTokenRow[]>`
            SELECT * FROM supporter_patreon_creator_tokens WHERE campaign_id = ${campaignId} FOR UPDATE
          `;
            if (!row || row.client_id !== clientId) throw new Error("Patreon creator authorization is unavailable.");
            if (row.refresh_blocked_at) return null;
            const [credentials] = await tx<{ refresh_token: string; access_token: string | null }[]>`
            SELECT pgp_sym_decrypt(${row.refresh_token}, ${keyManager.getKey(row.refresh_token_key_version)}) AS refresh_token,
              CASE WHEN ${row.access_token}::bytea IS NULL THEN NULL
                ELSE pgp_sym_decrypt(${row.access_token}, ${keyManager.getKey(row.access_token_key_version ?? row.refresh_token_key_version)}) END AS access_token
          `;
            if (!credentials) throw new Error("Patreon creator token decryption failed.");
            return {
              refreshToken: credentials.refresh_token,
              accessToken: credentials.access_token,
              expiresAt: row.access_expires_at ? new Date(row.access_expires_at).getTime() : null,
              blocked: false,
              retryAt: row.refresh_retry_after ? new Date(row.refresh_retry_after).getTime() : null,
              authentication: { method: "body", clientId, clientSecret },
            };
          },
          persist: async (token, refreshToken, expiresAt) => {
            const key = keyManager.getCurrentKey();
            const version = keyManager.getCurrentVersion();
            await tx`
            UPDATE supporter_patreon_creator_tokens SET
              refresh_token = pgp_sym_encrypt(${refreshToken}, ${key}, 'compress-algo=1, cipher-algo=aes256'),
              refresh_token_key_version = ${version},
              access_token = pgp_sym_encrypt(${token.access_token}, ${key}, 'compress-algo=1, cipher-algo=aes256'),
              access_token_key_version = ${version}, access_expires_at = ${expiresAt},
              refresh_blocked_at = NULL, refresh_retry_after = NULL
            WHERE campaign_id = ${campaignId}
          `;
          },
          fail: async (error) => {
            await tx`
            UPDATE supporter_patreon_creator_tokens
            SET refresh_blocked_at = ${error.disposition === "blocked" ? new Date() : null},
              refresh_retry_after = ${error.disposition === "retry" ? error.retryAt : null}
            WHERE campaign_id = ${campaignId}
          `;
          },
        });
      }),
  };
}

export async function expirePatreonCreatorAccessToken(
  campaignId: string,
  rejectedToken: string,
  client: SQL = defaultSql,
): Promise<void> {
  await client.begin(async (tx) => {
    const [row] = await tx<CreatorTokenRow[]>`
      SELECT * FROM supporter_patreon_creator_tokens WHERE campaign_id = ${campaignId} FOR UPDATE
    `;
    if (!row?.access_token || row.access_token_key_version === null) return;
    const [stored] = await tx<{ value: string }[]>`
      SELECT pgp_sym_decrypt(${row.access_token}, ${keyManager.getKey(row.access_token_key_version)}) AS value
    `;
    if (stored?.value !== rejectedToken) return;
    await tx`
      UPDATE supporter_patreon_creator_tokens SET access_expires_at = NOW()
      WHERE campaign_id = ${campaignId}
    `;
  });
}

export async function replacePatreonCreatorAuthorization(
  campaignId: string,
  clientId: string,
  refreshToken: string,
  client: SQL = defaultSql,
): Promise<void> {
  await client`
    INSERT INTO supporter_patreon_creator_tokens (campaign_id, client_id, refresh_token, refresh_token_key_version)
    VALUES (${campaignId}, ${clientId}, pgp_sym_encrypt(${refreshToken}, ${keyManager.getCurrentKey()}, 'compress-algo=1, cipher-algo=aes256'), ${keyManager.getCurrentVersion()})
    ON CONFLICT (campaign_id) DO UPDATE SET client_id = EXCLUDED.client_id,
      refresh_token = EXCLUDED.refresh_token, refresh_token_key_version = EXCLUDED.refresh_token_key_version,
      access_token = NULL, access_token_key_version = NULL, access_expires_at = NULL,
      refresh_blocked_at = NULL, refresh_retry_after = NULL
  `;
}

export async function inspectPatreonCreatorAuthorization(
  campaignId: string,
  client: SQL = defaultSql,
): Promise<{
  access_expires_at: Date | null;
  refresh_blocked_at: Date | null;
  refresh_retry_after: Date | null;
} | null> {
  const [row] = await client<
    {
      access_expires_at: Date | null;
      refresh_blocked_at: Date | null;
      refresh_retry_after: Date | null;
    }[]
  >`
    SELECT access_expires_at, refresh_blocked_at, refresh_retry_after
    FROM supporter_patreon_creator_tokens WHERE campaign_id = ${campaignId}
  `;
  return row ?? null;
}
