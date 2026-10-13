const MAX_ENTRIES = 2000;
const messageIds = new Set<string>();

export function hasNegativeMessageProxyMessageIdentity(messageDiscId: string): boolean {
  return messageIds.has(messageDiscId);
}

export function rememberNegativeMessageProxyMessageIdentity(messageDiscId: string): void {
  if (messageIds.has(messageDiscId)) return;
  if (messageIds.size >= MAX_ENTRIES) {
    const oldest = messageIds.values().next().value;
    if (oldest !== undefined) messageIds.delete(oldest);
  }
  messageIds.add(messageDiscId);
}

export function forgetNegativeMessageProxyMessageIdentity(messageDiscId: string): void {
  messageIds.delete(messageDiscId);
}

export function clearNegativeMessageProxyMessageIdentityCacheForTests(): void {
  messageIds.clear();
}
