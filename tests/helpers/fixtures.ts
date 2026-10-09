/**
 * Shared typed fixture factories for database rows.
 *
 * Every factory takes `Partial<T>` overrides and returns a complete row typed against the real schema
 * type, so a schema change breaks compilation here instead of leaving the fixture on an older shape.
 * `fixtures.test.ts` guards what a type cannot state: the default values and the override merge.
 * Identity values (ids, snowflakes, model codenames) are placeholders; a test that needs a second row
 * overrides them, as in `createPersona({ persona_id: 2, persona_lineage_id: 101 })`.
 */

import type { AssembledServerConfig, LlmRow, TomoriState, UserRow } from "@/types/db/schema";
import { PrivacyLevel } from "@/types/db/schema";
import { customExpressionSchema, type CustomExpressionRow } from "@/types/db/schema";
import { EmotionKey } from "@/types/misc/emotions";
import { EMPTY_PERSONA_NAMING_CONFIG } from "@/types/personaNaming";
import { DEFAULT_IMAGE_NEGATIVE_TAGS, DEFAULT_IMAGE_POSITIVE_TAGS } from "@/utils/image/tagDefaults";

/**
 * Default `config` values, mirroring the column defaults the server config tables declare.
 *
 * A persona load assembles its config from several tables, so a fixture that starts from the
 * declared defaults matches what production reads after setup with nothing changed.
 * `fixtures.test.ts` fails when a schema default moves away from the value recorded here.
 */
const BASE_CONFIG: AssembledServerConfig = {
  response_reviewer_llm_id: null,
  response_decision_model_id: null,
  response_reviewer_prompt: null,
  response_rule_checker_ref: null,
  response_drafting_enabled: false,
  llm_id: 1,
  api_key: null,
  key_version: 1,
  llm_temperature: 1,
  thinking_level: "auto",
  llm_disabled_params: [],
  fallback_llm_ids: [],
  other_model_capabilities: null,
  hide_respond_embed: false,
  humanizer_degree: 1,
  message_fetch_limit: 80,
  send_message_limit: 0,
  match_limit: 3,
  cascade_limit: 3,
  timezone_offset: 0,
  self_debug_enabled: false,
  model_randomizer_enabled: false,
  context_note_depth: 0,
  llm_stop_strings: [],
  llm_stop_speaker_pattern_enabled: false,
  llm_top_p: 0.95,
  llm_top_k: 0,
  llm_frequency_penalty: 0,
  llm_presence_penalty: 0,
  llm_min_p: 0.05,
  llm_logit_biases: [],
  fallback_model_refs: [],
  server_memteaching_enabled: false,
  attribute_memteaching_enabled: false,
  sampledialogue_memteaching_enabled: false,
  self_teaching_enabled: true,
  personal_memories_enabled: true,
  hide_impersonation_embeds: false,
  prompt_snapshot_enabled: false,
  emoji_usage_enabled: true,
  sticker_usage_enabled: true,
  web_search_enabled: true,
  manage_message_enabled: true,
  thread_creation_enabled: true,
  imagegen_enabled: true,
  videogen_enabled: false,
  voice_message_enabled: true,
  user_blocking_enabled: true,
  time_awareness_enabled: true,
  tool_use_enabled: true,
  short_term_memory_enabled: true,
  user_info_updates_enabled: true,
  tool_notice_hidden_keys: [],
  tool_notice_verbosity: "minimal",
  uncensor_injection_enabled: false,
  uncensor_unicode_space_enabled: false,
  uncensor_sanitize_enabled: false,
  voice_transcript_chat_mode: true,
  chatterbox_turbo_enabled: true,
  chatterbox_cfg_weight: 0.5,
  chatterbox_exaggeration: 0.5,
  autoch_disc_ids: [],
  autoch_persona_overrides: [],
  autoch_threshold: 0,
  autoch_threshold_max: 0,
  rp_channel_ids: [],
  private_channel_ids: [],
  crosschannel_blocklist_ids: [],
  stm_privacy_bypass: false,
  always_reply_enabled: false,
  deliberate_trigger_mode: false,
  deliberate_tool_mode: false,
  deliberate_tool_context_turns: null,
  deliberate_tool_triggers: {},
  cooldown_type: 0,
  cooldown_length: 5,
  image_default_positive_tags: [...DEFAULT_IMAGE_POSITIVE_TAGS],
  image_default_negative_tags: [...DEFAULT_IMAGE_NEGATIVE_TAGS],
  user_byok_mode: false,
  memory_tagging_enabled: false,
  channel_memory_enabled: false,
};

/**
 * A persona-scoped config with the declared defaults. Cloned per call so a test that mutates a
 * nested array (stop strings, fallback refs) cannot leak into the next fixture.
 */
export function createServerConfig(overrides: Partial<AssembledServerConfig> = {}): AssembledServerConfig {
  return { ...structuredClone(BASE_CONFIG), ...overrides };
}

/**
 * Default chat model row: a tools-and-vision capable text model with every capability flag the
 * schema defaults resolved, so a fixture that swaps this row in cannot leave a flag reading
 * `undefined` where production reads `false`.
 */
export function createLlmRow(overrides: Partial<LlmRow> = {}): LlmRow {
  return {
    llm_id: 1,
    llm_provider: "google",
    llm_codename: "gemini-2.5-flash",
    is_scoped_registration: false,
    is_smartest: false,
    is_default: false,
    is_reasoning: false,
    is_deprecated: false,
    is_free: false,
    has_tools: true,
    sees_images: true,
    sees_videos: false,
    sees_youtube: false,
    is_uncensored: false,
    supports_structoutput: false,
    strict_role_alternation: false,
    supports_prefix_completion: false,
    supports_assistant_prefill: false,
    verbatim_tool_calling: false,
    ...overrides,
  };
}

/** Overrides accepted by {@link createPersona}; `config` merges onto the default config. */
export type PersonaFixtureOverrides = Omit<Partial<TomoriState>, "config"> & {
  config?: Partial<AssembledServerConfig>;
};

/**
 * A complete `TomoriState`. Identity fields default to one main persona on one server so a test that
 * needs a second row reads `createPersona({ persona_id: 2, persona_lineage_id: 101 })` rather than
 * hand-rolling another partial cast.
 *
 * `overrides.config` merges onto the default config, so `{ config: { llm_id: 7 } }` keeps every other
 * config field. Every other top-level key replaces the default outright, including `llm`, which a
 * suite that needs a different provider builds with {@link createLlmRow}.
 */
export function createPersona(overrides: PersonaFixtureOverrides = {}): TomoriState {
  const { config, ...rest } = overrides;
  return {
    server_id: 1,
    persona_id: 1,
    persona_lineage_id: 100,
    persona_nickname: "Mirri",
    is_alter: false,
    is_pointer: false,
    is_nsfw: false,
    attribute_list: [],
    sample_dialogues_in: [],
    sample_dialogues_out: [],
    physical_appearance_tags: [],
    context_note_depth: 0,
    trigger_words: [],
    persona_prompt: null,
    // Cloned because the shared constant's nested maps are mutable, and a suite that writes an
    // address term would otherwise leak it into every later persona in the same process.
    naming_config: structuredClone(EMPTY_PERSONA_NAMING_CONFIG),
    persona_attributes: [],
    reward_conditioning_enabled: true,
    punish_conditioning_enabled: true,
    humanizer_degree_override: null,
    server_memories: [],
    autoch_counter: 0,
    autoch_next_target: 0,
    llm: createLlmRow(),
    config: createServerConfig(config),
    ...rest,
  };
}

/** Overrides accepted by {@link createUserRow}. */
export type UserFixtureOverrides = Partial<UserRow>;

/**
 * A complete `UserRow` for the actor a route or tool reads. `registration_locale` matches
 * `language_pref` because production captures both when a user first registers.
 */
export function createUserRow(overrides: UserFixtureOverrides = {}): UserRow {
  return {
    user_id: 1,
    user_disc_id: "user-1",
    user_nickname: null,
    registration_locale: "en-US",
    language_pref: "en-US",
    privacy_level: PrivacyLevel.MINIMAL,
    personal_memories: [],
    physical_appearance_tags: [],
    personal_dtm: "follow",
    personal_deliberate_tool_mode: "follow",
    personal_server_fallback_enabled: true,
    shortterm_cache_crossserver_opt_in: false,
    prefix_override: null,
    suffix_override: null,
    ...overrides,
  };
}
export function createCustomExpression(overrides: Partial<CustomExpressionRow> = {}): CustomExpressionRow {
  return customExpressionSchema.strict().parse({
    custom_expression_id: "00000000-0000-4000-8000-000000000001",
    server_id: 1,
    name: "Wave custom",
    name_key: "wave custom",
    description: "Use when greeting someone.",
    emotion_key: EmotionKey.JOY,
    source_kind: "link",
    delivery_kind: "link",
    original_link: "https://example.com/wave.png",
    storage_reference: null,
    mime_type: null,
    extension: null,
    byte_size: null,
    restricted: false,
    revision: 1,
    created_at: new Date(0),
    updated_at: new Date(0),
    persona_ids: [],
    ...overrides,
  });
}
