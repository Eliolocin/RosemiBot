import { describe, expect, it } from "bun:test";
import { buildModelRoutingControl, buildProviderPageEntries } from "@/utils/discord/ui/modelRoutingControls";
import { encodeProviderPageValue } from "@/utils/discord/personalConfigPanelCatalog";
import { initializeLocalizer } from "@/utils/text/localizer";
import { expectForEveryLocale, localizedCopy } from "../../helpers/localeCases";

await initializeLocalizer();

describe("subscription model routing controls", () => {
  it("localizes subscription options and current values while preserving provider routing", () => {
    expectForEveryLocale((locale) => {
      const label = localizedCopy(locale, "commands.providers.subscription_label");
      for (const pageLabelKey of [
        "commands.config.panel.provider_page_label",
        "commands.personal.config.provider_page_label",
      ]) {
        const input = {
          providers: ["supporter", "openrouter"],
          expandedProvider: null,
          expandedOptionCount: 0,
          pageSize: 25,
          locale,
          pageLabelKey,
          encodeProviderValue: (provider: string) => provider,
          encodePageValue: encodeProviderPageValue,
        };
        const direct = buildProviderPageEntries(input);
        expect(direct.entries[0]).toEqual({ value: "supporter", label });
        const expanded = buildProviderPageEntries({ ...input, expandedProvider: "supporter", expandedOptionCount: 26 });
        expect(expanded.entries[0]).toEqual({
          value: encodeProviderPageValue("supporter", 0),
          label: localizedCopy(locale, pageLabelKey, { provider: label, page: 1 }),
        });
      }
      const row = buildModelRoutingControl({
        locale,
        capabilityLabel: localizedCopy(locale, "commands.config.panel.capability_text"),
        activeModelName: "example/model",
        activeProvider: "supporter",
        eligibleProviders: ["supporter"],
        customId: "routing:text",
        serverDefaultDisplay: "",
        disabled: false,
      });
      expect(row.components[0].options[0]).toEqual({ value: "supporter", label });
      expect(row.components[0].placeholder).toContain(label);
    });
  });
});
