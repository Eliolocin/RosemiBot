/** Later service-side bio edits must not rewrite memory the user may already have curated. */
import { invalidateUserCache } from "@/utils/cache/userCache";
import { personalMemoryRepository } from "@/utils/db/repositories/PersonalMemoryRepository";
import { log } from "@/utils/misc/logger";
import { getMessageProxyHostProtection } from "@/utils/messageProxy/hostProtection";

const DEFAULT_BIO_SEED_MAX_CHARS = 1000;

/** Read lazily per call (never cached at module load) so tests can set the env before a dynamic import. */
function getBioSeedMaxChars(): number {
  const parsed = Number.parseInt(process.env.MESSAGE_PROXY_BIO_SEED_MAX_CHARS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BIO_SEED_MAX_CHARS;
}

export function composeMessageProxyBioSeedContent(description: string): string {
  // Whitespace-flattened: memories render semicolon-joined on a single line, so
  // an embedded newline would break the surrounding block.
  const flattened = description.replace(/\s+/g, " ").trim();
  const maxChars = getBioSeedMaxChars();
  return flattened.length > maxChars ? flattened.slice(0, maxChars) : flattened;
}

export type MessageProxyBioSeedArgs = {
  isNewIdentity: boolean;
  identityUserDiscId: string;
  identityUserId: number;
  description: string | null | undefined;
  serverDiscId: string | null | undefined;
};

export type MessageProxyBioSeedDeps = {
  getHostProtection: typeof getMessageProxyHostProtection;
  addPersonalMemory: (userId: number, personaLineageId: number, content: string) => Promise<unknown>;
  invalidateCache: typeof invalidateUserCache;
};

const defaultDeps: MessageProxyBioSeedDeps = {
  getHostProtection: getMessageProxyHostProtection,
  addPersonalMemory: (userId, personaLineageId, content) =>
    personalMemoryRepository.add(userId, personaLineageId, content),
  invalidateCache: invalidateUserCache,
};

/**
 * Callers must fire this without awaiting: it must never delay admission, and failures must never
 * surface to the triggering reply. The memory is written under persona lineage 0.
 */
export async function seedMessageProxyIdentityBio(
  args: MessageProxyBioSeedArgs,
  deps: MessageProxyBioSeedDeps = defaultDeps,
): Promise<void> {
  if (!args.isNewIdentity) {
    return;
  }

  const description = args.description?.trim();
  if (!description) {
    return;
  }

  const protection = await deps.getHostProtection(args.identityUserDiscId, args.serverDiscId);
  if (protection.protected) {
    return;
  }

  const content = composeMessageProxyBioSeedContent(description);
  const inserted = await deps.addPersonalMemory(args.identityUserId, 0, content);
  if (!inserted) {
    log.info(
      `Skipped message-proxy bio seed for ${args.identityUserDiscId}: personal memory limit reached or content invalid`,
    );
    return;
  }

  deps.invalidateCache(args.identityUserDiscId);
}
