import { ChannelType, PermissionFlagsBits, type Channel } from "discord.js";

/**
 * Whether content produced in `source` may be copied into the thought log channel `destination`.
 *
 * The bot cannot enumerate who reads the thought log, so a copy is allowed only when every member
 * of the guild can already read the source: it must grant `ViewChannel` to `@everyone` and carry
 * no `ViewChannel` deny for any role or member. Public threads inherit their parent's audience;
 * private threads are member-scoped and never qualify. A destination in another guild would reach
 * people outside the source audience. When an answer cannot be established (an uncached parent,
 * a channel without permission data), nothing is mirrored. The configured private channel list
 * stays an additional opt-out.
 */
export function canMirrorToThoughtLog(
  source: Channel,
  destination: Channel,
  privateChannelIds: readonly string[],
): boolean {
  if (source.isDMBased() || destination.isDMBased()) return false;
  if (!("guildId" in destination) || !("guild" in source) || destination.guildId !== source.guildId) return false;
  if (source.type === ChannelType.PrivateThread) return false;

  const audience = source.isThread() ? source.parent : source;
  if (!audience || !("permissionOverwrites" in audience)) return false;
  if (privateChannelIds.includes(source.id) || privateChannelIds.includes(audience.id)) return false;

  if (!audience.permissionsFor(source.guild.roles.everyone).has(PermissionFlagsBits.ViewChannel)) return false;
  return !audience.permissionOverwrites.cache.some((overwrite) => overwrite.deny.has(PermissionFlagsBits.ViewChannel));
}
