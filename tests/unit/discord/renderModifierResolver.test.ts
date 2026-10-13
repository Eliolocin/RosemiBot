import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import type { PersonaSpriteRow, TomoriState } from "@/types/db/schema";
import type { StreamContext } from "@/types/stream/interfaces";
import { invalidatePersonaSpriteCache, setPersonaSpriteCache } from "@/utils/cache/personaSpriteCacheStore";
import { cache as tomoriStateCache } from "@/utils/cache/tomoriStateCacheStore";
import { resolveCopiedRenderModifierTarget } from "@/utils/discord/renderModifierResolver";
import { normalizePersonaSpriteKey } from "@/utils/persona/sprites";
import { buildPersonaAliases } from "@/utils/text/participants/aliases";
import { createPersonaKey, serializeParticipantKey } from "@/utils/text/participants/identity";
import { createPersona } from "../../helpers/fixtures";

const GUILD_ID = "300000000000000001";
const TOMORI_AVATAR = "https://cdn.example.test/tomori.png";
const SHOCKED_AVATAR = "https://cdn.example.test/tomori-shocked.png";

const locke = createPersona({ persona_id: 3, persona_lineage_id: 103, persona_nickname: "Locke", is_alter: true });
const tomori = createPersona({
  persona_id: 2,
  persona_lineage_id: 102,
  persona_nickname: "Tomori",
  webhook_avatar_url: TOMORI_AVATAR,
});

function shockedSprite(): PersonaSpriteRow {
  return {
    sprite_id: 21,
    persona_id: 2,
    sprite_name: "shocked",
    sprite_key: normalizePersonaSpriteKey("shocked"),
    avatar_url: SHOCKED_AVATAR,
    usage_instructions: "",
    is_identity: false,
  };
}

function streamContext(activePersona: TomoriState): StreamContext {
  const key = createPersonaKey(2);
  return {
    channel: { id: "300000000000000002", guild: { id: GUILD_ID } },
    tomoriState: activePersona,
    contextItems: [
      {
        role: "user",
        parts: [],
        participantTargetIndex: {
          targets: [
            {
              key,
              serializedKey: serializeParticipantKey(key),
              displayLabel: "Tomori (shocked)",
              primaryAlias: null,
              mentionable: false,
              inParticipantContext: true,
              aliases: buildPersonaAliases({ owner: key, nickname: "Tomori" }).aliases,
            },
          ],
          personaCatalogComplete: true,
        },
      },
    ],
  } as unknown as StreamContext;
}

describe("copied render modifier resolution", () => {
  beforeEach(() => {
    tomoriStateCache.set(GUILD_ID, { personas: [tomori, locke], mainPersona: tomori, cachedAt: Date.now() });
    setPersonaSpriteCache(2, [shockedSprite()]);
  });

  afterAll(() => {
    tomoriStateCache.delete(GUILD_ID);
    invalidatePersonaSpriteCache(2);
  });

  it("copies a persona under its clean nickname even when its last history line used a sprite", async () => {
    const target = await resolveCopiedRenderModifierTarget("Tomori", streamContext(locke), "Locke");

    expect(target).toMatchObject({
      identity: { username: "Tomori (Locke)", avatarUrl: TOMORI_AVATAR },
      contextLabel: "Locke (Tomori)",
    });
  });

  it("renders another persona's sprite avatar for a nested sprite label", async () => {
    const target = await resolveCopiedRenderModifierTarget("Tomori (SHOCKED)", streamContext(locke), "Locke");

    expect(target).toMatchObject({
      identity: { username: "Tomori (shocked) (Locke)", avatarUrl: SHOCKED_AVATAR },
      contextLabel: "Locke (Tomori (shocked))",
    });
    expect(target?.spriteRecord).toBeUndefined();
  });

  it("falls back to the copied persona's base look for a sprite it does not own", async () => {
    const target = await resolveCopiedRenderModifierTarget("Tomori (smug)", streamContext(locke), "Locke");

    expect(target).toMatchObject({
      identity: { username: "Tomori (Locke)", avatarUrl: TOMORI_AVATAR },
      contextLabel: "Locke (Tomori)",
    });
  });

  it("falls back to the base look when the sprite has no usable avatar", async () => {
    setPersonaSpriteCache(2, [{ ...shockedSprite(), avatar_url: "not a url" }]);

    const target = await resolveCopiedRenderModifierTarget("Tomori (shocked)", streamContext(locke), "Locke");

    expect(target?.identity).toMatchObject({ username: "Tomori (Locke)", avatarUrl: TOMORI_AVATAR });
  });

  it("does not resolve a nested label naming an unknown participant", async () => {
    await expect(
      resolveCopiedRenderModifierTarget("Pali (shocked)", streamContext(locke), "Locke"),
    ).resolves.toBeNull();
  });
});
