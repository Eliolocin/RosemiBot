import { describe, expect, it } from "bun:test";
import { officialMessageProxyInstanceFixture } from "../../../helpers/messageProxyInstance";
import type { PkMessageLookup } from "@/utils/messageProxy/services/pluralkit/api";
import {
  toPluralKitAttestation,
  toPluralKitIdentityInput,
} from "@/utils/messageProxy/services/pluralkit/identityAdapter";

const lookup: PkMessageLookup = {
  original: "original-1",
  sender: "sender-1",
  system: {
    id: "abcde",
    uuid: "11111111-2222-4333-8444-555555555555",
    name: "Lighthouse",
    tag: "[LH]",
    description: "Shared public context.",
  },
  member: {
    id: "fghij",
    uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    name: "Mirri",
    display_name: "Mirri Display",
    description: "Personal public context.",
    pronouns: "she/her",
  },
};

describe("PluralKit identity adapter", () => {
  it("maps canonical keys and cosmetic fields into the generic identity contract", () => {
    expect(toPluralKitIdentityInput(lookup)).toEqual({
      serviceId: "pluralkit",
      externalIdentityKind: "pluralkit_member",
      externalKey: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      shortId: "fghij",
      displayName: "Mirri Display",
      bio: "Personal public context.",
      pronouns: "she/her",
      namespace: {
        namespaceKey: "11111111-2222-4333-8444-555555555555",
        shortId: "abcde",
        displayName: "Lighthouse",
        tag: "[LH]",
        description: "Shared public context.",
      },
    });
  });

  it("normalizes blank and null pronouns to no seed value", () => {
    expect(
      toPluralKitIdentityInput({
        ...lookup,
        member: lookup.member ? { ...lookup.member, pronouns: "   " } : null,
      })?.pronouns,
    ).toBeNull();
    expect(
      toPluralKitIdentityInput({
        ...lookup,
        member: lookup.member ? { ...lookup.member, pronouns: null } : null,
      })?.pronouns,
    ).toBeNull();
    expect(
      toPluralKitIdentityInput({
        ...lookup,
        member: lookup.member ? { ...lookup.member, pronouns: undefined } : null,
      })?.pronouns,
    ).toBeNull();
  });

  it("uses the stable member name when the display name is private", () => {
    expect(
      toPluralKitIdentityInput({
        ...lookup,
        member: lookup.member ? { ...lookup.member, display_name: null } : null,
      })?.displayName,
    ).toBe("Mirri");
  });

  it("creates no stable identity when either member or system data is unavailable", () => {
    expect(toPluralKitIdentityInput({ ...lookup, member: null })).toBeNull();
    expect(toPluralKitIdentityInput({ ...lookup, system: null })).toBeNull();
    expect(toPluralKitIdentityInput({ ...lookup, member: null, system: null })).toBeNull();
  });

  it("retains authoritative correlation when stable identity data is unavailable", () => {
    expect(
      toPluralKitAttestation(
        "proxy-1",
        { ...lookup, member: null, system: null },
        officialMessageProxyInstanceFixture("pluralkit"),
      ),
    ).toEqual({
      serviceId: "pluralkit",
      instanceId: "pluralkit:official",
      proxyMessageId: "proxy-1",
      originalMessageId: "original-1",
      senderDiscordId: "sender-1",
      identity: null,
    });
  });
});
