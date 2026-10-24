import { describe, expect, it, spyOn } from "bun:test";
import {
  ActivityType,
  Client,
  Collection,
  GatewayIntentBits,
  type Guild,
  type GuildTextBasedChannel,
} from "discord.js";
import {
  isRelationshipEligible,
  pingUserTickets,
  refreshPingUserTarget,
} from "@/modules/natural-nudges/runtime/targets";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import { personalMemoryRepository } from "@/utils/db/repositories";
import { shortTermMemoryRepository } from "@/utils/db/repositories/ShortTermMemoryRepository";
import * as stmCache from "@/utils/cache/shortTermMemoryCache";
import { PrivacyLevel, personalMemorySchema } from "@/types/db/schema";
import { createPersona, createUserRow } from "../../helpers/fixtures";

const quiet = { localTurns: 1, stmChannels: 0, active: false, firedBySamePersona: false, firedByAnyPersona: false };

describe("Ping User nudge eligibility", () => {
  it("needs a recent memory or a live short-term memory, never activity alone", () => {
    expect(isRelationshipEligible(0, 0)).toBe(false);
    expect(isRelationshipEligible(1, 0)).toBe(true);
    expect(isRelationshipEligible(0, 1)).toBe(true);
  });

  it.each([
    "unchanged",
    "activity-ended",
    "memory-removed",
    "private",
    "memories-disabled",
    "excluded",
    "relationship-ended",
  ] as const)("refreshes target eligibility and exposed evidence when %s", async (change) => {
    const client = new Client({ intents: [GatewayIntentBits.GuildPresences] });
    const user = createUserRow({ user_id: 9, user_disc_id: "1300000000000000009" });
    const persona = createPersona({
      persona_id: 5,
      server_id: 7,
      persona_lineage_id: 4,
      config: { personal_memories_enabled: change !== "memories-disabled" },
    });
    const candidate = {
      user_id: 9,
      user_disc_id: user.user_disc_id,
      privacy_level: change === "private" ? PrivacyLevel.PARTIAL : user.privacy_level,
      local_turns: 2,
      ltm_recent: change === "relationship-ended" ? 0 : 1,
    };
    const guild = {
      id: "fixture-guild",
      members: { fetch: async () => ({ user: { bot: false } }) },
      presences: {
        cache: new Collection([
          [
            user.user_disc_id,
            { activities: change === "activity-ended" ? [] : [{ type: ActivityType.Playing, name: "Mecha Tactics" }] },
          ],
        ]),
      },
    } as unknown as Guild;
    const channel = {
      id: "fixture-channel",
      permissionsFor: () => ({ has: () => true }),
    } as unknown as GuildTextBasedChannel;
    const now = new Date();
    const memory = personalMemorySchema.parse({
      user_id: 9,
      persona_lineage_id: 4,
      content: "A current memory.",
      created_at: now,
    });
    const candidates = spyOn(naturalNudgeRepository, "listPingUserCandidates").mockResolvedValue(
      change === "excluded" ? [] : [candidate],
    );
    const memories = spyOn(personalMemoryRepository, "loadForUserLineage").mockResolvedValue(
      change === "memory-removed" ? [] : [memory],
    );
    const warm = spyOn(shortTermMemoryRepository, "preWarmUsers").mockResolvedValue(undefined);
    const stm = spyOn(stmCache, "getShortTermMemoriesForUser").mockReturnValue(
      change === "relationship-ended"
        ? []
        : [
            {
              serverId: guild.id,
              channelId: channel.id,
              messages: [],
              lastUpdated: now.getTime(),
              personaLineageId: 4,
            },
          ],
    );
    try {
      const refreshed = await refreshPingUserTarget({
        client,
        guild,
        serverId: 7,
        persona: { ...persona, persona_id: 5 },
        channel,
        now,
        target: {
          userId: 9,
          userDiscId: user.user_disc_id,
          displayName: "Mirri",
          channelIds: [channel.id],
          recentMemories: ["Earlier evidence."],
          activity: "Earlier activity",
        },
      });
      expect(candidates.mock.calls[0]?.[0]).toMatchObject({ onlyUserId: 9, personaLineageId: 4 });
      if (change === "excluded" || change === "relationship-ended") {
        expect(refreshed).toBeNull();
      } else {
        expect(refreshed?.recentMemories).toEqual(
          ["memory-removed", "private", "memories-disabled"].includes(change) ? [] : [memory.content],
        );
        if (change === "activity-ended" || change === "private") expect(refreshed?.activity).toBeNull();
        else expect(refreshed?.activity).toContain("Mecha Tactics");
      }
    } finally {
      for (const spy of [candidates, memories, warm, stm]) spy.mockRestore();
      client.destroy();
    }
  });
});

describe("Ping User nudge lottery tickets", () => {
  it("gives Mirri 17 tickets for 12 turns and one recent channel, and Juno 21 for one turn and two channels while playing", () => {
    expect(pingUserTickets({ ...quiet, localTurns: 12, stmChannels: 1 })).toBe(17);
    expect(pingUserTickets({ ...quiet, stmChannels: 2, active: true })).toBe(21);
  });

  it("stops counting at 30 turns and 5 channels, so a heavy user tops out at 55 tickets", () => {
    expect(pingUserTickets({ ...quiet, localTurns: 200, stmChannels: 12 })).toBe(55);
    expect(pingUserTickets({ ...quiet, localTurns: 200, stmChannels: 12, active: true })).toBe(65);
  });

  it("takes 15 tickets after this persona pinged them and 5 after another persona did, but never below 1", () => {
    const mirri = { ...quiet, localTurns: 12, stmChannels: 1 };
    expect(pingUserTickets({ ...mirri, firedBySamePersona: true, firedByAnyPersona: true })).toBe(2);
    expect(pingUserTickets({ ...mirri, firedByAnyPersona: true })).toBe(12);
    expect(pingUserTickets({ ...quiet, stmChannels: 1, firedBySamePersona: true, firedByAnyPersona: true })).toBe(1);
  });
});
