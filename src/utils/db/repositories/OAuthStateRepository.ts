import type { SQL } from "bun";
import { z } from "zod";
import { sql as defaultSql } from "@/utils/db/client";
import type { OAuthStateNonceRepository } from "@/utils/oauth/state";

const rowSchema = z.object({
  oauth_state_id: z.coerce.number().int().positive(),
  nonce_hash: z.string().min(1),
  flow: z.string().min(1),
  subject: z.string().min(1),
  expires_at: z.coerce.date(),
  consumed_at: z.coerce.date().nullable(),
  created_at: z.coerce.date(),
});
export type OAuthStateRow = z.infer<typeof rowSchema>;

export class OAuthStateRepository implements OAuthStateNonceRepository {
  constructor(private readonly client: SQL = defaultSql) {}

  async recordStateNonce(params: Parameters<OAuthStateNonceRepository["recordStateNonce"]>[0]): Promise<OAuthStateRow> {
    const [row] = await this.client`
      INSERT INTO oauth_states (nonce_hash, flow, subject, expires_at, created_at)
      VALUES (${params.nonceHash}, ${params.flow}, ${params.subject}, ${params.expiresAt}, ${params.createdAt ?? new Date()})
      RETURNING *
    `;
    return rowSchema.parse(row);
  }

  async consumeStateNonce(
    params: Parameters<OAuthStateNonceRepository["consumeStateNonce"]>[0],
  ): Promise<OAuthStateRow | null> {
    const now = params.consumedAt ?? new Date();
    const [row] = await this.client`
      UPDATE oauth_states SET consumed_at = ${now}
      WHERE nonce_hash = ${params.nonceHash} AND flow = ${params.flow} AND subject = ${params.subject}
        AND consumed_at IS NULL AND expires_at > ${now}
      RETURNING *
    `;
    return row ? rowSchema.parse(row) : null;
  }

  async purgeFinishedStates(cutoff: Date = new Date()): Promise<{ purgedStates: number }> {
    const rows = await this.client`
      DELETE FROM oauth_states WHERE expires_at <= ${cutoff} OR consumed_at <= ${cutoff}
      RETURNING oauth_state_id
    `;
    return { purgedStates: rows.length };
  }
}

export const oauthStateRepository = new OAuthStateRepository();
