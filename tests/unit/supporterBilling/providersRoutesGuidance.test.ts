import { beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { Client } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { supporterIdentityRepository, supporterSponsorshipRepository } from "@/modules/supporter-billing/db";
import { createProvidersInteractionRoute } from "@/utils/discord/interactions/providersRoutes";
import { parseInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import {
  buildProvidersRouteId,
  PERSONAL_PROVIDERS_ROUTE_NAMESPACE,
  PROVIDERS_ROUTE_NAMESPACE,
} from "@/utils/discord/providersPanelCatalog";
import { providerPanelOperations, type LoadedProviderPanelScope } from "@/utils/provider/providerPanelOperations";
import { initializeLocalizer } from "@/utils/text/localizer";
import { useEnvSandbox } from "../../helpers/env";
import { createPersona } from "../../helpers/fixtures";
import { localizedProse } from "../../helpers/localeCases";
import { createRouteInteraction } from "../../helpers/routeInteraction";

beforeAll(async () => initializeLocalizer());

const scope: LoadedProviderPanelScope = {
  state: { server_id: 42 } as TomoriState,
  data: {
    readStatus: "fresh",
    entries: [],
    initialEntryId: null,
  },
};

function parsed(customId: string) {
  const route = parseInteractionRoute(customId);
  if (!route) throw new Error("Expected a parsed route");
  return route;
}

describe("BYOK provider completion guidance", () => {
  useEnvSandbox(["RUN_ENV", "TOMORI_SUPPORTER_BILLING_ENABLED"]);

  it("adds guidance after a successful server or personal provider save, after acknowledgement", async () => {
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    const identitySpy = spyOn(supporterIdentityRepository, "loadByDiscordUserId").mockResolvedValue(null);
    const sponsorshipSpy = spyOn(supporterSponsorshipRepository, "loadActiveSponsorshipForServer").mockResolvedValue(
      null,
    );
    try {
      for (const personal of [true, false]) {
        const namespace = personal ? PERSONAL_PROVIDERS_ROUTE_NAMESPACE : PROVIDERS_ROUTE_NAMESPACE;
        const customId = buildProvidersRouteId(namespace, {
          action: "add-submit",
          locale: "en-US",
          nonce: "abcdefgh",
        });
        const interaction = createRouteInteraction({
          customId,
          kind: "modal",
          fields: { "api-key_abcdefgh": "test-provider-key" },
        });
        const localScope: LoadedProviderPanelScope = {
          ...scope,
          state: createPersona({ server_id: 42 }),
          ...(personal ? { scopeKind: "personal" as const, ownerId: 1 } : { scopeKind: "server" as const }),
          routeNamespace: namespace,
        };
        const route = createProvidersInteractionRoute(
          {
            takeProvider: () => "google",
            recordAction: () => {},
            resolveScope: async () => localScope,
            operations: {
              ...providerPanelOperations,
              addServerProvider: async () => {
                expect(interaction.deferred).toBe(true);
                return {
                  status: "success",
                  entryId: "provider:google",
                  displayName: "Google Gemini",
                  modelName: "test-model",
                  updated: false,
                };
              },
            },
          },
          { namespace, authorize: () => true, includeBrave: !personal, allowRotation: !personal },
        );
        await route.execute({} as Client, interaction as never, parsed(customId));
        expect(JSON.stringify(interaction.edits)).toMatch(
          localizedProse("en-US", "commands.subscribe.conversion_nudge"),
        );
      }
    } finally {
      identitySpy.mockRestore();
      sponsorshipSpy.mockRestore();
    }
  });
});
