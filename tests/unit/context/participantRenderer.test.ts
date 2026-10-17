import { describe, expect, it } from "bun:test";
import { createParticipantAlias } from "@/utils/text/participants/aliases";
import type {
  HydratedParticipantProfile,
  ParticipantProfileField,
  MessageProxyNamespaceNote,
} from "@/utils/text/participants/hydration";
import { createBotKey, createDiscordUserKey, type ParticipantKey } from "@/utils/text/participants/identity";
import { renderParticipantPrompt } from "@/utils/text/participants/renderer";

function render(
  profiles: readonly HydratedParticipantProfile[],
  messageProxyNamespaces: MessageProxyNamespaceNote[] = [],
) {
  return renderParticipantPrompt({
    profiles,
    personaTaskLines: [],
    messageProxyNamespaces,
    isUserImpersonation: false,
    botName: "Tomori",
    isDMChannel: false,
    channelName: "general",
    channelId: "200000000000000001",
    currentTime: "Aug 2, 2026, 02:00 PM",
    timezoneLabel: "UTC+8",
    timeOfDayPhrase: "afternoon",
  });
}

function visibleField(owner: ParticipantKey, line: string, order: number): ParticipantProfileField {
  return {
    owner,
    kind: "status",
    order,
    visibility: { visible: true, reason: "visible" },
    lines: [line],
  };
}

function humanProfile(
  id: string,
  displayName: string,
  alias: string,
  orderLines: string[],
): HydratedParticipantProfile {
  const key = createDiscordUserKey(id);
  const participantAlias = createParticipantAlias({
    owner: key,
    value: alias,
    source: "username",
    purposes: ["output_mention", "tool_target", "copied_identity"],
    exposure: "visible",
    priority: 10,
  });
  if (!participantAlias) throw new Error("Renderer fixture alias is invalid");
  return {
    key,
    reasons: new Set(["visible_author"]),
    displayName,
    aliases: [participantAlias],
    primaryAlias: alias,
    mentionable: true,
    isBot: false,
    resolvableTargetId: id,
    fields: orderLines.map((line, index) => visibleField(key, line, orderLines.length - index)),
  };
}

describe("pure participant prompt renderer", () => {
  it("renders the deterministic zero-participant shape", () => {
    const rendered = render([]);

    expect(rendered.text).toBe(`[System: The following users are having a conversation:

If Tomori wants to ping any of these users, prepend an "@" symbol to a unique mention handle shown below (case-insensitive). If there is ambiguity with names, ask for clarification instead of guessing. Use mentions only when the notification matters.

Conversation context: #general (ID: 200000000000000001).
Current time: Aug 2, 2026, 02:00 PM (UTC+8), afternoon.
]`);
    expect(rendered.targetIndex.targets).toEqual([]);
    expect(rendered.conversationUsers).toEqual([]);
  });

  it("renders one participant and sorts owned fields by stable order", () => {
    const key = createBotKey("300000000000000001");
    const rendered = render([
      {
        key,
        reasons: new Set(["active_identity"]),
        displayName: "Tomori",
        aliases: [],
        primaryAlias: null,
        mentionable: false,
        isBot: true,
        fields: [visibleField(key, "- Later", 20), visibleField(key, "- Earlier", 10)],
      },
    ]);

    expect(rendered.text).toBe(`[System: The following users are having a conversation:

If Tomori wants to ping any of these users, prepend an "@" symbol to a unique mention handle shown below (case-insensitive). If there is ambiguity with names, ask for clarification instead of guessing. Use mentions only when the notification matters.

Tomori (This is you!)
- Earlier
- Later

Conversation context: #general (ID: 200000000000000001).
Current time: Aug 2, 2026, 02:00 PM (UTC+8), afternoon.
]`);
    expect(rendered.targetIndex.targets[0]).toMatchObject({
      serializedKey: "bot:300000000000000001",
      inParticipantContext: true,
    });
  });

  it("renders many participants with exact ambiguity guidance from one target index", () => {
    const first = humanProfile("400000000000000001", "Alice", "shared", ["- First B", "- First A"]);
    const second = humanProfile("400000000000000002", "Bob", "SHARED", ["- Second"]);
    const rendered = render([first, second]);

    expect(rendered.text).toBe(`[System: The following users are having a conversation:

If Tomori wants to ping any of these users, prepend an "@" symbol to a unique mention handle shown below (case-insensitive). If there is ambiguity with names, ask for clarification instead of guessing. Use mentions only when the notification matters.

Alice (Mention requires clarification)
- First A
- First B

Bob (Mention requires clarification)
- Second

Conversation context: #general (ID: 200000000000000001).
Current time: Aug 2, 2026, 02:00 PM (UTC+8), afternoon.
]`);
    expect(rendered.targetIndex.targets.map((target) => target.serializedKey)).toEqual([
      "discord_user:400000000000000001",
      "discord_user:400000000000000002",
    ]);
    expect(rendered.conversationUsers.map((target) => target.targetId)).toEqual([
      "400000000000000001",
      "400000000000000002",
    ]);
  });

  it("renders a neutral service-owned namespace entry after participant entries", () => {
    const profile = humanProfile("400000000000000001", "Mirri", "Mirri", ["- Verified relay identity"]);
    const rendered = render(
      [profile],
      [
        {
          serviceId: "fixture_service",
          namespaceKey: "namespace_1",
          sectionHeading: "Verified relay profiles:",
          entry: "- Lighthouse profile (relay source: Jordan, @jordan_h): Public relay notes.",
        },
      ],
    );

    expect(rendered.text).toContain(
      "Verified relay profiles:\n- Lighthouse profile (relay source: Jordan, @jordan_h): Public relay notes.",
    );
    expect(rendered.text.indexOf("Mirri")).toBeLessThan(rendered.text.indexOf("Verified relay profiles"));
    expect(rendered.text).not.toMatch(/shared account|\bmember\b|plural system/iu);
  });

  it("preserves a service entry that has no account relationship or description", () => {
    const rendered = render(
      [humanProfile("400000000000000001", "Mirri", "Mirri", ["- A fact"])],
      [
        {
          serviceId: "fixture_service",
          namespaceKey: "namespace_1",
          sectionHeading: "Verified relay profiles:",
          entry: "- Lighthouse profile",
        },
      ],
    );

    expect(rendered.text).toContain("Verified relay profiles:\n- Lighthouse profile\n");
    expect(rendered.text).not.toContain("shared account");
  });

  it("renders no namespace section when no service provides one", () => {
    const rendered = render([humanProfile("400000000000000001", "Mirri", "Mirri", ["- A fact"])]);

    expect(rendered.text).not.toContain("Verified relay profiles:");
  });
});
