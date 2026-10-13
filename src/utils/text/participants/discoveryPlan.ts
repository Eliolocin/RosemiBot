import type { TomoriState } from "@/types/db/schema";
import { isMessageProxyIdentityUserId } from "@/utils/messageProxy/identityUserId";
import { buildBridgeUserAliases, buildPersonaAliases, buildWebhookAliases } from "@/utils/text/participants/aliases";
import {
  createBotKey,
  createDiscordUserKey,
  createMatrixUserKey,
  createPersonaKey,
  createWebhookKey,
  mergeParticipantSeeds,
  serializeParticipantKey,
  type ParticipantAlias,
  type ParticipantCapability,
  type ParticipantInclusionReason,
  type ParticipantKey,
  type ParticipantSeed,
} from "@/utils/text/participants/identity";
import type { AliasReferenceDiagnostics } from "@/utils/text/participants/referenceDiscovery";

export interface ParticipantVisibleInput {
  participantIds: readonly string[];
  clientUserId?: string;
  activePersonaId?: number;
  activePersonaIsAlter?: boolean;
  syntheticUsers?: ReadonlyMap<string, { displayName: string; type: "persona" | "webhook" }>;
  matrixUsers?: ReadonlyMap<string, string>;
}

type ParticipantCandidateEvidenceSource =
  | "visible_author"
  | "active_identity"
  | "real_mention"
  | "unique_text_alias"
  | "historical_synthetic"
  | "historical_persona"
  | "co_responder"
  | "persona_trigger_reference"
  | "bridge_presence";

export type ParticipantDiscoveryRejectionReason =
  | "ineligible_state"
  | "bot"
  | "non_member"
  | "ambiguous_alias"
  | "existing_participant"
  | "blocked_source"
  | "missing_guild";

interface ParticipantCandidateEvidence {
  key: ParticipantKey;
  source: ParticipantCandidateEvidenceSource;
  firstSeenOrder: number;
}

export interface ParticipantDiscoveryRejection {
  reason: ParticipantDiscoveryRejectionReason;
  count: number;
}

export interface ParticipantDiscoveryPlan {
  seeds: readonly ParticipantSeed[];
  evidence: readonly ParticipantCandidateEvidence[];
  rejections: readonly ParticipantDiscoveryRejection[];
  aliasReferenceDiagnostics: AliasReferenceDiagnostics;
}

export interface DiscoveredParticipantCandidate {
  key: ParticipantKey;
  reasons: ReadonlySet<ParticipantInclusionReason>;
  aliases: readonly ParticipantAlias[];
  capabilities: ReadonlySet<ParticipantCapability>;
  sourceDisplayName?: string;
  evidenceSources: readonly ParticipantCandidateEvidenceSource[];
}

const EMPTY_ALIAS_DIAGNOSTICS: AliasReferenceDiagnostics = {
  evaluatedAliasCount: 0,
  acceptedAliasCount: 0,
  ambiguousAliasCount: 0,
  unmatchedAliasCount: 0,
};

function aliasesForSyntheticParticipant(
  key: ParticipantKey,
  displayName: string | undefined,
): readonly ParticipantAlias[] {
  if (!displayName) return [];
  if (key.kind === "persona") return [];
  if (key.kind === "webhook") return buildWebhookAliases({ owner: key, displayName });
  if (key.kind === "matrix_user") return buildBridgeUserAliases({ owner: key, displayName });
  return [];
}

export function parsePersonaId(value: string): number | null {
  const candidate = value.startsWith("persona:") ? value.slice("persona:".length) : value;
  if (!/^\d+$/u.test(candidate)) return null;
  const parsed = Number.parseInt(candidate, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function visibleParticipantIdentity(
  participantId: string,
  input: ParticipantVisibleInput,
): { key: ParticipantKey; sourceDisplayName?: string } {
  const normalizedId = participantId.trim();
  if (!normalizedId) throw new Error("Visible participant IDs must not be empty");

  const syntheticUser = input.syntheticUsers?.get(normalizedId);
  const isClientBot = input.clientUserId === normalizedId;
  if (isClientBot && syntheticUser) {
    throw new Error(`Visible participant ${normalizedId} cannot be both the active bot and a synthetic user`);
  }
  if (isClientBot) {
    return input.activePersonaIsAlter && input.activePersonaId !== undefined
      ? { key: createPersonaKey(input.activePersonaId) }
      : { key: createBotKey(normalizedId) };
  }
  if (syntheticUser?.type === "persona") {
    const personaId = parsePersonaId(normalizedId);
    if (personaId === null) {
      throw new Error(`Synthetic persona key ${normalizedId} does not contain a valid persona ID`);
    }
    return { key: createPersonaKey(personaId), sourceDisplayName: syntheticUser.displayName };
  }
  // A stable proxy identity arrives through a webhook but owns a real user row, so its kind comes
  // from the ID, never from a webhook entry a caller happened to record for it.
  if (syntheticUser?.type === "webhook" && !isMessageProxyIdentityUserId(normalizedId)) {
    return { key: createWebhookKey(normalizedId), sourceDisplayName: syntheticUser.displayName };
  }

  const participantPersonaId = parsePersonaId(normalizedId);
  if (input.activePersonaId !== undefined && participantPersonaId === input.activePersonaId) {
    return { key: createPersonaKey(input.activePersonaId) };
  }
  return { key: createDiscordUserKey(normalizedId) };
}

export function discoverVisibleAuthorCandidates(input: ParticipantVisibleInput): DiscoveredParticipantCandidate[] {
  return input.participantIds.map((participantId) => {
    const { key, sourceDisplayName } = visibleParticipantIdentity(participantId, input);
    const reasons = new Set<ParticipantInclusionReason>(
      key.kind === "bot" || (key.kind === "persona" && key.personaId === input.activePersonaId)
        ? ["active_identity"]
        : key.kind === "persona"
          ? ["historical_persona"]
          : ["visible_author"],
    );
    return {
      key,
      reasons,
      aliases: aliasesForSyntheticParticipant(key, sourceDisplayName),
      capabilities: new Set(key.kind === "discord_user" ? ["mentionable"] : []),
      ...(sourceDisplayName && { sourceDisplayName }),
      evidenceSources: reasons.has("active_identity") ? ["active_identity"] : ["visible_author"],
    };
  });
}

export function discoverHistoricalSyntheticCandidates(
  syntheticUsers: ParticipantVisibleInput["syntheticUsers"],
): DiscoveredParticipantCandidate[] {
  return [...(syntheticUsers ?? [])].flatMap(([participantId, syntheticUser]) => {
    if (isMessageProxyIdentityUserId(participantId)) return [];
    const personaId = syntheticUser.type === "persona" ? parsePersonaId(participantId) : null;
    if (syntheticUser.type === "persona" && personaId === null) {
      throw new Error(`Synthetic persona key ${participantId} does not contain a valid persona ID`);
    }
    const key = personaId === null ? createWebhookKey(participantId) : createPersonaKey(personaId);
    return [
      {
        key,
        reasons: new Set<ParticipantInclusionReason>([
          key.kind === "persona" ? "historical_persona" : "visible_author",
        ]),
        aliases: aliasesForSyntheticParticipant(key, syntheticUser.displayName),
        capabilities: new Set<ParticipantCapability>(),
        sourceDisplayName: syntheticUser.displayName,
        evidenceSources: [key.kind === "persona" ? "historical_persona" : "historical_synthetic"],
      } satisfies DiscoveredParticipantCandidate,
    ];
  });
}

export function discoverBridgeCandidates(
  matrixUsers: ParticipantVisibleInput["matrixUsers"],
): DiscoveredParticipantCandidate[] {
  return [...(matrixUsers ?? [])].map(([matrixId, displayName]) => {
    const key = createMatrixUserKey(matrixId);
    return {
      key,
      reasons: new Set<ParticipantInclusionReason>(["bridge_presence"]),
      aliases: aliasesForSyntheticParticipant(key, displayName),
      capabilities: new Set(),
      sourceDisplayName: displayName,
      evidenceSources: ["bridge_presence"],
    };
  });
}

export function discoverPersonaReferenceCandidates(
  personas: readonly TomoriState[],
  personaReasons: ReadonlyMap<number, ReadonlySet<ParticipantInclusionReason>>,
): DiscoveredParticipantCandidate[] {
  const candidates: DiscoveredParticipantCandidate[] = [];
  for (const persona of personas) {
    if (typeof persona.persona_id !== "number") continue;
    const reasons = personaReasons.get(persona.persona_id);
    if (!reasons || reasons.size === 0) continue;
    const evidenceSources = [...reasons].flatMap((reason): ParticipantCandidateEvidenceSource[] => {
      if (reason === "historical_persona") return ["historical_persona"];
      if (reason === "co_responder") return ["co_responder"];
      if (reason === "persona_trigger_reference") return ["persona_trigger_reference"];
      return [];
    });
    candidates.push({
      key: { kind: "persona", personaId: persona.persona_id },
      reasons,
      aliases: buildPersonaAliases({
        owner: { kind: "persona", personaId: persona.persona_id },
        nickname: persona.persona_nickname,
        triggerWords: persona.trigger_words,
      }).aliases,
      capabilities: new Set(),
      sourceDisplayName: persona.persona_nickname,
      evidenceSources,
    });
  }
  return candidates;
}

export function buildParticipantDiscoveryPlan(params: {
  candidates: readonly DiscoveredParticipantCandidate[];
  rejections?: readonly ParticipantDiscoveryRejection[];
  aliasReferenceDiagnostics?: AliasReferenceDiagnostics;
}): ParticipantDiscoveryPlan {
  const seeds: ParticipantSeed[] = [];
  const evidence: ParticipantCandidateEvidence[] = [];
  params.candidates.forEach((candidate, firstSeenOrder) => {
    seeds.push({
      key: candidate.key,
      reasons: candidate.reasons,
      aliases: candidate.aliases,
      capabilities: candidate.capabilities,
      firstSeenOrder,
      ...(candidate.sourceDisplayName && { sourceDisplayName: candidate.sourceDisplayName }),
    });
    for (const source of candidate.evidenceSources) {
      evidence.push({ key: candidate.key, source, firstSeenOrder });
    }
  });

  const mergedEvidence = new Map<string, ParticipantCandidateEvidence>();
  for (const item of evidence) {
    const key = `${serializeParticipantKey(item.key)}\0${item.source}`;
    const existing = mergedEvidence.get(key);
    if (!existing || item.firstSeenOrder < existing.firstSeenOrder) mergedEvidence.set(key, item);
  }

  return {
    seeds: mergeParticipantSeeds(seeds),
    evidence: [...mergedEvidence.values()].sort((left, right) => left.firstSeenOrder - right.firstSeenOrder),
    rejections: params.rejections ?? [],
    aliasReferenceDiagnostics: params.aliasReferenceDiagnostics ?? EMPTY_ALIAS_DIAGNOSTICS,
  };
}
