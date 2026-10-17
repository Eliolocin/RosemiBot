import { describe, expect, it } from "bun:test";
import type { TomoriState } from "@/types/db/schema";
import {
  createParticipantRequestScope,
  prepareParticipantContext,
  type PreparedParticipantContext,
} from "@/utils/text/participants/preparation";
import {
  createParticipantContextFixture,
  PARTICIPANT_FIXTURE_IDS,
  type ParticipantContextFixture,
} from "./fixtures/participantContextFixture";

function visibleParticipantIds(): string[] {
  return [
    PARTICIPANT_FIXTURE_IDS.human,
    PARTICIPANT_FIXTURE_IDS.bot,
    `persona:${PARTICIPANT_FIXTURE_IDS.historicalPersona}`,
    PARTICIPANT_FIXTURE_IDS.webhook,
  ];
}

function prepare(
  fixture: ParticipantContextFixture,
  activePersona: TomoriState,
  requestScope = createParticipantRequestScope(),
  history = fixture.history,
): Promise<PreparedParticipantContext> {
  return prepareParticipantContext({
    client: fixture.client,
    guildId: PARTICIPANT_FIXTURE_IDS.guild,
    simplifiedMessageHistory: history,
    personas: fixture.personas,
    activePersona,
    visibleUserIds: visibleParticipantIds(),
    syntheticUsers: fixture.syntheticUsers,
    matrixUsers: fixture.matrixUsers,
    requestScope,
  });
}

describe("participant context preparation", () => {
  it("produces the same plan for equivalent live and snapshot inputs", async () => {
    const liveFixture = createParticipantContextFixture();
    const livePlan = await (async (): Promise<PreparedParticipantContext["discoveryPlan"]> => {
      try {
        return (await prepare(liveFixture, liveFixture.activePersona)).discoveryPlan;
      } finally {
        liveFixture.restoreRepositories();
      }
    })();

    const snapshotFixture = createParticipantContextFixture();
    try {
      const snapshotPlan = (await prepare(snapshotFixture, snapshotFixture.activePersona)).discoveryPlan;
      expect(snapshotPlan).toEqual(livePlan);
    } finally {
      snapshotFixture.restoreRepositories();
    }
  });

  it("reuses frozen discovery while rebuilding the active-persona plan", async () => {
    const fixture = createParticipantContextFixture();
    const requestScope = createParticipantRequestScope();
    const alterPersona = fixture.personas.find(
      (persona) => persona.persona_id === PARTICIPANT_FIXTURE_IDS.historicalPersona,
    );
    if (!alterPersona) throw new Error("Alter persona fixture is missing");

    try {
      const main = await prepare(fixture, fixture.activePersona, requestScope);
      const retry = await prepare(fixture, fixture.activePersona, requestScope);
      const alter = await prepare(fixture, alterPersona, requestScope);

      expect(fixture.counters.candidateQueries).toBe(1);
      expect(main.diagnostics.discoveryCacheHit).toBe(false);
      expect(main.diagnostics.externalCalls.candidateSourceReads).toBe(1);
      expect(main.diagnostics.candidateCount).toBe(2);
      expect(main.diagnostics.includedCount).toBe(6);
      expect(retry.diagnostics.discoveryCacheHit).toBe(true);
      expect(retry.diagnostics.externalCalls).toEqual({
        candidateSourceReads: 0,
        memberCacheHits: 0,
        memberFetches: 0,
        messageProxyIdentityReads: 0,
      });
      expect(alter.diagnostics.discoveryCacheHit).toBe(true);
      expect(retry.discoveryPlan).toEqual(main.discoveryPlan);
      expect(
        main.discoveryPlan.seeds.some(
          (seed) => seed.key.kind === "discord_user" && seed.key.discordId === PARTICIPANT_FIXTURE_IDS.referencedHuman,
        ),
      ).toBe(true);
      expect(main.publicPersonaProfiles.map((profile) => profile.personaId)).toEqual([
        PARTICIPANT_FIXTURE_IDS.historicalPersona,
      ]);
      expect(alter.publicPersonaProfiles.map((profile) => profile.personaId)).not.toContain(
        PARTICIPANT_FIXTURE_IDS.historicalPersona,
      );
      expect(
        main.discoveryPlan.seeds.some((seed) => seed.key.kind === "bot" && seed.reasons.has("active_identity")),
      ).toBe(true);
      expect(
        alter.discoveryPlan.seeds.some(
          (seed) =>
            seed.key.kind === "persona" &&
            seed.key.personaId === PARTICIPANT_FIXTURE_IDS.historicalPersona &&
            seed.reasons.has("active_identity"),
        ),
      ).toBe(true);
      expect(Object.keys(main.diagnostics.rejectionCounts).sort()).toEqual([
        "ambiguous_alias",
        "blocked_source",
        "bot",
        "existing_participant",
        "ineligible_state",
        "missing_guild",
        "non_member",
      ]);
    } finally {
      fixture.restoreRepositories();
    }
  });

  it("does not reuse discovery when the sanitized visible input changes", async () => {
    const fixture = createParticipantContextFixture();
    const requestScope = createParticipantRequestScope();
    try {
      const first = await prepare(fixture, fixture.activePersona, requestScope);
      const changedHistory = fixture.history.map((message, index) =>
        index === 0 ? { ...message, content: `${message.content ?? ""} changed` } : message,
      );
      const changed = await prepare(fixture, fixture.activePersona, requestScope, changedHistory);

      expect(first.diagnostics.discoveryCacheHit).toBe(false);
      expect(changed.diagnostics.discoveryCacheHit).toBe(false);
      expect(fixture.counters.candidateQueries).toBe(2);
    } finally {
      fixture.restoreRepositories();
    }
  });
});
