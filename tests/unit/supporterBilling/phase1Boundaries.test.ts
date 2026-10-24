import { beforeAll, describe, expect, it } from "bun:test";
import type { Client } from "discord.js";

import { SETUP_DRAFT_SCHEMA_VERSION, type SetupDraftRecord } from "@/types/discord/setupWizard";
import { storeSetupDraft } from "@/utils/discord/interactions/setupDraftStore";
import { buildSetupProviderModeRouteId, setupInteractionRoute } from "@/utils/discord/interactions/setupRoutes";
import { parseInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import { isHostedPolicyEnvironment } from "@/utils/misc/hostedPolicy";
import { buildAddProviderModal } from "@/utils/discord/ui/providersPanel";
import { PERSONAL_PROVIDERS_ROUTE_NAMESPACE, PROVIDERS_ROUTE_NAMESPACE } from "@/utils/discord/providersPanelCatalog";
import { initializeLocalizer } from "@/utils/text/localizer";
import { useEnvSandbox } from "../../helpers/env";
import { createRouteInteraction } from "../../helpers/routeInteraction";

describe("supporter billing Phase 1 boundaries", () => {
  it("keeps the subscribe command behind the supporter billing gate", async () => {
    const commandFile = Bun.file("src/commands/subscribe.ts");

    expect(await commandFile.exists()).toBe(true);
    expect(await commandFile.text()).toContain("isCommandEnabled");
  });

  it("keeps unconditional database schema, migrations, and seed catalogs free of billing tables", async () => {
    const schemaFiles = ["src/db/schema.sql", "src/db/schema_rag.sql", "src/db/schema_stpreset.sql"];

    for (const schemaFile of schemaFiles) {
      const schemaText = await Bun.file(schemaFile).text();
      expect(schemaText).not.toContain("supporter_");
    }

    const migrationGlob = new Bun.Glob("*.sql");
    for await (const migrationFile of migrationGlob.scan({ cwd: "src/db/migrations" })) {
      const migrationText = await Bun.file(`src/db/migrations/${migrationFile}`).text();
      expect(migrationText).not.toContain("supporter_");
    }

    const seedCatalogGlob = new Bun.Glob("**/*.ts");
    for await (const seedCatalogFile of seedCatalogGlob.scan({ cwd: "src/db/seed/catalog" })) {
      const seedCatalogText = await Bun.file(`src/db/seed/catalog/${seedCatalogFile}`).text();
      expect(seedCatalogText).not.toContain("supporter_");
    }
  });

  it("keeps broad help copy free of ungated supporter setup guidance", async () => {
    const helpFiles = ["src/locales/en-US/commands/help.ts", "src/locales/ja/commands/help.ts"];

    for (const file of helpFiles) {
      const text = await Bun.file(file).text();
      expect(text).not.toContain("/subscribe");
      expect(text).not.toContain("Supporter");
    }
  });
});

describe("supporter choices in current panels", () => {
  useEnvSandbox(["RUN_ENV", "TOMORI_SUPPORTER_BILLING_ENABLED"]);
  beforeAll(async () => initializeLocalizer());

  async function renderSetupThroughRoute(draft: SetupDraftRecord, nonce: string): Promise<unknown> {
    const interaction = createRouteInteraction({
      customId: buildSetupProviderModeRouteId({ locale: "en-US", nonce }),
      kind: "string-select",
      values: ["custom-endpoint"],
      guildId: draft.context === "guild" ? draft.workspaceKey : null,
    });
    Object.assign(interaction, { isMessageComponent: () => true });
    storeSetupDraft(nonce, {
      ...draft,
      actorDiscId: interaction.user.id,
      workspaceKey: interaction.guildId ?? interaction.user.id,
      requiresPolicies: isHostedPolicyEnvironment(),
    });
    const route = parseInteractionRoute(interaction.customId);
    if (!route) throw new Error("Expected setup selection route");
    await setupInteractionRoute.execute({} as Client, interaction as never, route);
    return interaction.calls.find((call) => call.method === "update")?.payload;
  }

  it("gates server sponsorship and personal subscription choices on production billing", async () => {
    for (const [environment, enabled, expected] of [
      ["development", "true", false],
      ["production", "false", false],
      ["production", "true", true],
    ] as const) {
      process.env.RUN_ENV = environment;
      process.env.TOMORI_SUPPORTER_BILLING_ENABLED = enabled;
      for (const context of ["guild", "dm"] as const) {
        const draft: SetupDraftRecord = {
          schemaVersion: SETUP_DRAFT_SCHEMA_VERSION,
          actorDiscId: "actor_1",
          workspaceKey: context === "guild" ? "guild_1" : "actor_1",
          context,
          providerAccess: null,
          startingSettings: null,
          policiesAccepted: false,
          requiresPolicies: false,
        };
        const setup = await renderSetupThroughRoute(draft, `gate-${environment}-${enabled}-${context}`);
        const providers = buildAddProviderModal("en-US", "supporter-gate", PROVIDERS_ROUTE_NAMESPACE, true);
        const offered = expected && context === "guild";
        expect(JSON.stringify(setup).includes('"value":"option:supporter"')).toBe(offered);
        expect(JSON.stringify(providers).includes('"value":"supporter"')).toBe(false);
        const apiKey = providers.components[1]?.component;
        expect(apiKey?.required).toBe(true);
        const personal = buildAddProviderModal("en-US", "supporter-gate", PERSONAL_PROVIDERS_ROUTE_NAMESPACE, false);
        expect(JSON.stringify(personal).includes('"value":"supporter"')).toBe(false);
        expect(personal.components[1]?.component?.required).toBe(true);
      }
    }
  });
});
