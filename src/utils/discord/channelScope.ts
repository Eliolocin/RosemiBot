/**
 * Lists the channel IDs a stored channel scope is matched against: the channel itself and, inside a
 * thread, its parent, so a thread inherits the scope of the channel it belongs to.
 */
export function channelScopeCandidates(channelId: string, parentChannelId?: string | null): string[] {
  return parentChannelId ? [channelId, parentChannelId] : [channelId];
}

/**
 * Reports whether a stored channel scope admits any of the candidate channels. An empty scope admits
 * every channel; a pending legacy scope admits none until it is resolved.
 */
export function channelScopeAdmits(
  scope: { channel_disc_ids: readonly string[]; channel_scope_pending: boolean },
  candidateIds: readonly string[],
): boolean {
  if (scope.channel_scope_pending) return false;
  return scope.channel_disc_ids.length === 0 || scope.channel_disc_ids.some((id) => candidateIds.includes(id));
}
