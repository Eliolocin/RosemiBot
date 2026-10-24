/**
 * Server blacklist policy: a blacklisted member is ignored completely in that server. They cannot
 * trigger any persona, their messages never reach any context, and the commands that make the bot
 * act for them are refused.
 */
import { getCachedBlacklistStatus } from "@/utils/cache/userCache";

/**
 * Space-joined command paths (category, optional group, subcommand) that make the bot generate,
 * speak, or change a conversation. A path matches when it equals a prefix or starts with it plus
 * a space, so `tool prompt` covers `tool prompt snapshot` while `tool estimate` stays open.
 *
 * `/comment` stays open: it posts a static user-attributed embed with no LLM generation, persona
 * dialogue, or context ingestion.
 */
const BLACKLIST_GATED_COMMAND_PREFIXES: readonly string[] = [
  "respond",
  "reward",
  "punish",
  "impersonate",
  "generate",
  "booru",
  "compact",
  "learn",
  "conditioning",
  "kill",
  "refresh",
  "novelai generate",
  "tool prompt",
  "tool delete",
  "persona create",
  "persona generate",
];

/**
 * Whether a slash command is refused for a member blacklisted in the server it runs in.
 *
 * @param commandName - Root command name
 * @param groupName - Subcommand group, or null for flat commands
 * @param subcommandName - Subcommand, or null for root-only commands
 */
export function isBlacklistGatedCommand(
  commandName: string,
  groupName: string | null,
  subcommandName: string | null,
): boolean {
  const path = [commandName, groupName, subcommandName].filter(Boolean).join(" ");
  return BLACKLIST_GATED_COMMAND_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix} `));
}

/**
 * Returns the subset of `authorIds` blacklisted in the given server.
 *
 * Reads through the per-user blacklist cache, which fails closed: an unreadable entry counts as
 * blacklisted, so a database blip hides that author rather than lifting the restriction.
 *
 * @param serverDiscId - Discord server ID
 * @param authorIds - Discord user IDs to check; duplicates are read once
 */
export async function resolveBlacklistedAuthorIds(
  serverDiscId: string,
  authorIds: Iterable<string>,
): Promise<Set<string>> {
  const uniqueIds = [...new Set(authorIds)];
  const statuses = await Promise.all(uniqueIds.map((id) => getCachedBlacklistStatus(serverDiscId, id)));
  return new Set(uniqueIds.filter((_, index) => statuses[index]));
}
