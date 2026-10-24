import { z } from "zod";

const memberKeyResponseSchema = z.strictObject({
  hash: z.string().min(1),
  name: z.string(),
  label: z.string(),
  disabled: z.boolean(),
  limit: z.number().finite().nonnegative().nullable(),
  limit_remaining: z.number().finite().nullable(),
  limit_reset: z.string().nullable(),
  include_byok_in_limit: z.boolean(),
  usage: z.number().finite().nonnegative(),
  usage_daily: z.number().finite().nonnegative(),
  usage_weekly: z.number().finite().nonnegative(),
  usage_monthly: z.number().finite().nonnegative(),
  byok_usage: z.number().finite().nonnegative(),
  byok_usage_daily: z.number().finite().nonnegative(),
  byok_usage_weekly: z.number().finite().nonnegative(),
  byok_usage_monthly: z.number().finite().nonnegative(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime().nullable(),
});

export function createMemberKeyMetadata(overrides: Partial<z.infer<typeof memberKeyResponseSchema>> = {}) {
  return memberKeyResponseSchema.parse({
    hash: "synthetic-hash",
    name: "synthetic-operation",
    label: "synthetic-label",
    disabled: false,
    limit: 0,
    limit_remaining: 0,
    limit_reset: null,
    include_byok_in_limit: true,
    usage: 0,
    usage_daily: 0,
    usage_weekly: 0,
    usage_monthly: 0,
    byok_usage: 0,
    byok_usage_daily: 0,
    byok_usage_weekly: 0,
    byok_usage_monthly: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: null,
    ...overrides,
  });
}
