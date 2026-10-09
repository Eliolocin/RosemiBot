import { describe, expect, it, mock, spyOn } from "bun:test";
import { GuildFeature, GuildMemberFlags, type GuildMember } from "discord.js";
import { log } from "@/utils/misc/logger";
import {
  isWelcomeGateOpen,
  notifyWelcomeGateMemberRemove,
  notifyWelcomeGateMemberUpdate,
  waitForWelcomeGate,
} from "@/events/guildMemberAdd/helpers/welcomeGate";

let nextUserId = 1;

function makeMember(params: {
  pending?: boolean;
  completedOnboarding?: boolean;
  onboardingEnabled?: boolean | "unreadable";
  community?: boolean;
  guildId?: string;
  userId?: string;
}): GuildMember {
  const fetchOnboarding = mock(async () => {
    if (params.onboardingEnabled === "unreadable") throw new Error("Missing Permissions");
    return { enabled: params.onboardingEnabled ?? false };
  });

  return {
    id: params.userId ?? `user-${nextUserId++}`,
    pending: params.pending ?? false,
    flags: { has: (flag: number) => flag === GuildMemberFlags.CompletedOnboarding && !!params.completedOnboarding },
    guild: {
      id: params.guildId ?? "guild-1",
      features: params.community === false ? [] : [GuildFeature.Community],
      fetchOnboarding,
    },
  } as unknown as GuildMember;
}

/** Yields long enough for the onboarding lookup inside `waitForWelcomeGate` to settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("isWelcomeGateOpen", () => {
  it("stays closed while Membership Screening is pending", () => {
    expect(isWelcomeGateOpen(makeMember({ pending: true, completedOnboarding: true }), true)).toBe(false);
  });

  it("stays closed until onboarding completes when the guild requires it", () => {
    expect(isWelcomeGateOpen(makeMember({}), true)).toBe(false);
    expect(isWelcomeGateOpen(makeMember({ completedOnboarding: true }), true)).toBe(true);
  });

  it("ignores the onboarding flag when the guild has onboarding disabled", () => {
    expect(isWelcomeGateOpen(makeMember({}), false)).toBe(true);
  });
});

describe("waitForWelcomeGate", () => {
  it("opens immediately for a guild with no gates", async () => {
    expect((await waitForWelcomeGate(makeMember({ onboardingEnabled: false }))).outcome).toBe("open");
  });

  it("skips the onboarding lookup for a guild without Community", async () => {
    const member = makeMember({ community: false, onboardingEnabled: "unreadable" });

    expect((await waitForWelcomeGate(member)).outcome).toBe("open");
    expect(member.guild.fetchOnboarding).not.toHaveBeenCalled();
  });

  it("waits for onboarding to finish, then opens on the member update", async () => {
    const member = makeMember({ onboardingEnabled: true });
    let outcome: string | undefined;
    const waiting = waitForWelcomeGate(member).then((result) => {
      outcome = result.outcome;
    });

    await flush();
    expect(outcome).toBeUndefined();

    notifyWelcomeGateMemberUpdate(member);
    expect(outcome).toBeUndefined();

    notifyWelcomeGateMemberUpdate(
      makeMember({ userId: member.id, onboardingEnabled: true, completedOnboarding: true }),
    );
    await waiting;
    expect(outcome).toBe("open");
  });

  it("opens when Membership Screening clears on a guild without onboarding", async () => {
    const member = makeMember({ pending: true, onboardingEnabled: false });
    const waiting = waitForWelcomeGate(member);

    await flush();
    notifyWelcomeGateMemberUpdate(makeMember({ userId: member.id, pending: false }));

    expect((await waiting).outcome).toBe("open");
  });

  it("reports ended, not open, when the member leaves mid-onboarding", async () => {
    const member = makeMember({ onboardingEnabled: true });
    const waiting = waitForWelcomeGate(member);

    await flush();
    notifyWelcomeGateMemberRemove(member.guild.id, member.id);

    expect((await waiting).outcome).toBe("ended");
  });

  it("keeps a departure that lands during the onboarding lookup", async () => {
    const member = makeMember({ onboardingEnabled: true });
    const waiting = waitForWelcomeGate(member);

    notifyWelcomeGateMemberRemove(member.guild.id, member.id);

    expect((await waiting).outcome).toBe("ended");
  });

  it("keeps a completion update that lands during the onboarding lookup", async () => {
    const member = makeMember({ onboardingEnabled: true });
    const waiting = waitForWelcomeGate(member);

    notifyWelcomeGateMemberUpdate(makeMember({ userId: member.id, completedOnboarding: true }));

    expect((await waiting).outcome).toBe("open");
  });

  it("expires instead of greeting a member who never finishes", async () => {
    expect((await waitForWelcomeGate(makeMember({ onboardingEnabled: true }), { maxWaitMs: 10 })).outcome).toBe(
      "expired",
    );
  });

  it("ends a stale waiter when the same user rejoins", async () => {
    const first = makeMember({ onboardingEnabled: true, userId: "rejoiner" });
    const firstWaiting = waitForWelcomeGate(first);
    await flush();

    const second = makeMember({ onboardingEnabled: true, userId: "rejoiner" });
    const secondWaiting = waitForWelcomeGate(second);

    expect((await firstWaiting).outcome).toBe("ended");
    notifyWelcomeGateMemberRemove(second.guild.id, second.id);
    expect((await secondWaiting).outcome).toBe("ended");
  });

  it("returns the freshest member seen instead of the join-time copy", async () => {
    const joined = makeMember({ onboardingEnabled: true });
    const waiting = waitForWelcomeGate(joined);

    await flush();
    const finished = makeMember({ userId: joined.id, completedOnboarding: true });
    notifyWelcomeGateMemberUpdate(finished);

    expect((await waiting).member).toBe(finished);
  });

  it("holds a greeting for the fallback delay when onboarding cannot be read", async () => {
    const member = makeMember({ onboardingEnabled: "unreadable", guildId: "guild-unreadable-delay" });
    const errorLog = spyOn(log, "error").mockImplementation(async () => {});
    const startedAt = Date.now();

    const result = await waitForWelcomeGate(member, { fallbackDelayMs: 40 });
    errorLog.mockRestore();

    expect(result.outcome).toBe("open");
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(35);
  });

  it("still waits for Membership Screening when onboarding cannot be read", async () => {
    const member = makeMember({ pending: true, onboardingEnabled: "unreadable", guildId: "guild-unreadable-wait" });
    const errorLog = spyOn(log, "error").mockImplementation(async () => {});
    const waiting = waitForWelcomeGate(member, { fallbackDelayMs: 0 });

    await flush();
    notifyWelcomeGateMemberUpdate(makeMember({ userId: member.id, guildId: "guild-unreadable-wait" }));
    const result = await waiting;
    errorLog.mockRestore();

    expect(result.outcome).toBe("open");
  });

  it("reports an unreadable guild once, not on every join", async () => {
    const errorLog = spyOn(log, "error").mockImplementation(async () => {});

    await waitForWelcomeGate(makeMember({ onboardingEnabled: "unreadable", guildId: "guild-unreadable-once" }), {
      fallbackDelayMs: 0,
    });
    await waitForWelcomeGate(makeMember({ onboardingEnabled: "unreadable", guildId: "guild-unreadable-once" }), {
      fallbackDelayMs: 0,
    });
    const calls = errorLog.mock.calls.length;
    errorLog.mockRestore();

    expect(calls).toBe(1);
  });

  it("does not open from an update for a member nobody is waiting on", () => {
    expect(() => notifyWelcomeGateMemberUpdate(makeMember({ completedOnboarding: true }))).not.toThrow();
  });
});
