/**
 * Lists the channel IDs a stored channel scope is matched against: the channel itself and, inside a
 * thread, its parent, so a thread inherits the scope of the channel it belongs to.
 */
export function channelScopeCandidates(channelId: string, parentChannelId?: string | null): string[] {
  return parentChannelId ? [channelId, parentChannelId] : [channelId];
}

/**
 * Reports whether a stored channel scope admits any of the candidate channels. An empty scope admits
 * every channel.
 */
export function channelScopeAdmits(scopeChannelIds: readonly string[], candidateIds: readonly string[]): boolean {
  return scopeChannelIds.length === 0 || scopeChannelIds.some((id) => candidateIds.includes(id));
}
