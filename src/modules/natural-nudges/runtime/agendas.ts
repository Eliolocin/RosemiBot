import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import { log } from "@/utils/misc/logger";

/**
 * Agendas the given persona owns among the history messages. A failed read only loses the
 * reminder, so it never blocks the turn.
 */
export async function loadPersonaAgendas(
  personaId: number | null | undefined,
  messageIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (typeof personaId !== "number") return new Map();
  try {
    return await naturalNudgeRepository.loadAgendas(personaId, messageIds);
  } catch (error) {
    log.warn("Natural Nudges: failed to load agendas for context", error, { personaId });
    return new Map();
  }
}

export function formatAgendaNotice(personaName: string, agenda: string): string {
  return `[System: From the next message on, ${personaName} has a private goal that nobody else can see: ${agenda}]`;
}

export function agendaNoticeId(messageId: string): string {
  return `synthetic-nudge-agenda-${messageId}`;
}

/** Synthetic author for agenda notices, distinct from every real author so the opener never merges into it. */
export const AGENDA_NOTICE_AUTHOR_ID = "synthetic-nudge-agenda";
