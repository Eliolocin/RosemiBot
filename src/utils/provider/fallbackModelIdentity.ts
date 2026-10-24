import type { CustomEndpointRow, FallbackModelRef } from "@/types/db/schema";

type FallbackIdentityEndpoint = Pick<CustomEndpointRow, "custom_endpoint_id" | "model_ref_id">;

export function getFallbackModelRefKey(ref: FallbackModelRef): string {
  return `${ref.type}:${ref.id}${ref.type === "llm" && ref.credentialProvider === "supporter" ? ":supporter" : ""}`;
}

/** Returns every stored ref key that resolves to the active synthetic or catalog LLM. */
export function getPrimaryFallbackRefKeys(
  primaryLlmId: number | null | undefined,
  endpoints: Iterable<FallbackIdentityEndpoint> = [],
  credentialProvider?: string,
): Set<string> {
  const keys = new Set<string>();
  if (!primaryLlmId) return keys;

  keys.add(
    getFallbackModelRefKey({
      type: "llm",
      id: primaryLlmId,
      ...(credentialProvider === "supporter" ? { credentialProvider } : {}),
    }),
  );
  for (const endpoint of endpoints) {
    if (endpoint.model_ref_id === primaryLlmId && endpoint.custom_endpoint_id !== undefined) {
      keys.add(`custom_endpoint:${endpoint.custom_endpoint_id}`);
    }
  }

  return keys;
}

export function prunePrimaryFallbackRefs(
  refs: readonly FallbackModelRef[],
  primaryLlmId: number | null | undefined,
  endpoints: Iterable<FallbackIdentityEndpoint> = [],
  credentialProvider?: string,
): FallbackModelRef[] {
  const primaryKeys = getPrimaryFallbackRefKeys(primaryLlmId, endpoints, credentialProvider);
  return refs.filter((ref) => !primaryKeys.has(getFallbackModelRefKey(ref)));
}

export function buildFallbackModelPersistence(
  refs: readonly FallbackModelRef[],
  primaryLlmId: number | null | undefined,
  endpoints: Iterable<FallbackIdentityEndpoint> = [],
  credentialProvider?: string,
): { fallbackModelRefs: FallbackModelRef[]; fallbackLlmIds: number[] } {
  const fallbackModelRefs = prunePrimaryFallbackRefs(refs, primaryLlmId, endpoints, credentialProvider);
  const fallbackLlmIds = fallbackModelRefs.filter((ref) => ref.type === "llm").map((ref) => ref.id);
  return { fallbackModelRefs, fallbackLlmIds };
}
