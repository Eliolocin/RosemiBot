import { describe, expect, it } from "bun:test";
import { pluralKitPresentation } from "@/utils/messageProxy/services/pluralkit/presentation";
import type { MessageProxyIdentityContext } from "@/utils/messageProxy/types";

function context(overrides: Partial<MessageProxyIdentityContext> = {}): MessageProxyIdentityContext {
  return {
    serviceId: "pluralkit",
    instanceId: "pluralkit:official",
    userDiscId: "pk:11111111-2222-4333-8444-555555555555",
    externalIdentityId: 1,
    externalKey: "11111111-2222-4333-8444-555555555555",
    identityShortId: "Mirri",
    displayName: "Mirri",
    namespaceId: 2,
    namespaceKey: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    namespaceShortId: "light",
    namespaceDisplayName: "Lighthouse",
    namespaceTag: "[LH]",
    namespaceDescription: "Shared public notes.",
    hostUserDiscIds: ["host-1"],
    ...overrides,
  };
}

describe("PluralKit presentation", () => {
  it("uses the system name, then tag, then an unnamed privacy-safe fallback", () => {
    expect(pluralKitPresentation.namespacePresentation(context({ namespaceDescription: null }), []).entry).toBe(
      '- The "Lighthouse" plural system',
    );
    expect(
      pluralKitPresentation.namespacePresentation(
        context({ namespaceDisplayName: null, namespaceDescription: null }),
        [],
      ).entry,
    ).toBe("- [LH] plural system");
    expect(
      pluralKitPresentation.namespacePresentation(
        context({ namespaceDisplayName: " ", namespaceTag: null, namespaceDescription: null }),
        [],
      ).entry,
    ).toBe("- A plural system");
  });

  it("owns shared-account wording and normalizes a live namespace description", () => {
    expect(
      pluralKitPresentation.namespacePresentation(context({ namespaceDescription: "Line one.\n\nLine two." }), [
        "Jordan, @jordan_h",
      ]).entry,
    ).toBe('- The "Lighthouse" plural system (shared account: Jordan, @jordan_h): Line one. Line two.');
    expect(pluralKitPresentation.namespacePresentation(context({ namespaceDescription: "  " }), []).entry).toBe(
      '- The "Lighthouse" plural system',
    );
  });
});
