import { beforeAll, describe, expect, it } from "bun:test";
import { ComponentType } from "discord.js";
import type { ProviderPanelEntry, ProviderPanelOptionAction } from "@/types/discord/providerPanel";
import type { SupporterProviderOptionData } from "@/modules/supporter-billing/discord/providerOption";
import { findProviderOption, providerOptionActionValue } from "@/utils/provider/providerOptionRegistry";
import { PERSONAL_PROVIDERS_ROUTE_NAMESPACE } from "@/utils/discord/providersPanelCatalog";
import { parseInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import { parseSubscriptionRoute } from "@/modules/supporter-billing/subscribe/catalog";
import { buildProvidersPanelPayload } from "@/utils/discord/ui/providersPanel";
import { initializeLocalizer, hasLocaleKey } from "@/utils/text/localizer";
import { localizedCopy, expectForEveryLocale } from "../../helpers/localeCases";
import { escapeDiscordMarkdown } from "@/utils/text/discordMarkdown";

beforeAll(async () => initializeLocalizer());

describe("providers panel subscription entries", () => {
  const SUBSCRIBER = "123456789012345678";
  it("renders a sponsor mention when no saved display name exists and escapes saved names", () => {
    expectForEveryLocale((locale) => {
      for (const sponsorLabel of [undefined, "*Mirri*"]) {
        const entry: ProviderPanelEntry = {
          ...providerEntry("provider:supporter", "supporter"),
          optionData: {
            sponsorshipId: 40,
            sponsorDiscId: SUBSCRIBER,
            sponsorLabel,
          } satisfies SupporterProviderOptionData,
        };
        const panel = buildProvidersPanelPayload({
          locale,
          entries: [entry],
          initialEntryId: entry.id,
          readStatus: "fresh",
          page: { kind: "entry" },
        });
        const copyLocale = hasLocaleKey(locale, "commands.providers.sponsorship_by") ? locale : "en-US";
        const expected = localizedCopy(copyLocale, "commands.providers.sponsorship_by", {
          name: sponsorLabel ? escapeDiscordMarkdown(sponsorLabel) : `<@${SUBSCRIBER}>`,
        });
        const content = collectComponents(panel)
          .flatMap((part) => (typeof part.content === "string" ? [part.content] : []))
          .join("\n");
        expect(content).toContain(expected);
      }
    });
  });
  const OTHER_MEMBER = "223456789012345678";

  function collectComponents(value: unknown): Array<Record<string, unknown>> {
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const nested = Array.isArray(record.components) ? record.components.flatMap(collectComponents) : [];
    const component = record.component ? collectComponents(record.component) : [];
    return [record, ...nested, ...component];
  }

  function providerEntry(id: string, name = "Google"): ProviderPanelEntry {
    return {
      id,
      kind: "provider",
      provider: name.toLowerCase(),
      displayName: name,
      savedAt: null,
      rotationKeyCount: 2,
      capabilities: [
        {
          capability: "text",
          availability: "available",
          models: [
            {
              id: 1,
              codeName: "gemini/example-model",
              isWorkspaceActive: true,
              isWorkspaceFallback: false,
              isProviderFallback: true,
              isCustomRegistration: true,
              textSettings: {
                numCtx: 8192,
                hasTools: true,
                seesImages: true,
                supportsStructOutput: false,
                strictRoleAlternation: false,
                supportsPrefixCompletion: true,
                supportsAssistantPrefill: false,
                verbatimToolCalling: false,
              },
            },
          ],
        },
        { capability: "image", availability: "available", models: [] },
        { capability: "embedding", availability: "available", models: [] },
        { capability: "video", availability: "available", models: [] },
        { capability: "speech", availability: "unavailable", models: [] },
        { capability: "transcription", availability: "unavailable", models: [] },
      ],
    };
  }

  function subscriptionOptionValue(): string {
    const option = findProviderOption("supporter");
    if (!option) throw new Error("Expected the registered Subscription option");
    return providerOptionActionValue(option);
  }

  function subscriptionOptionAction(personal: boolean): ProviderPanelOptionAction {
    const option = findProviderOption("supporter");
    if (!option) throw new Error("Expected the registered Subscription option");
    return {
      value: providerOptionActionValue(option),
      labelKey: option.copy.addActionLabelKey,
      descriptionKey: option.copy.addActionDescriptionKeys[personal ? "personal" : "server"],
    };
  }

  it("offers the same subscription onboarding action for unsponsored server and personal panels", () => {
    expectForEveryLocale((locale) => {
      for (const personal of [true, false]) {
        for (const available of [true, false]) {
          const panel = buildProvidersPanelPayload({
            locale,
            entries: [],
            initialEntryId: null,
            readStatus: "fresh",
            page: { kind: "entry" },
            routeNamespace: personal ? PERSONAL_PROVIDERS_ROUTE_NAMESPACE : undefined,
            optionActions: available ? [subscriptionOptionAction(personal)] : [],
          });
          const options = collectComponents(panel)
            .filter((component) => component.type === ComponentType.StringSelect)
            .flatMap((component) => component.options as Array<{ value: string; label: string; description: string }>);
          const action = options.find((option) => option.value === subscriptionOptionValue());
          if (!available) {
            expect(action).toBeUndefined();
            continue;
          }
          expect(action?.label).toBe(localizedCopy(locale, "commands.providers.subscribe"));
          expect(action?.description).toBe(
            localizedCopy(
              locale,
              personal
                ? "commands.providers.subscribe_personal_description"
                : "commands.providers.sponsor_server_description",
            ),
          );
        }
      }
    });
  });

  it("keeps one subscription selector entry and leaves activation to the model controls", () => {
    expectForEveryLocale((locale) => {
      for (const personal of [true, false]) {
        for (const active of [true, false]) {
          const entry = providerEntry("provider:supporter", "supporter");
          if (entry.kind !== "provider") throw new Error("Expected a provider entry");
          if (!personal)
            entry.optionData = { sponsorshipId: 40, sponsorDiscId: SUBSCRIBER } satisfies SupporterProviderOptionData;
          for (const section of entry.capabilities)
            for (const model of section.models) model.isWorkspaceActive = active;
          const panel = buildProvidersPanelPayload({
            locale,
            entries: [entry],
            initialEntryId: entry.id,
            readStatus: "fresh",
            page: { kind: "entry" },
            routeNamespace: personal ? PERSONAL_PROVIDERS_ROUTE_NAMESPACE : undefined,
            viewerId: SUBSCRIBER,
          });
          const components = collectComponents(panel);
          const selectors = components.filter((component) => component.type === ComponentType.StringSelect);
          const options = selectors.flatMap(
            (component) => component.options as Array<{ value: string; label: string }>,
          );
          expect(options.filter((option) => option.value === "provider:supporter")).toHaveLength(1);
          expect(options.some((option) => option.value === subscriptionOptionValue())).toBe(false);
          const subscriptionActions = components
            .filter((component) => component.type === ComponentType.Button && typeof component.customId === "string")
            .map((component) => parseInteractionRoute(String(component.customId)))
            .flatMap((parsed) => {
              const route = parsed && parseSubscriptionRoute(parsed);
              return route ? [route.action] : [];
            });
          expect(subscriptionActions).toEqual(personal ? ["overview"] : ["overview", "remove"]);
        }
      }
    });
  });

  it("keeps personal subscription model controls and opens private management instead of editing a key", () => {
    expectForEveryLocale((locale) => {
      const panel = buildProvidersPanelPayload({
        locale,
        entries: [providerEntry("provider:supporter", "supporter")],
        initialEntryId: "provider:supporter",
        readStatus: "fresh",
        page: { kind: "entry" },
        enabledActions: new Set(["model", "edit", "remove"]),
        routeNamespace: PERSONAL_PROVIDERS_ROUTE_NAMESPACE,
        viewerId: SUBSCRIBER,
      });
      const components = collectComponents(panel);
      const labels = components.map((component) => component.label);
      const manageKey = "commands.providers.manage_subscription";
      const manage = components.find(
        (component) => component.label === localizedCopy(hasLocaleKey(locale, manageKey) ? locale : "en-US", manageKey),
      );
      expect(typeof manage?.customId === "string" && manage.customId.startsWith("subscription:v1:overview:")).toBe(
        true,
      );
      for (const key of [
        "commands.providers.edit_provider",
        "commands.providers.remove_provider",
        "commands.providers.remove_sponsorship",
      ]) {
        expect(labels).not.toContain(localizedCopy(hasLocaleKey(locale, key) ? locale : "en-US", key));
      }
      expect(
        components.some(
          (component) => component.customId === `personal-providers:v1:model-select:${locale}:provider:supporter`,
        ),
      ).toBe(true);
    });
  });

  it("enables server sponsorship removal only for the sponsor or a server manager", () => {
    const entry: ProviderPanelEntry = {
      ...providerEntry("provider:supporter", "supporter"),
      optionData: {
        sponsorshipId: 40,
        sponsorDiscId: SUBSCRIBER,
        sponsorLabel: "Mirri",
      } satisfies SupporterProviderOptionData,
    };
    for (const [viewerId, canManageServer, enabled] of [
      [SUBSCRIBER, false, true],
      [OTHER_MEMBER, true, true],
      [OTHER_MEMBER, false, false],
    ] as const) {
      const components = collectComponents(
        buildProvidersPanelPayload({
          locale: "en-US",
          entries: [entry],
          initialEntryId: "provider:supporter",
          readStatus: "fresh",
          page: { kind: "entry" },
          enabledActions: new Set(["model", "edit", "remove"]),
          viewerId,
          canManageServer,
        }),
      );
      const removal = components.find(
        (component) => component.label === localizedCopy("en-US", "commands.providers.remove_sponsorship"),
      );
      expect(removal?.disabled).toBe(!enabled);
      expect(
        components.some(
          (component) => component.label === localizedCopy("en-US", "commands.providers.manage_subscription"),
        ),
      ).toBe(viewerId === SUBSCRIBER);
      const parsed = typeof removal?.customId === "string" ? parseInteractionRoute(removal.customId) : null;
      expect(parsed?.segments[0]).toBe("remove");
      expect(parsed?.segments[4]).toBe("40");
    }
  });
});
