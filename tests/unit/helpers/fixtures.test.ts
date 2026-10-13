/**
 * Guards the shared fixture factories. These tests assert the factory contract rather than app
 * behavior, so a change to {@link BASE_CONFIG} or a schema default surfaces here instead of as an
 * unexplained failure in an unrelated suite.
 */

import { describe, expect, it } from "bun:test";
import { PrivacyLevel, assembledServerConfigSchema, tomoriStateSchema, userSchema } from "@/types/db/schema";
import {
  createLlmRow,
  createPersona,
  createServerConfig,
  createUserRow,
  createCustomExpression,
} from "../../helpers/fixtures";

/** As `loadServerState` reads them after setup with nothing changed. */
function schemaConfigDefaults() {
  return assembledServerConfigSchema.parse({
    llm_id: 1,
    api_key: null,
    other_model_capabilities: null,
    llm_disabled_params: [],
    fallback_llm_ids: [],
    llm_stop_strings: [],
    llm_logit_biases: [],
    fallback_model_refs: [],
    tool_notice_hidden_keys: [],
    autoch_persona_overrides: [],
    deliberate_tool_triggers: {},
  });
}

describe("shared fixture factories", () => {
  it("keeps custom expression overrides scoped and validates the stored media shape", () => {
    expect(createCustomExpression({ restricted: true, persona_ids: [3] })).toMatchObject({
      restricted: true,
      persona_ids: [3],
    });
    expect(() => createCustomExpression({ delivery_kind: "stored", storage_reference: null })).toThrow();
  });
  it("keeps the default config on the schema's declared defaults", () => {
    const schemaDefaults = schemaConfigDefaults() as Record<string, unknown>;
    const fixture = createServerConfig() as Record<string, unknown>;

    const drifted = Object.keys(schemaDefaults).filter(
      (key) => JSON.stringify(fixture[key]) !== JSON.stringify(schemaDefaults[key]),
    );

    expect(drifted).toEqual([]);
  });

  it("keeps every config key the schema declares", () => {
    const declared = Object.keys(schemaConfigDefaults()).sort();
    expect(Object.keys(createServerConfig()).sort()).toEqual(declared);
  });

  it("keeps the identity defaults a migrated suite would silently inherit", () => {
    // A migration that swaps a hand-written row for this factory also swaps these values, and a
    // suite that pins an actor snowflake in an assertion goes red far from here. Pin them.
    const persona = createPersona();
    expect({
      server_id: persona.server_id,
      persona_id: persona.persona_id,
      persona_lineage_id: persona.persona_lineage_id,
      persona_nickname: persona.persona_nickname,
      is_alter: persona.is_alter,
      llm_codename: persona.llm.llm_codename,
      llm_provider: persona.llm.llm_provider,
    }).toEqual({
      server_id: 1,
      persona_id: 1,
      persona_lineage_id: 100,
      persona_nickname: "Mirri",
      is_alter: false,
      llm_codename: "gemini-2.5-flash",
      llm_provider: "google",
    });

    const user = createUserRow();
    expect({
      user_id: user.user_id,
      user_disc_id: user.user_disc_id,
      user_nickname: user.user_nickname,
      registration_locale: user.registration_locale,
      language_pref: user.language_pref,
      privacy_level: user.privacy_level,
    }).toEqual({
      user_id: 1,
      user_disc_id: "user-1",
      user_nickname: null,
      registration_locale: "en-US",
      language_pref: "en-US",
      privacy_level: PrivacyLevel.MINIMAL,
    });
  });

  it("produces a persona that satisfies the Tomori state schema", () => {
    expect(tomoriStateSchema.safeParse(createPersona()).success).toBe(true);
  });

  it("produces a user row that satisfies the user schema", () => {
    expect(userSchema.safeParse(createUserRow()).success).toBe(true);
  });

  it("gives each caller its own config so a mutation cannot leak between fixtures", () => {
    const first = createPersona();
    first.config.llm_stop_strings.push("User:");
    first.config.autoch_disc_ids.push("123456789012345678");
    first.naming_config.addressTerms.neutral = "you";

    const second = createPersona();
    expect(second.config.llm_stop_strings).toEqual([]);
    expect(second.config.autoch_disc_ids).toEqual([]);
    expect(second.naming_config.addressTerms).toEqual({});
  });

  it("merges config overrides onto the defaults instead of replacing the config", () => {
    const persona = createPersona({ config: { llm_temperature: 0.4 } });

    expect(persona.config.llm_temperature).toBe(0.4);
    expect(persona.config.llm_id).toBe(1);
    expect(persona.config.message_fetch_limit).toBe(80);
  });

  it("applies identity overrides without disturbing the remaining defaults", () => {
    const persona = createPersona({ persona_id: 7, persona_lineage_id: 106, persona_nickname: "Juno" });

    expect(persona.persona_id).toBe(7);
    expect(persona.persona_lineage_id).toBe(106);
    expect(persona.persona_nickname).toBe("Juno");
    expect(persona.is_alter).toBe(false);
    expect(persona.server_id).toBe(1);
  });

  it("gives each caller its own default model row", () => {
    const first = createLlmRow();
    first.llm_codename = "changed";

    expect(createLlmRow().llm_codename).toBe("gemini-2.5-flash");
  });

  it("resolves every capability flag on the default model row", () => {
    // A flag left undefined reads as false only by accident of coercion. Production reads the
    // column, so the fixture must carry that same boolean for every flag the schema declares.
    const row = createLlmRow() as Record<string, unknown>;
    const flags = Object.keys(row).filter((key) => typeof row[key] === "boolean");

    expect(flags).toEqual([
      "is_scoped_registration",
      "is_smartest",
      "is_default",
      "is_reasoning",
      "is_deprecated",
      "is_free",
      "has_tools",
      "sees_images",
      "sees_videos",
      "sees_youtube",
      "is_uncensored",
      "supports_structoutput",
      "strict_role_alternation",
      "supports_prefix_completion",
      "supports_assistant_prefill",
      "verbatim_tool_calling",
    ]);
    expect(row.has_tools).toBe(true);
    expect(row.sees_images).toBe(true);
    expect(row.sees_videos).toBe(false);
  });
});
