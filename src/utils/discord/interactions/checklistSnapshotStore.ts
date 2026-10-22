const CHECKLIST_SNAPSHOT_TTL_MS = 15 * 60_000;

const checklistSnapshots = new Map<string, { values: string[]; expiresAt: number }>();

/**
 * Remembers which entries a checklist modal presented, keyed by its single-use nonce, so the submit
 * only changes those entries and leaves anything added meanwhile alone.
 */
export function storeChecklistSnapshot(nonce: string, values: readonly string[]): void {
  const now = Date.now();
  for (const [key, snapshot] of checklistSnapshots) {
    if (snapshot.expiresAt < now) checklistSnapshots.delete(key);
  }
  checklistSnapshots.set(nonce, { values: [...values], expiresAt: now + CHECKLIST_SNAPSHOT_TTL_MS });
}

/** Consumes the snapshot, so a repeated submit of the same modal finds nothing and writes nothing. */
export function takeChecklistSnapshot(nonce: string): string[] | undefined {
  const snapshot = checklistSnapshots.get(nonce);
  checklistSnapshots.delete(nonce);
  return snapshot && snapshot.expiresAt >= Date.now() ? snapshot.values : undefined;
}
