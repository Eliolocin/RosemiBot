import { describe, expect, it } from "bun:test";
import { initializeLocalizer } from "@/utils/text/localizer";
import { buildModelRoutingControl, buildProviderPageEntries } from "@/utils/discord/ui/modelRoutingControls";
import { decodeProviderPageValue, encodeProviderPageValue } from "@/utils/discord/personalConfigPanelCatalog";
import { expectForEveryLocale, localizedCopy } from "../../helpers/localeCases";

await initializeLocalizer();

describe("shared model routing controls", () => {
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

  it("renders direct providers and bounds the current-value placeholder", () => {
    const row = buildModelRoutingControl({
      locale: "en-US",
      capabilityLabel: "Text",
      activeModelName: "x".repeat(200),
      activeProvider: "openrouter",
      eligibleProviders: ["openrouter", "custom:12"],
      customId: "routing:text",
      serverDefaultValue: "__server_default__",
      serverDefaultLabel: "Using Server Default",
      serverDefaultDisplay: "Using Server Default",
      providerOverflowValue: "__provider_range__",
      providerOverflowLabel: "Select Page",
      directProviderLimit: 24,
      encodeProviderValue: (provider) => provider.replace(":", "~"),
      disabled: false,
    });

    const select = row.components[0];
    expect(select.placeholder?.length).toBe(150);
    expect(select.options.map((option) => option.value)).toEqual(["__server_default__", "openrouter", "custom~12"]);
    expect(select.disabled).toBe(false);
  });

  it("routes overflow explicitly instead of truncating providers", () => {
    const providers = Array.from({ length: 25 }, (_, index) => `custom:${index + 1}`);
    const row = buildModelRoutingControl({
      locale: "en-US",
      capabilityLabel: "Text",
      activeModelName: null,
      activeProvider: null,
      eligibleProviders: providers,
      customId: "routing:text",
      serverDefaultValue: "__server_default__",
      serverDefaultLabel: "Using Server Default",
      serverDefaultDisplay: "Using Server Default",
      providerOverflowValue: "__provider_range__",
      providerOverflowLabel: "Select Page",
      directProviderLimit: 24,
      encodeProviderValue: (provider) => provider,
      disabled: false,
    });

    expect(row.components[0].options.map((option) => option.value)).toEqual([
      "__server_default__",
      "__provider_range__",
    ]);
  });
});

describe("provider page entries", () => {
  const encodeProviderValue = (provider: string) => provider.replace(/:/g, "~");

  it("expands only the provider whose options overflow one page", () => {
    const { entries, expandedStartIndex } = buildProviderPageEntries({
      providers: ["google", "openrouter", "custom:12"],
      expandedProvider: "openrouter",
      expandedOptionCount: 60,
      pageSize: 25,
      pageLabelKey: "commands.personal.config.provider_page_label",
      locale: "en-US",
      encodeProviderValue,
      encodePageValue: encodeProviderPageValue,
    });

    expect(entries.map((entry) => entry.value)).toEqual([
      "google",
      "page!0!openrouter",
      "page!25!openrouter",
      "page!50!openrouter",
      "custom~12",
    ]);
    expect(entries[1].label).toBe("OpenRouter (page 1)");
    expect(expandedStartIndex).toBe(1);
  });

  it("leaves a provider whole when its options fit one page", () => {
    const { entries, expandedStartIndex } = buildProviderPageEntries({
      providers: ["google", "openrouter"],
      expandedProvider: "openrouter",
      expandedOptionCount: 25,
      pageSize: 25,
      pageLabelKey: "commands.personal.config.provider_page_label",
      locale: "en-US",
      encodeProviderValue,
      encodePageValue: encodeProviderPageValue,
    });

    expect(entries.map((entry) => entry.value)).toEqual(["google", "openrouter"]);
    expect(expandedStartIndex).toBe(0);
  });

  it("round-trips a page value and rejects a bare provider value", () => {
    expect(decodeProviderPageValue(encodeProviderPageValue("custom:12", 50))).toEqual({
      provider: "custom:12",
      start: 50,
    });
    expect(decodeProviderPageValue("openrouter")).toBeNull();
    expect(decodeProviderPageValue("page!x!openrouter")).toBeNull();
    expect(decodeProviderPageValue("page!25!")).toBeNull();
  });
});
