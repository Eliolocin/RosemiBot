import type { Message } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import type { ForcedMention } from "@/types/discord/mentions";
import type { StructuredContextItem } from "@/types/misc/context";
import { log } from "@/utils/misc/logger";
import { recordChatDiagnostic } from "@/utils/chat/diagnosticTimeline";
import { queuePersonaJobsAtFront, type ChannelLockEntry } from "@/utils/chat/channelQueue";
import type { TextQuotaSource } from "@/utils/chat/types";

export function queueAdditionalPersonaTurns(args: {
  lockEntry: ChannelLockEntry;
  message: Message;
  personasToRespond: TomoriState[];
  triggeredPersonaIds: number[];
  forceReason?: boolean;
  reasoningQuery?: string;
  llmOverrideCodename?: string;
  textQuotaSource: TextQuotaSource;
  textQuotaTriggerKey: string;
  textQuotaUserDiscId: string;
  shouldSurfaceUserErrors?: boolean;
  injectedContextItems?: StructuredContextItem[];
  forcedMentions?: ForcedMention[];
}): TomoriState[] {
  const [firstPersona, ...remainingPersonas] = args.personasToRespond;
  if (!firstPersona) {
    return [];
  }

  const personasToQueue: Array<{ persona: TomoriState; selectedPersonaId: number }> = [];
  const personasToHandleNow: TomoriState[] = [firstPersona];

  for (const persona of remainingPersonas) {
    if (persona.persona_id) {
      personasToQueue.push({
        persona,
        selectedPersonaId: persona.persona_id,
      });
    } else {
      log.warn(
        `Persona "${persona.persona_nickname}" is missing persona_id; handling in current pass instead of queueing.`,
      );
      personasToHandleNow.push(persona);
    }
  }

  if (personasToQueue.length > 0) {
    recordChatDiagnostic({ kind: "persona_jobs_queued", count: personasToQueue.length });
    queuePersonaJobsAtFront({
      lockEntry: args.lockEntry,
      message: args.message,
      personaJobs: personasToQueue.map((queuedPersona) => ({
        personaName: queuedPersona.persona.persona_nickname,
        selectedPersonaId: queuedPersona.selectedPersonaId,
      })),
      triggeredPersonaIds: args.triggeredPersonaIds,
      forceReason: args.forceReason,
      reasoningQuery: args.reasoningQuery,
      llmOverrideCodename: args.llmOverrideCodename,
      textQuotaSource: args.textQuotaSource,
      textQuotaTriggerKey: args.textQuotaTriggerKey,
      textQuotaUserDiscId: args.textQuotaUserDiscId,
      shouldSurfaceUserErrors: args.shouldSurfaceUserErrors,
      injectedContextItems: args.injectedContextItems,
      forcedMentions: args.forcedMentions,
    });
  }

  return personasToHandleNow;
}
