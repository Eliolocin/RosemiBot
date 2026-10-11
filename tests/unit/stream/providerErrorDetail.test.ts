import { describe, expect, it } from "bun:test";
import type { ButtonInteraction, Client, TextChannel } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import type { StreamContext } from "@/types/stream/interfaces";
import { buildRestrictedErrorDetail, formatProviderErrorDetail } from "@/utils/discord/stream/errorUi";

const GOOGLE_THINKING_ERROR = `Google API error (400): ${JSON.stringify({
  error: {
    message: JSON.stringify(
      {
        error: {
          code: 400,
          message: "Thinking level MINIMAL is not supported for this model. Please retry with other thinking level.",
          status: "INVALID_ARGUMENT",
        },
      },
      null,
      2,
    ),
    code: 400,
    status: "Bad Request",
  },
})}`;

const FAKE_GOOGLE_KEY = `AIza${"x".repeat(35)}`;
const TEXT_DISPLAY_LIMIT = 4_000;

function fencedBody(content: string): string {
  const match = /```(?:json)?\n([\s\S]*)\n```$/.exec(content);
  if (!match?.[1]) throw new Error("detail is not one closed code block");
  return match[1];
}

function makeContext(textCredentialSource: StreamContext["textCredentialSource"], triggererDiscId?: string) {
  return {
    channel: { id: "channel_1" } as unknown as TextChannel,
    client: {} as Client,
    tomoriState: { server_id: 1 } as unknown as TomoriState,
    contextItems: [],
    currentTurnModelParts: [],
    provider: "google",
    locale: "en-US",
    textCredentialSource,
    triggererDiscId,
  } satisfies StreamContext;
}

function click(options: { userId: string; inGuild: boolean; manageGuild: boolean }): ButtonInteraction {
  return {
    user: { id: options.userId },
    inGuild: () => options.inGuild,
    memberPermissions: { has: () => options.manageGuild },
  } as unknown as ButtonInteraction;
}

describe("formatProviderErrorDetail", () => {
  it("unwraps the JSON document Google nests inside error.message", () => {
    const content = formatProviderErrorDetail(GOOGLE_THINKING_ERROR);
    const body = JSON.parse(fencedBody(content)) as { error: { message: { error: { status: string } } } };

    expect(content.startsWith("Google API error (400):\n```json\n")).toBe(true);
    expect(body.error.message.error.status).toBe("INVALID_ARGUMENT");
  });

  it("redacts a credential that was escaped inside the nested document", () => {
    const detail = `Google API error (400): ${JSON.stringify({ error: { message: JSON.stringify({ api_key: FAKE_GOOGLE_KEY }) } })}`;

    expect(formatProviderErrorDetail(detail)).not.toContain(FAKE_GOOGLE_KEY);
  });

  it("keeps an oversized or non-JSON body inside one closed code block", () => {
    const longPrefixBeforeJson = "x".repeat(4_000) + JSON.stringify({ a: "y".repeat(20_000) });
    for (const detail of ["x".repeat(10_000), `HTTP 500: ${"```".repeat(2_000)}`, longPrefixBeforeJson]) {
      const content = formatProviderErrorDetail(detail);

      expect(content.length).toBeLessThanOrEqual(TEXT_DISPLAY_LIMIT);
      expect(fencedBody(content)).not.toContain("```");
    }
  });
});

describe("buildRestrictedErrorDetail", () => {
  it("opens server-credential errors to Manage Server members and DM users only", () => {
    const { access } = buildRestrictedErrorDetail(GOOGLE_THINKING_ERROR, makeContext("server", "owner"));

    expect(access.canOpen(click({ userId: "admin", inGuild: true, manageGuild: true }))).toBe(true);
    expect(access.canOpen(click({ userId: "owner", inGuild: true, manageGuild: false }))).toBe(false);
    expect(access.canOpen(click({ userId: "owner", inGuild: false, manageGuild: false }))).toBe(true);
  });

  it("opens personal-credential errors to the key's owner, not to server managers", () => {
    const { access } = buildRestrictedErrorDetail(GOOGLE_THINKING_ERROR, makeContext("personal", "owner"));

    expect(access.canOpen(click({ userId: "owner", inGuild: true, manageGuild: false }))).toBe(true);
    expect(access.canOpen(click({ userId: "admin", inGuild: true, manageGuild: true }))).toBe(false);
  });
});
