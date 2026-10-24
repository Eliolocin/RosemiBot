import { OpenRouter } from "@openrouter/sdk";
import { HTTPClient, type Fetcher } from "@openrouter/sdk/lib/http";
import { z } from "zod";

const MANAGEMENT_TIMEOUT_MS = 15_000;
const KEY_LIST_PAGE_SIZE = 100;
export const MICROS_PER_DOLLAR = 1_000_000;
const keyMetadataSchema = z.object({
  hash: z.string().min(1),
  name: z.string(),
  disabled: z.boolean(),
  usage: z.number().finite().nonnegative(),
  limit: z.number().finite().nonnegative().nullable(),
});

export type MemberKeyMetadata = z.infer<typeof keyMetadataSchema>;
export function normalizeMemberKeyLimit(limit: number): number {
  return Math.round(limit * MICROS_PER_DOLLAR) / MICROS_PER_DOLLAR;
}
export interface MemberKeyProvider {
  create(name: string): Promise<{ hash: string; key: string }>;
  findByName(name: string): Promise<MemberKeyMetadata[]>;
  get(hash: string): Promise<MemberKeyMetadata | null>;
  update(hash: string, values: { disabled: boolean; limit?: number }): Promise<void>;
  delete(hash: string): Promise<void>;
}

export class MemberKeyError extends Error {
  constructor() {
    super(
      "Supporter member-key operation failed; retry reconciliation after checking provider and storage availability",
    );
    this.name = "MemberKeyError";
  }
}

export function createMemberKeyProvider(
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetchImpl: Fetcher = fetch,
): MemberKeyProvider {
  const apiKey = env.TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY?.trim();
  if (!apiKey) throw new MemberKeyError();
  const sdk = new OpenRouter({
    apiKey,
    timeoutMs: MANAGEMENT_TIMEOUT_MS,
    retryConfig: { strategy: "none" },
    // Suppress SDK debug output because create responses contain plaintext member credentials.
    debugLogger: { group: () => {}, groupEnd: () => {}, log: () => {} },
    httpClient: new HTTPClient({ fetcher: (input, init) => fetchImpl(input, { ...init, redirect: "error" }) }),
  });
  async function guarded<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      throw new MemberKeyError();
    }
  }
  function isMissing(error: unknown): boolean {
    return error instanceof Error && "statusCode" in error && error.statusCode === 404;
  }
  return {
    create: (name) =>
      guarded(async () => {
        const result = await sdk.apiKeys.create({ name, limit: 0, limitReset: null, includeByokInLimit: true });
        const metadata = keyMetadataSchema.parse(result.data);
        const key = z.string().min(1).parse(result.key);
        if (metadata.limit !== 0 || metadata.usage !== 0 || metadata.name !== name) throw new MemberKeyError();
        return { hash: metadata.hash, key };
      }),
    findByName: (name) =>
      guarded(async () => {
        const matches: MemberKeyMetadata[] = [];
        for (let offset = 0; ; offset += KEY_LIST_PAGE_SIZE) {
          const page = await sdk.apiKeys.list({ offset: String(offset), includeDisabled: "true" });
          const keys = z.array(keyMetadataSchema).parse(page.data);
          matches.push(...keys.filter((key) => key.name === name));
          if (keys.length < KEY_LIST_PAGE_SIZE) return matches;
        }
      }),
    get: (hash) =>
      guarded(async () => {
        try {
          const key = keyMetadataSchema.parse((await sdk.apiKeys.get({ hash })).data);
          if (key.hash !== hash) throw new MemberKeyError();
          return key;
        } catch (error) {
          if (isMissing(error)) return null;
          throw error;
        }
      }),
    update: (hash, values) =>
      guarded(async () => {
        const limit = values.limit === undefined ? undefined : normalizeMemberKeyLimit(values.limit);
        const key = keyMetadataSchema.parse(
          (
            await sdk.apiKeys.update({
              hash,
              requestBody: {
                ...values,
                limit,
                limitReset: null,
                includeByokInLimit: true,
              },
            })
          ).data,
        );
        if (
          key.hash !== hash ||
          key.disabled !== values.disabled ||
          (limit !== undefined &&
            (key.limit === null ||
              Math.abs(key.limit - limit) > Number.EPSILON * Math.max(1, Math.abs(limit), Math.abs(key.limit))))
        )
          throw new MemberKeyError();
      }),
    delete: (hash) =>
      guarded(async () => {
        try {
          await sdk.apiKeys.delete({ hash });
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
      }),
  };
}
