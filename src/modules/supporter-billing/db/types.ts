import { z } from "zod";

const nonEmptyStringSchema = z.string().trim().min(1);
const integerSchema = z.coerce.number().int();
const timestampSchema = z.coerce.date();
const nullableTimestampSchema = z.preprocess((value) => (value == null ? null : value), timestampSchema.nullable());
const nullableNonEmptyStringSchema = z.preprocess(
  (value) => (value == null ? null : value),
  nonEmptyStringSchema.nullable(),
);

const SUPPORTER_ENTITLEMENT_SOURCES = ["oauth", "webhook", "reconcile", "manual_admin"] as const;
const SUPPORTER_SPONSORSHIP_STATUSES = ["active", "revoked", "inactive_entitlement", "exhausted", "replaced"] as const;
const SUPPORTER_WEBHOOK_EVENT_STATUSES = ["received", "processed", "failed", "ignored"] as const;
export const supporterIdentitySchema = z.object({
  supporter_identity_id: integerSchema.positive(),
  discord_user_id: nonEmptyStringSchema,
  patreon_user_id: nonEmptyStringSchema,
  patreon_member_id: nonEmptyStringSchema,
  patreon_campaign_id: nonEmptyStringSchema,
  linked_at: timestampSchema,
  last_oauth_at: timestampSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type SupporterIdentityRow = z.infer<typeof supporterIdentitySchema>;

export const supporterEntitlementSchema = z.object({
  supporter_entitlement_id: integerSchema.positive(),
  supporter_identity_id: integerSchema.positive(),
  tier_key: nonEmptyStringSchema,
  patreon_tier_id: nonEmptyStringSchema,
  patron_status: nonEmptyStringSchema,
  is_active: z.boolean(),
  cancel_at_period_end: z.boolean(),
  period_start: nullableTimestampSchema,
  period_end: nullableTimestampSchema,
  last_verified_at: timestampSchema,
  last_successful_charge_at: nullableTimestampSchema,
  next_charge_at: nullableTimestampSchema,
  source: z.enum(SUPPORTER_ENTITLEMENT_SOURCES),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type SupporterEntitlementRow = z.infer<typeof supporterEntitlementSchema>;
export type SupporterEntitlementSource = z.infer<typeof supporterEntitlementSchema.shape.source>;

export function isSupporterEntitlementActive(
  entitlement: Pick<SupporterEntitlementRow, "is_active" | "period_start" | "period_end">,
  at: Date = new Date(),
): boolean {
  return (
    entitlement.is_active &&
    (!entitlement.period_start || entitlement.period_start <= at) &&
    (!entitlement.period_end || entitlement.period_end > at)
  );
}

export const supporterServerSponsorshipSchema = z.object({
  sponsorship_id: integerSchema.positive(),
  server_id: integerSchema.positive(),
  server_disc_id: nonEmptyStringSchema,
  sponsor_identity_id: integerSchema.positive(),
  status: z.enum(SUPPORTER_SPONSORSHIP_STATUSES),
  created_by_disc_id: nonEmptyStringSchema,
  created_at: timestampSchema,
  revoked_at: nullableTimestampSchema,
  updated_at: timestampSchema,
});
export type SupporterServerSponsorshipRow = z.infer<typeof supporterServerSponsorshipSchema>;

export const supporterWebhookEventSchema = z.object({
  webhook_event_id: integerSchema.positive(),
  patreon_event_id: nullableNonEmptyStringSchema,
  event_type: nonEmptyStringSchema,
  received_at: timestampSchema,
  processed_at: nullableTimestampSchema,
  status: z.enum(SUPPORTER_WEBHOOK_EVENT_STATUSES),
  error_message: nullableNonEmptyStringSchema,
  idempotency_key: nonEmptyStringSchema,
  payload_hash: nonEmptyStringSchema,
});
export type SupporterWebhookEventRow = z.infer<typeof supporterWebhookEventSchema>;
export type SupporterWebhookEventStatus = z.infer<typeof supporterWebhookEventSchema.shape.status>;
