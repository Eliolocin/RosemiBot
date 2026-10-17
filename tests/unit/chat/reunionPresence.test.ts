import { describe, expect, it, mock } from "bun:test";
import type { TomoriState, UserRow } from "@/types/db/schema";
import type { ChatTurn, GenerationTurnResult } from "@/utils/chat/types";
import {
  recordReunionPresence,
  ReunionClaimRegistry,
  type ReunionPresenceStore,
  resolveReunionNote,
} from "@/utils/chat/reunionPresence";

const HOST_USER_ID = 30;
const HOST_DISC_ID = "100000000000000030";

const LOCKE_DISC_ID = "pk:11111111-1111-4111-8111-111111111111";
const LOCKE_USER_ID = 501;
const REN_DISC_ID = "pk:22222222-2222-4222-8222-222222222222";
const REN_USER_ID = 502;

const completedResult: GenerationTurnResult = {
  status: "completed",
  streamResults: [],
  personaResponses: [{ text: "Welcome back!", personaName: "Tomori" }],
};

const emptyResult: GenerationTurnResult = {
  status: "empty_response",
  streamResults: [],
  personaResponses: [],
};

const toolDeliveredResult: GenerationTurnResult = {
  status: "completed",
  streamResults: [],
  personaResponses: [],
  toolResponseDelivered: true,
};

function makeResolveArgs(userId: number, userDiscId = HOST_DISC_ID) {
  return {
    turn: {
      userRow: { user_id: userId, user_disc_id: userDiscId, timezone_offset: 0 },
      triggererName: "Alice",
    } as ChatTurn,
    effectivePersona: {
      server_id: 5,
      persona_lineage_id: 10,
      config: { time_awareness_enabled: true, timezone_offset: 0 },
    } as TomoriState,
    isUserImpersonation: false,
  };
}

/**
 * One shared Discord account, several internal users rows: the host plus one synthetic row
 * per proxied identity, as identity persistence leaves them. The clock a caller observes is
 * therefore whichever row the resolver scoped the turn to.
 */
function makePresenceStore(overrides: Partial<ReunionPresenceStore> = {}) {
  const rowsByDiscId = new Map<string, UserRow>([
    [HOST_DISC_ID, { user_id: HOST_USER_ID, timezone_offset: 0 } as UserRow],
    [LOCKE_DISC_ID, { user_id: LOCKE_USER_ID, timezone_offset: 0 } as UserRow],
    [REN_DISC_ID, { user_id: REN_USER_ID, timezone_offset: 0 } as UserRow],
  ]);

  const store: ReunionPresenceStore = {
    isTrackingEnabled: true,
    getUserPersonaReunionInfo: async () => null,
    recordPresenceSeen: async () => true,
    loadUserRow: async (userDiscId) => rowsByDiscId.get(userDiscId) ?? null,
    ...overrides,
  };

  return { store };
}

/**
 * Per-user clock state, shaped like `StatRepository.recordPresenceSeen`, so a test can prove
 * which member's timeline advanced and that the host's did not. `writtenUserIds` records
 * every commit this clock received, which is also the proof that no other clock moved.
 */
function makePerUserClockState() {
  const lastSeenByUserId = new Map<number, { lastPreviousDayAt: Date | null; seenToday: boolean }>();
  const writtenUserIds: number[] = [];
  return {
    read: async (userId: number) => lastSeenByUserId.get(userId) ?? { lastPreviousDayAt: null, seenToday: false },
    write: async ({ userId }: { userId: number }) => {
      writtenUserIds.push(userId);
      const existing = lastSeenByUserId.get(userId);
      lastSeenByUserId.set(userId, { lastPreviousDayAt: existing?.lastPreviousDayAt ?? null, seenToday: true });
      return true;
    },
    writtenUserIds,
    /** A day already on record, as a previously successful turn would leave it. */
    seedHistory(userId: number, lastPreviousDayAt: Date) {
      lastSeenByUserId.set(userId, { lastPreviousDayAt, seenToday: false });
    },
  };
}

describe("ReunionClaimRegistry", () => {
  it("allows only one active claim for a persona lineage and user", () => {
    const registry = new ReunionClaimRegistry();
    const first = registry.tryClaim(10, 20);
    const otherUser = registry.tryClaim(10, 21);
    const otherLineage = registry.tryClaim(11, 20);

    expect(first).not.toBeNull();
    expect(registry.tryClaim(10, 20)).toBeNull();
    expect(otherUser).not.toBeNull();
    expect(otherLineage).not.toBeNull();

    if (first) registry.release(first);
    if (otherUser) registry.release(otherUser);
    if (otherLineage) registry.release(otherLineage);
  });

  it("makes the reunion claimable again after release", () => {
    const registry = new ReunionClaimRegistry();
    const first = registry.tryClaim(10, 20);
    if (!first) throw new Error("Expected the first reunion claim to succeed");

    expect(registry.owns(first)).toBe(true);
    registry.release(first);
    expect(registry.owns(first)).toBe(false);
    const next = registry.tryClaim(10, 20);
    expect(next).not.toBeNull();
    if (next) registry.release(next);
  });

  it("suppresses a concurrent channel until one successful delivery consumes the reunion", async () => {
    let seenToday = false;
    const read = mock(async () => ({
      lastPreviousDayAt: new Date("2026-07-01T00:00:00Z"),
      seenToday,
    }));
    const write = mock(async () => {
      seenToday = true;
      return true;
    });
    const { store } = makePresenceStore({ getUserPersonaReunionInfo: read, recordPresenceSeen: write });

    const first = await resolveReunionNote(makeResolveArgs(HOST_USER_ID), store);
    const concurrent = await resolveReunionNote(makeResolveArgs(HOST_USER_ID), store);

    expect(first.note).toContain("Alice hasn't interacted with you specifically since");
    expect(first.presence?.mode).toBe("claimed");
    expect(concurrent.note).toBeNull();
    expect(concurrent.presence?.mode).toBe("deferred");

    await recordReunionPresence(concurrent.presence, completedResult, store);
    expect(write).not.toHaveBeenCalled();

    await recordReunionPresence(first.presence, completedResult, store);
    expect(write).toHaveBeenCalledTimes(1);

    const afterDelivery = await resolveReunionNote(makeResolveArgs(HOST_USER_ID), store);
    expect(afterDelivery.note).toBeNull();
    expect(afterDelivery.presence?.mode).toBe("record");
  });

  it("claims before the database read so a concurrent context cannot use a stale snapshot", async () => {
    let finishRead: ((value: { lastPreviousDayAt: Date; seenToday: boolean }) => void) | undefined;
    const read = mock(
      () =>
        new Promise<{ lastPreviousDayAt: Date; seenToday: boolean }>((resolve) => {
          finishRead = resolve;
        }),
    );
    const { store } = makePresenceStore({ getUserPersonaReunionInfo: read });

    const firstPromise = resolveReunionNote(makeResolveArgs(32), store);
    const concurrent = await resolveReunionNote(makeResolveArgs(32), store);

    expect(concurrent.note).toBeNull();
    expect(concurrent.presence?.mode).toBe("deferred");
    expect(read).toHaveBeenCalledTimes(1);

    finishRead?.({ lastPreviousDayAt: new Date("2026-07-01T00:00:00Z"), seenToday: false });
    const first = await firstPromise;
    expect(first.presence?.mode).toBe("claimed");
    await recordReunionPresence(first.presence, emptyResult, store);
  });

  it("consumes the reunion after a tool directly delivers the persona response", async () => {
    const write = mock(async () => true);
    const { store } = makePresenceStore({
      getUserPersonaReunionInfo: async () => ({ lastPreviousDayAt: null, seenToday: false }),
      recordPresenceSeen: write,
    });
    const first = await resolveReunionNote(makeResolveArgs(33), store);

    expect(first.note).toContain("very first time");
    await recordReunionPresence(first.presence, toolDeliveredResult, store);

    expect(write).toHaveBeenCalledTimes(1);
  });

  it("releases a failed claim without letting a suppressed turn consume it", async () => {
    const read = mock(async () => ({
      lastPreviousDayAt: new Date("2026-07-01T00:00:00Z"),
      seenToday: false,
    }));
    const write = mock(async () => true);
    const { store } = makePresenceStore({ getUserPersonaReunionInfo: read, recordPresenceSeen: write });

    const first = await resolveReunionNote(makeResolveArgs(31), store);
    const concurrent = await resolveReunionNote(makeResolveArgs(31), store);

    await recordReunionPresence(concurrent.presence, completedResult, store);
    await recordReunionPresence(first.presence, emptyResult, store);
    expect(write).not.toHaveBeenCalled();

    const retry = await resolveReunionNote(makeResolveArgs(31), store);
    expect(retry.note).toContain("Alice hasn't interacted with you specifically since");
    expect(retry.presence?.mode).toBe("claimed");
    await recordReunionPresence(retry.presence, emptyResult, store);
  });
});

describe("resolveReunionNote — proxied identity clocks", () => {
  const locke = { name: "Locke", discId: LOCKE_DISC_ID, userId: LOCKE_USER_ID };
  const ren = { name: "Ren", discId: REN_DISC_ID, userId: REN_USER_ID };

  function makeProxiedArgs(member: { name: string; discId: string }, hostUserId = HOST_USER_ID) {
    return {
      ...makeResolveArgs(hostUserId),
      proxiedIdentityName: member.name,
      proxiedIdentityUserDiscId: member.discId,
    };
  }

  it("gives each member of one host account its own first meeting", async () => {
    const clock = makePerUserClockState();
    const presence = makePresenceStore({ getUserPersonaReunionInfo: clock.read, recordPresenceSeen: clock.write });

    const firstMeeting = await resolveReunionNote(makeProxiedArgs(locke), presence.store);
    expect(firstMeeting.note).toBe(
      "Locke is talking to you for the very first time, from an account you already know. Welcome them naturally and ask something friendly to get to know them.",
    );
    // The note is guidance, so the proof is which clock the turn committed to.
    expect(firstMeeting.presence?.userId).toBe(LOCKE_USER_ID);
    await recordReunionPresence(firstMeeting.presence, completedResult, presence.store);

    const siblingFirstMeeting = await resolveReunionNote(makeProxiedArgs(ren), presence.store);
    expect(siblingFirstMeeting.note).toBe(
      "Ren is talking to you for the very first time, from an account you already know. Welcome them naturally and ask something friendly to get to know them.",
    );
    expect(siblingFirstMeeting.presence?.userId).toBe(REN_USER_ID);
    await recordReunionPresence(siblingFirstMeeting.presence, completedResult, presence.store);

    expect(clock.writtenUserIds).toEqual([LOCKE_USER_ID, REN_USER_ID]);
  });

  it("does not repeat a member's first meeting on the same day it already landed", async () => {
    const clock = makePerUserClockState();
    const presence = makePresenceStore({ getUserPersonaReunionInfo: clock.read, recordPresenceSeen: clock.write });

    const first = await resolveReunionNote(makeProxiedArgs(locke), presence.store);
    await recordReunionPresence(first.presence, completedResult, presence.store);

    const sameDay = await resolveReunionNote(makeProxiedArgs(locke), presence.store);
    expect(sameDay.note).toBeNull();
    expect(sameDay.presence?.mode).toBe("record");
    await recordReunionPresence(sameDay.presence, completedResult, presence.store);

    // Switching members same-day is still that member's first meeting.
    const sibling = await resolveReunionNote(makeProxiedArgs(ren), presence.store);
    expect(sibling.note).toContain("very first time");
    expect(sibling.presence?.userId).toBe(REN_USER_ID);
    await recordReunionPresence(sibling.presence, completedResult, presence.store);
  });

  it("produces a member-specific reunion after a gap, even while the shared account stays active", async () => {
    const clock = makePerUserClockState();
    const presence = makePresenceStore({ getUserPersonaReunionInfo: clock.read, recordPresenceSeen: clock.write });

    // Locke met Tomori eight days ago; the sibling has spoken from the host account since.
    clock.seedHistory(LOCKE_USER_ID, new Date(Date.now() - 8 * 24 * 60 * 60 * 1000));
    clock.seedHistory(HOST_USER_ID, new Date(Date.now() - 60 * 60 * 1000));
    clock.seedHistory(REN_USER_ID, new Date(Date.now() - 60 * 60 * 1000));

    const reunion = await resolveReunionNote(makeProxiedArgs(locke), presence.store);
    expect(reunion.note).toContain("Locke hasn't interacted with you specifically since");
    expect(reunion.note).toContain("(8 days ago)");
    // Never an account-level absence: the sibling was talking from that account in between.
    expect(reunion.note).not.toContain("the account they share");
    expect(reunion.note).not.toContain("has not been around");
    expect(reunion.presence?.userId).toBe(LOCKE_USER_ID);
    await recordReunionPresence(reunion.presence, completedResult, presence.store);

    // The sibling that spoke an hour ago has no reunion pending.
    expect((await resolveReunionNote(makeProxiedArgs(ren), presence.store)).note).toBeNull();

    // Nor does the host account, whose own clock member turns never advanced.
    expect((await resolveReunionNote(makeResolveArgs(HOST_USER_ID), presence.store)).note).toBeNull();
    expect(clock.writtenUserIds).toEqual([LOCKE_USER_ID]);
  });

  it("keeps the member's pending reunion after a failed response so the retry gets it", async () => {
    const read = mock(async () => ({ lastPreviousDayAt: null, seenToday: false }));
    const write = mock(async () => true);
    const presence = makePresenceStore({ getUserPersonaReunionInfo: read, recordPresenceSeen: write });

    const failed = await resolveReunionNote(makeProxiedArgs(locke), presence.store);
    expect(failed.note).toContain("very first time");
    await recordReunionPresence(failed.presence, emptyResult, presence.store);
    expect(write).not.toHaveBeenCalled();

    const retry = await resolveReunionNote(makeProxiedArgs(locke), presence.store);
    expect(retry.note).toContain("Locke is talking to you for the very first time");
    expect(retry.presence?.mode).toBe("claimed");
    await recordReunionPresence(retry.presence, completedResult, presence.store);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({ serverId: 5, userId: LOCKE_USER_ID, lineageId: 10 });
  });

  it("injects nothing when the proxied identity has no clock row of its own", async () => {
    const read = mock(async () => ({ lastPreviousDayAt: null, seenToday: false }));
    const { store } = makePresenceStore({ getUserPersonaReunionInfo: read });

    // Admission persists the identity before it builds context, so a stable speaker with no
    // row is an inconsistent state: it must inject nothing rather than clock the host.
    const resolved = await resolveReunionNote(
      { ...makeProxiedArgs(locke), proxiedIdentityUserDiscId: "pk:33333333-3333-4333-8333-333333333333" },
      store,
    );

    expect(resolved.note).toBeNull();
    expect(resolved.presence).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("falls back to the triggerer name when the member's display name is blank", async () => {
    const clock = makePerUserClockState();
    const presence = makePresenceStore({ getUserPersonaReunionInfo: clock.read, recordPresenceSeen: clock.write });

    const resolved = await resolveReunionNote({ ...makeProxiedArgs(locke), proxiedIdentityName: "  " }, presence.store);

    expect(resolved.note).toContain("Alice is talking to you");
    expect(resolved.presence?.userId).toBe(LOCKE_USER_ID);
    await recordReunionPresence(resolved.presence, completedResult, presence.store);
  });

  it("leaves the host account's non-proxy clock untouched beside a member's", async () => {
    const clock = makePerUserClockState();
    const presence = makePresenceStore({ getUserPersonaReunionInfo: clock.read, recordPresenceSeen: clock.write });

    const hostTurn = await resolveReunionNote(makeResolveArgs(HOST_USER_ID), presence.store);
    expect(hostTurn.note).toContain("Alice is talking to you directly for the very first time");
    expect(hostTurn.presence?.userId).toBe(HOST_USER_ID);
    await recordReunionPresence(hostTurn.presence, completedResult, presence.store);

    // A member's first meeting is independent of the host's, in both directions.
    const memberTurn = await resolveReunionNote(makeProxiedArgs(locke), presence.store);
    expect(memberTurn.note).toContain("Locke is talking to you for the very first time");
    expect(memberTurn.presence?.userId).toBe(LOCKE_USER_ID);

    expect(clock.writtenUserIds).toEqual([HOST_USER_ID]);
  });
});
