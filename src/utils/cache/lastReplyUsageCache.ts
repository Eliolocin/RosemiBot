interface LastReplyUsage {
  inputTokens: number;
  /** A reading from a different model says nothing about the current one, so readers compare this. */
  modelCodename: string;
}

/** Each entry is a few dozen bytes, so this caps the store well under a megabyte. */
const MAX_ENTRIES = 2000;

const usageByChannelPersona = new Map<string, LastReplyUsage>();

function getKey(channelDiscId: string, personaId: number): string {
  return `${channelDiscId}:${personaId}`;
}

/**
 * Keeps the provider-reported input tokens of a persona's latest reply in a channel. Memory only:
 * a restart forgets every reading, and `/context` simply omits the line until the next reply.
 */
export function recordLastReplyUsage(channelDiscId: string, personaId: number, usage: LastReplyUsage): void {
  const key = getKey(channelDiscId, personaId);
  // Deleting first moves the key to the end of the Map's insertion order, which the eviction below
  // treats as least recently written.
  usageByChannelPersona.delete(key);
  if (usageByChannelPersona.size >= MAX_ENTRIES) {
    const oldest = usageByChannelPersona.keys().next();
    if (!oldest.done) usageByChannelPersona.delete(oldest.value);
  }
  usageByChannelPersona.set(key, usage);
}

export function getLastReplyUsage(channelDiscId: string, personaId: number): LastReplyUsage | undefined {
  return usageByChannelPersona.get(getKey(channelDiscId, personaId));
}
