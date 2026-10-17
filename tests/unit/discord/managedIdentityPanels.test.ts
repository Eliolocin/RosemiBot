import { beforeAll, describe, expect, it, mock } from "bun:test";
import type { Client } from "discord.js";
import { PrivacyLevel } from "@/types/db/schema";
import { parseInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import type { GlobalRoutableInteraction } from "@/utils/discord/interactions/routeRegistry";
import { identityConfigInteractionRoute } from "@/utils/discord/interactions/personalConfigRoutes";
import { identityMemoriesInteractionRoute } from "@/utils/discord/interactions/personalMemoriesRoutes";
import {
  messageProxyRepository,
  type MessageProxyManagedIdentity,
} from "@/utils/db/repositories/MessageProxyRepository";
import {
  IDENTITY_CONFIG_VERSION,
  IDENTITY_MEMORIES_VERSION,
  formatManagedIdentityLabel,
  parseManagedIdentityRoute,
  rewriteManagedIdentityRouteIds,
} from "@/utils/discord/interactions/managedIdentityPanelRoutes";
import { buildPersonalConfigPanelPayload } from "@/utils/discord/ui/personalConfigPanel";
import { buildPersonalMemoriesPanelPayload } from "@/utils/discord/ui/personalMemoriesPanel";
import { formatMessageProxyIdentityUserId } from "@/utils/messageProxy/identityUserId";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createUserRow } from "../../helpers/fixtures";
import { expectForEveryLocale, localizedCopy } from "../../helpers/localeCases";

beforeAll(async () => initializeLocalizer());

describe("managed identity panels", () => {
  it("shows the instance name only when it distinguishes a custom identity", () => {
    const official: MessageProxyManagedIdentity = {
      identityId: 1,
      userId: 2,
      userDiscId: formatMessageProxyIdentityUserId("pluralkit", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"),
      serviceId: "pluralkit",
      instanceId: "pluralkit:official",
      instanceDisplayName: "PluralKit",
      displayName: "Mirri",
      avatarUrl: null,
    };
    const custom: MessageProxyManagedIdentity = {
      ...official,
      identityId: 3,
      userId: 3,
      instanceId: "pluralkit:11111111-2222-4333-8444-555555555555",
      userDiscId: formatMessageProxyIdentityUserId(
        "pluralkit",
        "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        "pluralkit:11111111-2222-4333-8444-555555555555",
      ),
      instanceDisplayName: "OurKitty",
    };
    const pluralbuddy: MessageProxyManagedIdentity = {
      ...official,
      identityId: 4,
      userId: 4,
      serviceId: "pluralbuddy",
      instanceId: "pluralbuddy:official",
      userDiscId: formatMessageProxyIdentityUserId("pluralbuddy", "123"),
      instanceDisplayName: "PluralBuddy",
    };
    expectForEveryLocale((locale) => {
      const pluralkitName = localizedCopy(locale, "commands.personal.message-proxy.pluralkit_option");
      const pluralbuddyName = localizedCopy(locale, "commands.personal.message-proxy.pluralbuddy_option");
      expect(formatManagedIdentityLabel(official, locale)).toBe(`Mirri (${pluralkitName})`);
      expect(formatManagedIdentityLabel(custom, locale)).toBe(`Mirri (${pluralkitName}: OurKitty)`);
      expect(formatManagedIdentityLabel(pluralbuddy, locale)).toBe(`Mirri (${pluralbuddyName})`);
    });
  });

  it("rechecks ownership for forged config buttons and memory modals", async () => {
    const originalLookup = messageProxyRepository.getManagedIdentity;
    messageProxyRepository.getManagedIdentity = async () => null;
    try {
      for (const [routeId, handler] of [
        ["personal-config:v3:42:naming-open:en-US", identityConfigInteractionRoute],
        ["personal-memories:v2:42:add-submit:en-US:global:0:nonce1234567", identityMemoriesInteractionRoute],
      ] as const) {
        const route = parseInteractionRoute(routeId);
        expect(route).not.toBeNull();
        if (!route) continue;
        const reply = mock(async () => undefined);
        const interaction = {
          customId: routeId,
          locale: "en-US",
          user: { id: "unlinked-host" },
          isButton: () => true,
          reply,
        } as unknown as GlobalRoutableInteraction;
        await handler.execute({} as Client, interaction, route);
        expect(reply).toHaveBeenCalledTimes(1);
      }
    } finally {
      messageProxyRepository.getManagedIdentity = originalLookup;
    }
  });
  it("limits identity config to profile pages and preserves identity in controls", () => {
    const payload = buildPersonalConfigPanelPayload({
      locale: "en-US",
      category: "profile",
      page: "general",
      identityMode: true,
      identityLabel: "Juno (PluralBuddy)",
      user: createUserRow({ user_nickname: "Juno" }),
      resolvedNickname: "Juno",
      personas: [],
      guildId: null,
      memoryCount: 0,
      stmCount: 0,
      readStatus: "fresh",
      userAvatarUrl: null,
    });
    rewriteManagedIdentityRouteIds(payload, "personal-config", "v2", IDENTITY_CONFIG_VERSION, 42);
    const wire = JSON.stringify(payload);
    expect(wire).toContain("personal-config:v3:42:naming-open");
    expect(wire).toContain("PluralBuddy");
    expect(wire).not.toContain("language-open");
    expect(wire).not.toContain("timezone-open");
    expect(wire).not.toContain("personal-config:v3:42:category");
    const route = parseInteractionRoute("personal-config:v3:42:naming-open:en-US");
    expect(route && parseManagedIdentityRoute(route, "v2")?.identityId).toBe(42);
  });

  it("keeps identity memory editing and removes host short-term controls", () => {
    const payload = buildPersonalMemoriesPanelPayload({
      locale: "en-US",
      category: "global",
      selectedLineageId: 0,
      personas: [],
      memories: [],
      stmCount: 0,
      privacyLevel: PrivacyLevel.MINIMAL,
      readStatus: "fresh",
      page: { kind: "main" },
      identityMode: true,
      identityLabel: "Juno (PluralBuddy)",
      userAvatarUrl: null,
    });
    rewriteManagedIdentityRouteIds(payload, "personal-memories", "v1", IDENTITY_MEMORIES_VERSION, 42);
    const wire = JSON.stringify(payload);
    expect(wire).toContain("personal-memories:v2:42:category");
    expect(wire).toContain("personal-memories:v2:42:select");
    expect(wire).not.toContain("stm-clear");
  });
});
