import { describe, expect, it } from "bun:test";
import type { ToolContext } from "@/types/tool/interfaces";
import {
  DEFAULT_BLOCK_USER_MAX_DURATION_HOURS,
  formatBlockedUserNoticeContent,
  missingBlockNoticePermission,
  parseBlockUserArgs,
} from "@/tools/functionCalls/userBlockToolShared";

it("identifies the channel permission needed before saving a block", async () => {
  const member = { id: "bot" };
  const context = {
    guildId: "guild",
    client: { guilds: { cache: new Map([["guild", { members: { me: member } }]]) } },
    channel: {
      isThread: () => false,
      permissionsFor: () => ({ has: (permission: string) => permission !== "SendMessages" }),
    },
  } as unknown as ToolContext;

  expect(await missingBlockNoticePermission(context)).toBe("SendMessages");
});

describe("block_user argument parsing", () => {
  it("accepts valid mute arguments", () => {
    const parsed = parseBlockUserArgs(
      {
        blocked_user: "Alice",
        block_type: "mute",
        block_duration_hours: 24,
        block_reason: "Asked to stop interacting with this persona.",
      },
      DEFAULT_BLOCK_USER_MAX_DURATION_HOURS,
    );

    expect(parsed).toEqual({
      ok: true,
      blockedUser: "Alice",
      blockType: "mute",
      durationHours: 24,
      reason: "Asked to stop interacting with this persona.",
    });
  });

  it("accepts valid block arguments and trims strings", () => {
    const parsed = parseBlockUserArgs(
      {
        blocked_user: "  Bob  ",
        block_type: "block",
        block_duration_hours: 1,
        block_reason: "  Do not load their recent messages.  ",
      },
      DEFAULT_BLOCK_USER_MAX_DURATION_HOURS,
    );

    expect(parsed).toEqual({
      ok: true,
      blockedUser: "Bob",
      blockType: "block",
      durationHours: 1,
      reason: "Do not load their recent messages.",
    });
  });

  it("rejects missing target", () => {
    const parsed = parseBlockUserArgs({
      blocked_user: "",
      block_type: "mute",
      block_duration_hours: 1,
      block_reason: "reason",
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.status).toBe("user_block_failed_invalid_target");
    }
  });

  it("rejects invalid block type", () => {
    const parsed = parseBlockUserArgs({
      blocked_user: "Alice",
      block_type: "silence",
      block_duration_hours: 1,
      block_reason: "reason",
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.status).toBe("user_block_failed_invalid_type");
    }
  });

  it("rejects invalid durations", () => {
    for (const duration of [0, -1, 1.5, 169]) {
      const parsed = parseBlockUserArgs(
        {
          blocked_user: "Alice",
          block_type: "mute",
          block_duration_hours: duration,
          block_reason: "reason",
        },
        168,
      );

      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.status).toBe("user_block_failed_invalid_duration");
      }
    }
  });

  it("rejects missing reason", () => {
    const parsed = parseBlockUserArgs({
      blocked_user: "Alice",
      block_type: "mute",
      block_duration_hours: 1,
      block_reason: "   ",
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.status).toBe("user_block_failed_invalid_reason");
    }
  });
});

describe("formatBlockedUserNoticeContent", () => {
  const now = new Date("2026-06-11T00:00:00.000Z");

  it("rounds remaining hours up and pluralizes for multi-hour blocks", () => {
    // 2.5 hours out -> ceil to 3
    const expiresAt = new Date(now.getTime() + 2.5 * 60 * 60 * 1000);
    const notice = formatBlockedUserNoticeContent("Alice", expiresAt, now);

    expect(notice).toBe("[System: Alice sent a message but is currently blocked by you for 3 more hours.]");
  });

  it("floors at one hour and uses singular when under an hour remains", () => {
    // 12 minutes out -> ceil is 1, singular "hour"
    const expiresAt = new Date(now.getTime() + 12 * 60 * 1000);
    const notice = formatBlockedUserNoticeContent("Bob", expiresAt, now);

    expect(notice).toContain("for 1 more hour.");
    expect(notice).not.toContain("hours");
  });

  it("never reports zero or negative hours for an already-expired window", () => {
    const expiresAt = new Date(now.getTime() - 60 * 60 * 1000);
    const notice = formatBlockedUserNoticeContent("Carol", expiresAt, now);

    expect(notice).toContain("for 1 more hour.");
  });
});
