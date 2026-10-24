import type { Client } from "discord.js";
import { log } from "../utils/misc/logger";
import { serverScheduleRepository } from "@/utils/db/repositories";
import { RandomTriggerProcessor } from "./randomTriggerProcessor";
import { ReminderProcessor } from "./reminderProcessor";
import { NaturalNudgeProcessor } from "@/modules/natural-nudges/runtime/processor";
import {
  clearScheduledWorkNudgeHandler,
  emitScheduledWorkNudge,
  registerScheduledWorkNudgeHandler,
} from "./scheduledWorkSignals";

const MAX_TIMEOUT_MS = 2_147_483_647;
const SCHEDULED_WORK_RECONCILE_INTERVAL_MS = 60_000;

export type ScheduledWorkStatus = {
  isRunning: boolean;
  isProcessing: boolean;
  reconcileIntervalMs: number;
  nextWakeAt: Date | null;
  lastRunAt: Date | null;
};

export class ScheduledWorkCoordinator {
  private readonly reminderProcessor: ReminderProcessor;
  private readonly randomTriggerProcessor: RandomTriggerProcessor;
  private readonly naturalNudgeProcessor: NaturalNudgeProcessor;
  private readonly reconcileIntervalMs: number;
  private wakeTimeout: NodeJS.Timeout | null = null;
  private reconcileInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isProcessing = false;
  private rerunRequested = false;
  private nextWakeAt: Date | null = null;
  private lastRunAt: Date | null = null;

  constructor(client: Client, reconcileIntervalMs = SCHEDULED_WORK_RECONCILE_INTERVAL_MS) {
    this.reconcileIntervalMs = reconcileIntervalMs;
    this.reminderProcessor = new ReminderProcessor(client);
    this.randomTriggerProcessor = new RandomTriggerProcessor(client);
    this.naturalNudgeProcessor = new NaturalNudgeProcessor(client);
  }

  public start(): void {
    if (this.isRunning) {
      log.warn("Scheduled work coordinator is already running");
      return;
    }

    this.isRunning = true;
    registerScheduledWorkNudgeHandler((reason) => {
      this.requestImmediateRun(reason ? `nudge:${reason}` : "nudge");
    });

    this.reconcileInterval = setInterval(() => {
      this.requestImmediateRun("reconcile");
    }, this.reconcileIntervalMs);

    log.info(`Starting scheduled work coordinator (reconcile every ${this.reconcileIntervalMs}ms)`);
    this.requestImmediateRun("startup");
    log.success("Scheduled work coordinator started successfully");
  }

  public stop(): void {
    if (!this.isRunning) {
      log.warn("Scheduled work coordinator is not running");
      return;
    }

    this.isRunning = false;
    this.rerunRequested = false;
    clearScheduledWorkNudgeHandler();
    this.clearWakeTimeout();

    if (this.reconcileInterval) {
      clearInterval(this.reconcileInterval);
      this.reconcileInterval = null;
    }

    this.nextWakeAt = null;
    log.success("Scheduled work coordinator stopped successfully");
  }

  public requestImmediateRun(reason = "manual"): void {
    if (!this.isRunning) {
      return;
    }

    if (this.isProcessing) {
      this.rerunRequested = true;
      return;
    }

    this.clearWakeTimeout();
    this.nextWakeAt = new Date();
    this.wakeTimeout = setTimeout(() => {
      this.runCycle(reason).catch((error) => {
        log.error(`Scheduled work cycle failed (${reason})`, error);
      });
    }, 0);
  }

  public async runNow(reason = "manual"): Promise<void> {
    if (!this.isRunning) {
      throw new Error("Scheduled work coordinator not initialized");
    }

    await this.runCycle(reason);
  }

  public getStatus(): ScheduledWorkStatus {
    return {
      isRunning: this.isRunning,
      isProcessing: this.isProcessing,
      reconcileIntervalMs: this.reconcileIntervalMs,
      nextWakeAt: this.nextWakeAt,
      lastRunAt: this.lastRunAt,
    };
  }

  private clearWakeTimeout(): void {
    if (this.wakeTimeout) {
      clearTimeout(this.wakeTimeout);
      this.wakeTimeout = null;
    }
  }

  private async runCycle(reason: string): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    if (this.isProcessing) {
      this.rerunRequested = true;
      return;
    }

    this.clearWakeTimeout();
    this.nextWakeAt = null;
    this.isProcessing = true;

    try {
      do {
        this.rerunRequested = false;
        if (reason !== "reconcile") {
          log.info(`Running scheduled work cycle (${reason})`);
        }
        await this.reminderProcessor.processDueReminders();
        await this.randomTriggerProcessor.processDueRandomTriggers();
        // Natural Nudges has no due-time column to wake on, so the 60 s reconcile is its only clock.
        await this.naturalNudgeProcessor.processDueIdleNudges();
        this.lastRunAt = new Date();
        reason = "rerun";
      } while (this.rerunRequested && this.isRunning);
    } finally {
      this.isProcessing = false;
    }

    await this.scheduleNextWake();
  }

  private async scheduleNextWake(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.clearWakeTimeout();

    const nextReminderTime = await serverScheduleRepository.getNextReminderTime();
    const nextRandomTriggerTime = await serverScheduleRepository.getNextTriggerTime();
    const nextDueTime = this.getEarliestDate(nextReminderTime, nextRandomTriggerTime);

    if (!nextDueTime) {
      this.nextWakeAt = null;
      return;
    }

    const delayMs = Math.max(0, nextDueTime.getTime() - Date.now());
    const clampedDelayMs = Math.min(delayMs, MAX_TIMEOUT_MS);

    this.nextWakeAt = new Date(Date.now() + clampedDelayMs);
    log.info(
      `Scheduled work coordinator next wake scheduled for ${nextDueTime.toISOString()} (in ${clampedDelayMs}ms)`,
    );

    this.wakeTimeout = setTimeout(() => {
      this.runCycle("due").catch((error) => {
        log.error("Scheduled work cycle failed (due)", error);
      });
    }, clampedDelayMs);
  }

  private getEarliestDate(...dates: Array<Date | null>): Date | null {
    const validDates = dates.filter((date): date is Date => date instanceof Date);
    if (validDates.length === 0) {
      return null;
    }

    return validDates.reduce((earliest, current) => {
      return current.getTime() < earliest.getTime() ? current : earliest;
    });
  }
}

let scheduledWorkCoordinatorInstance: ScheduledWorkCoordinator | null = null;

export function initializeScheduledWorkCoordinator(client: Client): void {
  if (scheduledWorkCoordinatorInstance) {
    log.warn("Scheduled work coordinator already initialized");
    return;
  }

  scheduledWorkCoordinatorInstance = new ScheduledWorkCoordinator(client);
  scheduledWorkCoordinatorInstance.start();
}

export function stopScheduledWorkCoordinator(): void {
  if (!scheduledWorkCoordinatorInstance) {
    return;
  }

  scheduledWorkCoordinatorInstance.stop();
  scheduledWorkCoordinatorInstance = null;
}

export function getScheduledWorkStatus(): ScheduledWorkStatus | null {
  return scheduledWorkCoordinatorInstance?.getStatus() ?? null;
}

export async function runScheduledWorkNow(reason?: string): Promise<void> {
  if (!scheduledWorkCoordinatorInstance) {
    throw new Error("Scheduled work coordinator not initialized");
  }

  await scheduledWorkCoordinatorInstance.runNow(reason);
}

export function nudgeScheduledWork(reason?: string): void {
  emitScheduledWorkNudge(reason);
}
