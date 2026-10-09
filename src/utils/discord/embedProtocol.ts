import type { Embed } from "discord.js";
import { stripLeadingEmoji, stripStatusCircle } from "@/utils/discord/ui/statusTitle";
import { escapeRegExp } from "@/utils/text/processors/regexUtils";
import { getLocaleSubKeys, getSupportedLocales, hasLocaleKey, localizer } from "@/utils/text/localizer";

export type TargetEmbedType =
  | "memory_learning"
  | "reset"
  | "reminder_set"
  | "system_injection"
  | "scene_directive"
  | "compact_summary"
  | "compact_refresh"
  | "reward"
  | "punish"
  | "user_info_update"
  | "user_moderation";

export type ProtocolKind = TargetEmbedType | "diagnostic" | "reply_context";
type ProtocolEntry = { key: string; kind: ProtocolKind; match?: "template" | "prefix" };

/** These rendered strings are persisted in Discord and must remain recognizable after a locale ships. */
export const PROTOCOL_KEYS: ProtocolEntry[] = [
  ...[
    "server_memory_learned_title",
    "server_memory_updated_title",
    "server_memory_deleted_title",
    "personal_memory_learned_title",
    "personal_memory_updated_title",
    "personal_memory_deleted_title",
  ].map((name) => ({ key: `genai.self_teach.${name}`, kind: "memory_learning" as const, match: "template" as const })),
  ...["success_title", "success_title_fields", "success_title_cleared_fields"].map((name) => ({
    key: `tools.user_info_update.${name}`,
    kind: "user_info_update" as const,
    match: "template" as const,
  })),
  ...["block_mute_title", "block_block_title", "unmute_success_title", "unblock_success_title"].map((name) => ({
    key: `tools.user_block.${name}`,
    kind: "user_moderation" as const,
    match: "template" as const,
  })),
  { key: "commands.refresh.title", kind: "reset" },
  { key: "commands.impersonate.system_title", kind: "system_injection" },
  { key: "commands.generate.scene.success_title", kind: "scene_directive" },
  ...["summary_title", "roleplay_scene_title", "manual_entry_title"].map((name) => ({
    key: `commands.compact.${name}`,
    kind: "compact_summary" as const,
  })),
  ...["summary_title_refreshed", "roleplay_scene_title_refreshed", "manual_entry_title_refreshed"].map((name) => ({
    key: `commands.compact.${name}`,
    kind: "compact_refresh" as const,
  })),
  { key: "commands.compact.roleplay_character_title_prefix", kind: "compact_summary", match: "prefix" },
  ...[
    "reminder_set_title",
    "recurring_task_set_title",
    "task_set_title",
    "task_updated_title",
    "task_deleted_title",
  ].map((name) => ({
    key: `reminders.${name}`,
    kind: "reminder_set" as const,
    match: "template" as const,
  })),
  ...[
    "fallback_used_title",
    "error_stream_timeout_title",
    "empty_response_title",
    "max_iterations_title",
    "no_response_title",
  ].map((name) => ({ key: `genai.${name}`, kind: "diagnostic" as const })),
  // Delivery-failure notices are diagnostic, not reminder_set: reminder_set would inject them into
  // every model turn, while diagnostic surfaces them only when self-debug is enabled.
  ...["reminder_triggered_title", "task_triggered_title"].map((name) => ({
    key: `reminders.${name}`,
    kind: "diagnostic" as const,
  })),
  ...["reply_context_description", "reply_context_author", "reply_context_footer"].map((name) => ({
    key: `genai.message_interaction.${name}`,
    kind: "reply_context" as const,
    match: "template" as const,
  })),
];

// The bot no longer writes this footer token because it rendered as visible text. Embeds already
// posted with it still carry it, so the reader keeps honoring it.
const TOKEN_PATTERN = /\[tomori:v1:([a-z_]+)\]/;
const targetKinds = new Set<ProtocolKind>([
  "memory_learning",
  "reset",
  "reminder_set",
  "system_injection",
  "scene_directive",
  "compact_summary",
  "compact_refresh",
  "reward",
  "punish",
  "user_info_update",
  "user_moderation",
]);
const knownKinds = new Set<ProtocolKind>([...targetKinds, "diagnostic", "reply_context"]);

/**
 * Kinds whose notices can render at Minimal verbosity, where the title loses its leading emoji. Only
 * these are stored and matched emoji-free: reward and punish titles share text across commands
 * ("Snack Time!") and are told apart by that emoji alone.
 */
const MINIMAL_TITLE_KINDS = new Set<ProtocolKind>(["memory_learning", "reminder_set", "user_info_update"]);

/** Whether a notice of this kind may arrive as a bare title, because it renders Minimal. */
export function isMinimalTitleKind(kind: ProtocolKind | null): boolean {
  return kind !== null && MINIMAL_TITLE_KINDS.has(kind);
}

function normalizeProtocolTitle(title: string, kind: ProtocolKind): string {
  return MINIMAL_TITLE_KINDS.has(kind) ? stripLeadingEmoji(title) : stripStatusCircle(title);
}

type Match = { key: string; kind: ProtocolKind; value: string; pattern?: RegExp; prefix?: boolean };
let exactTitles = new Map<string, Match>();
let templates: Match[] = [];
let prefixes: Match[] = [];

// Most locales author the reply-context description as a bare `{message_url}`. A template that is
// only a placeholder compiles to `^.+?$`, which would classify any embed with a description as one.
const PLACEHOLDER_PATTERNS = new Map([["message_url", "https?://\\S+"]]);

function placeholderSignature(value: string): string {
  return [...value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)]
    .map((match) => match[1])
    .sort()
    .join(",");
}

export function buildProtocolLookup(
  entries: readonly ProtocolEntry[],
  locales: readonly string[],
  read: (locale: string, key: string) => string | undefined,
): {
  exact: Map<string, Match>;
  templates: Match[];
  prefixes: Match[];
} {
  const exact = new Map<string, Match>();
  const seenValues = new Map<string, string>();
  const templateSignatures = new Map<string, string>();
  const dynamic: Match[] = [];
  const prefixMatches: Match[] = [];
  for (const locale of locales) {
    for (const entry of entries) {
      const authored = read(locale, entry.key);
      if (authored === undefined) continue;
      // Titles render their status circle from the surface color (see `statusTitle.ts`), and Minimal
      // notices drop their emoji, so the stored value and the rendered title can differ by that
      // marker. Both sides normalize here.
      const value = normalizeProtocolTitle(authored, entry.kind);
      const previousKey = seenValues.get(value);
      if (previousKey && previousKey !== entry.key) {
        throw new Error(`Protocol title collision: ${previousKey} and ${entry.key} render as ${JSON.stringify(value)}`);
      }
      seenValues.set(value, entry.key);
      if (entry.match === "template") {
        const signature = placeholderSignature(value);
        const expected = templateSignatures.get(entry.key);
        if (!signature || (expected !== undefined && signature !== expected)) {
          throw new Error(`Protocol template placeholders differ for ${entry.key} in ${locale}`);
        }
        if (entry.kind !== "reply_context" && !value.replace(/\{[a-zA-Z0-9_]+\}/g, "").trim()) {
          throw new Error(`Protocol title template has no literal anchor: ${entry.key} in ${locale}`);
        }
        templateSignatures.set(entry.key, signature);
      }
      const match: Match = { ...entry, value };
      if (entry.match === "prefix") {
        if (value) prefixMatches.push({ ...match, prefix: true });
      } else if (entry.match === "template") {
        match.pattern = new RegExp(
          `^${escapeRegExp(value).replace(/\\\{([a-zA-Z0-9_]+)\\\}/g, (_, name: string) => PLACEHOLDER_PATTERNS.get(name) ?? ".+?")}$`,
        );
        dynamic.push(match);
      } else {
        exact.set(value, match);
      }
    }
  }
  return { exact, templates: dynamic, prefixes: prefixMatches };
}

export function initializeEmbedProtocol(): void {
  for (const locale of getSupportedLocales()) {
    for (const namespace of ["commands.reward", "commands.punish"] as const) {
      for (const name of getLocaleSubKeys(locale, namespace)) {
        const key = `${namespace}.${name}.embed_title`;
        if (hasLocaleKey(locale, key) && !PROTOCOL_KEYS.some((entry) => entry.key === key)) {
          PROTOCOL_KEYS.push({ key, kind: namespace === "commands.reward" ? "reward" : "punish" });
        }
      }
    }
  }
  const lookup = buildProtocolLookup(PROTOCOL_KEYS, getSupportedLocales(), (locale, key) =>
    hasLocaleKey(locale, key) ? localizer(locale, key) : undefined,
  );
  exactTitles = lookup.exact;
  templates = lookup.templates;
  prefixes = lookup.prefixes;
}

export function classifyProtocolTitle(title: string | null | undefined): ProtocolKind | null {
  if (!title) return null;
  // Titles reach here as Discord rendered them, circle included. The lookup stores bare values.
  const bareTitle = stripStatusCircle(title);
  const exact = exactTitles.get(bareTitle);
  if (exact) return exact.kind;
  // Reply-context patterns match embed fields, never titles. The English URL field is a bare
  // placeholder, so including it here would accept every non-empty Japanese notice title.
  const template = templates.find((entry) => entry.kind !== "reply_context" && entry.pattern?.test(bareTitle));
  if (template) return template.kind;
  const prefix = prefixes.find((entry) => bareTitle.startsWith(entry.value));
  if (prefix) return prefix.kind;
  return classifyMinimalTitle(title);
}

function classifyMinimalTitle(title: string): ProtocolKind | null {
  const bareTitle = stripLeadingEmoji(title);
  const exact = exactTitles.get(bareTitle);
  if (exact && MINIMAL_TITLE_KINDS.has(exact.kind)) return exact.kind;
  return templates.find((entry) => MINIMAL_TITLE_KINDS.has(entry.kind) && entry.pattern?.test(bareTitle))?.kind ?? null;
}

export function classifyProtocolEmbed(embed: Pick<Embed, "title" | "footer">): ProtocolKind | null {
  const marker = embed.footer?.text?.match(TOKEN_PATTERN)?.[1] as ProtocolKind | undefined;
  if (marker && knownKinds.has(marker)) return marker;
  return classifyProtocolTitle(embed.title);
}

export function isTargetProtocolKind(kind: ProtocolKind | null): kind is TargetEmbedType {
  return kind !== null && targetKinds.has(kind);
}

export function matchesProtocolTemplateKey(key: string, text: string): boolean {
  const bareText = stripStatusCircle(text);
  if (templates.some((entry) => entry.key === key && entry.pattern?.test(bareText))) return true;
  for (const entry of exactTitles.values()) {
    if (entry.key === key && entry.value === bareText) return true;
  }
  return false;
}
