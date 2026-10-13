import { verifyMessageWebhook } from "@/utils/chat/webhookIdentity";
import type { Client, Message } from "discord.js";
import { ChannelType } from "discord.js";
import { log } from "../utils/misc/logger";
import { serverScheduleRepository } from "@/utils/db/repositories";

import type { RandomTriggerRow, TomoriState } from "../types/db/schema";
import { tomoriChat, suppressNextSelfReply } from "../events/messageCreate/tomoriChat";
import { getCachedAllPersonas } from "../utils/cache/tomoriStateCache";
import { resolvePersonaForMessage } from "@/utils/chat/webhookIdentity";
import { runWithErrorContext } from "@/utils/misc/errorContextStore";

export class RandomTriggerProcessor {
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  public async processDueRandomTriggers(): Promise<void> {
    try {
      const dueTriggers = await serverScheduleRepository.getDueTriggers();

      if (!dueTriggers || dueTriggers.length === 0) {
        return;
      }

      log.info(`Processing ${dueTriggers.length} due random trigger(s)`);

      for (const trigger of dueTriggers) {
        await this.executeTrigger(trigger);
      }
    } catch (error) {
      log.error("Error checking for due random triggers:", error);
    }
  }

  private async executeTrigger(trigger: RandomTriggerRow): Promise<void> {
    return runWithErrorContext(
      {
        source: "random_trigger",
        sourceDetail: trigger.trigger_id != null ? String(trigger.trigger_id) : undefined,
        serverId: trigger.server_id,
        channelDiscId: trigger.channel_disc_id,
      },
      () => this.executeTriggerInContext(trigger),
    );
  }

  private async executeTriggerInContext(trigger: RandomTriggerRow): Promise<void> {
    const triggerId = trigger.trigger_id ?? 0;
    let consecutiveFailures = trigger.consecutive_failures ?? 0;

    try {
      const failureThreshold = trigger.failure_threshold ?? null;
      const isForced = failureThreshold !== null && consecutiveFailures >= failureThreshold;

      log.info(
        `Evaluating random trigger ${triggerId} (channel=${trigger.channel_disc_id}, chance=${trigger.chance_percent}%${failureThreshold !== null ? `, failures=${consecutiveFailures}/${failureThreshold}` : ""})`,
      );

      const roll = Math.random() * 100;
      if (!isForced && roll >= trigger.chance_percent) {
        consecutiveFailures += 1;
        log.info(
          `Random trigger ${triggerId} missed the roll (${roll.toFixed(1)} >= ${trigger.chance_percent})${failureThreshold !== null ? `, failures now ${consecutiveFailures}/${failureThreshold}` : ""} — rescheduling`,
        );
        return;
      }

      if (isForced) {
        log.info(
          `Random trigger ${triggerId}: force-firing after ${consecutiveFailures} consecutive miss(es) (threshold: ${failureThreshold})`,
        );
      }

      const rawChannel = await this.client.channels.fetch(trigger.channel_disc_id).catch(() => null);

      if (!rawChannel) {
        log.warn(`Random trigger ${triggerId}: channel ${trigger.channel_disc_id} not found — rescheduling`);
        return;
      }

      if (!rawChannel.isTextBased() || rawChannel.type === ChannelType.DM || rawChannel.type === ChannelType.GroupDM) {
        log.warn(
          `Random trigger ${triggerId}: channel ${trigger.channel_disc_id} is not a guild text channel — rescheduling`,
        );
        return;
      }

      let lastMessage: Message | undefined;
      if ("messages" in rawChannel) {
        try {
          const messages = await rawChannel.messages.fetch({ limit: 1 });
          lastMessage = messages.first();
        } catch {
          log.warn(`Random trigger ${triggerId}: failed to fetch last message from channel`);
        }
      }

      if (trigger.silence_threshold_hours !== null && trigger.silence_threshold_hours !== undefined) {
        if (lastMessage) {
          const ageMs = Date.now() - lastMessage.createdTimestamp;
          const ageHours = ageMs / (1000 * 60 * 60);
          if (ageHours < trigger.silence_threshold_hours) {
            log.info(
              `Random trigger ${triggerId}: channel active ${ageHours.toFixed(2)}h ago, threshold is ${trigger.silence_threshold_hours}h — skipping & rescheduling`,
            );
            return;
          }
        }
      }

      let chosenPersona: TomoriState | null = null;

      if (!("guild" in rawChannel) || !rawChannel.guild) {
        log.warn(`Random trigger ${triggerId}: channel has no guild reference — rescheduling`);
        return;
      }

      const guildDiscId = rawChannel.guild.id;
      const allPersonas = await getCachedAllPersonas(guildDiscId);

      if (allPersonas.length === 0) {
        log.warn(`Random trigger ${triggerId}: no personas found for guild ${guildDiscId} — rescheduling`);
        return;
      }

      if (trigger.persona_id === null || trigger.persona_id === undefined) {
        const randomIndex = Math.floor(Math.random() * allPersonas.length);
        chosenPersona = allPersonas[randomIndex] ?? null;
      } else {
        chosenPersona = allPersonas.find((persona) => persona.persona_id === trigger.persona_id) ?? null;
      }

      if (!chosenPersona) {
        log.warn(
          `Random trigger ${triggerId}: could not resolve persona (persona_id=${trigger.persona_id}) — rescheduling`,
        );
        return;
      }

      if (!trigger.respond_to_self && lastMessage) {
        const isPersonaLastSpeaker =
          lastMessage.webhookId !== null &&
          (await verifyMessageWebhook(lastMessage)) &&
          resolvePersonaForMessage(lastMessage, allPersonas)?.persona_id === chosenPersona.persona_id;

        if (isPersonaLastSpeaker) {
          log.info(
            `Random trigger ${triggerId}: persona "${chosenPersona.persona_nickname}" spoke last, respond_to_self=false — skipping & rescheduling`,
          );
          return;
        }
      }

      if (!lastMessage && "send" in rawChannel) {
        try {
          lastMessage = await rawChannel.send({
            content: "\u2800",
          });
          log.info(`Seeded placeholder message in channel ${trigger.channel_disc_id} for random trigger ${triggerId}`);
        } catch (sendError) {
          log.warn(
            `Failed to seed placeholder in channel ${trigger.channel_disc_id} for random trigger ${triggerId}:`,
            sendError,
          );
        }
      }

      if (!lastMessage) {
        log.warn(`Random trigger ${triggerId}: no messages in channel and seeding failed — rescheduling`);
        return;
      }

      suppressNextSelfReply(rawChannel.id);
      consecutiveFailures = 0;

      log.info(
        `Random trigger ${triggerId}: firing for persona "${chosenPersona.persona_nickname}" in channel ${trigger.channel_disc_id}`,
      );

      await tomoriChat({
        client: this.client,
        message: lastMessage,
        isFromQueue: false,
        isManuallyTriggered: true,
        forceReason: false,
        isStopResponse: false,
        selectedPersonaId: chosenPersona.persona_id,
        isPersonaJob: false,
        isUserImpersonation: false,
        textQuotaSource: "system",
        textQuotaTriggerKey: `random:${triggerId}:${lastMessage.id}`,
        shouldSurfaceUserErrors: false,
        manualSystemPrompt: trigger.custom_prompt ?? undefined,
      });

      log.success(`Random trigger ${triggerId} fired successfully for persona "${chosenPersona.persona_nickname}"`);
    } catch (error) {
      log.error(`Error executing random trigger ${triggerId}:`, error);
    } finally {
      await this.rescheduleTrigger(
        triggerId,
        trigger.timer_hours,
        trigger.random_offset_range ?? null,
        consecutiveFailures,
      );
    }
  }

  private async rescheduleTrigger(
    triggerId: number,
    timerHours: number,
    randomOffsetRange: number | null,
    consecutiveFailures: number,
  ): Promise<void> {
    const rescheduled = await serverScheduleRepository.rescheduleTrigger(
      triggerId,
      timerHours,
      randomOffsetRange,
      consecutiveFailures,
    );
    if (!rescheduled) {
      log.error(`Failed to reschedule random trigger ${triggerId} — it may fire repeatedly until rescheduled`);
    }
  }
}
