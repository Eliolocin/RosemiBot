/** One nudge in flight per server across idle nudges and Active Nudges, so two never race for the same moment. */
const busyServers = new Set<number>();

export function isNudgeServerBusy(serverId: number): boolean {
  return busyServers.has(serverId);
}

/** False when another nudge already holds the server. */
export function claimNudgeServer(serverId: number): boolean {
  if (busyServers.has(serverId)) return false;
  busyServers.add(serverId);
  return true;
}

export function releaseNudgeServer(serverId: number): void {
  busyServers.delete(serverId);
}
