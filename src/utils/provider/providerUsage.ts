import { AsyncLocalStorage } from "node:async_hooks";
import type { ToolContext } from "@/types/tool/interfaces";
import { ColorCode, log } from "@/utils/misc/logger";
import type { TokenUsage } from "@/utils/text/tokenEstimate";

declare const providerUsageContextBrand: unique symbol;

export interface ProviderUsageContext {
  readonly [providerUsageContextBrand]?: never;
}

const requestUsageContext = new AsyncLocalStorage<ProviderUsageContext | undefined>();

export function withProviderUsageContext<T>(context: ProviderUsageContext | undefined, execute: () => T): T {
  return requestUsageContext.run(context, execute);
}

export function currentProviderUsageContext(): ProviderUsageContext | undefined {
  return requestUsageContext.getStore();
}

export interface ProviderUsageReport {
  modelCodename: string;
  costUsd: number | null | undefined;
  inputTokens?: number | null;
  outputTokens?: number | null;
  /** Identifies one billed provider request, so repeated polling of the same job records it once. */
  providerRequestId?: string | null;
}

export type ProviderUsageReporter = (
  context: ProviderUsageContext,
  report: ProviderUsageReport,
) => void | Promise<void>;

let usageReporter: ProviderUsageReporter | undefined;

export function registerProviderUsageReporter(reporter: ProviderUsageReporter): () => void {
  const previous = usageReporter;
  usageReporter = reporter;
  return () => {
    if (usageReporter === reporter) usageReporter = previous;
  };
}

export function reportProviderUsage(
  context: ProviderUsageContext | null | undefined,
  report: ProviderUsageReport,
): void {
  if (!context || !usageReporter) return;
  try {
    const pending = usageReporter(context, report);
    if (pending) void pending.catch((error: unknown) => log.warn("Failed to report provider usage", error));
  } catch (error) {
    log.warn("Failed to report provider usage", error);
  }
}

export function createProviderUsageRecorder(
  context: ProviderUsageContext | null | undefined,
  modelCodename: string,
): ((usage: TokenUsage) => void) | undefined {
  return context
    ? (usage) => reportProviderUsage(context, { modelCodename, ...usage, costUsd: usage.costUsd })
    : undefined;
}

export interface ProviderRequestFailureCopy {
  titleKey: string;
  description: string;
}

export class ProviderRequestDeniedError extends Error {
  readonly deferNotice: boolean;

  constructor(
    public readonly usageContext: ProviderUsageContext | undefined,
    public readonly render: (locale: string, forFallback: boolean) => ProviderRequestFailureCopy,
    options?: ErrorOptions & { deferNotice?: boolean },
  ) {
    super("Provider request denied", options);
    this.name = "ProviderRequestDeniedError";
    this.deferNotice = options?.deferNotice ?? false;
  }
}

export type ProviderRequestDenialTranslator = (
  error: unknown,
  context: ProviderUsageContext,
) => ProviderRequestDeniedError | null;

let denialTranslator: ProviderRequestDenialTranslator | undefined;

export function registerProviderRequestDenialTranslator(translator: ProviderRequestDenialTranslator): () => void {
  const previous = denialTranslator;
  denialTranslator = translator;
  return () => {
    if (denialTranslator === translator) denialTranslator = previous;
  };
}

export function findProviderRequestDeniedError(
  error: unknown,
  ...scope: [context?: ProviderUsageContext | null]
): ProviderRequestDeniedError | null {
  const [context] = scope;
  const scoped = scope.length > 0;
  const pending = [error];
  const visited = new Set<object>();
  let hasDenial = false;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);
    if (current instanceof ProviderRequestDeniedError) {
      hasDenial = true;
      if (!scoped || current.usageContext === (context ?? undefined)) return current;
    }
    if ("cause" in current) pending.push(current.cause);
    if ("originalError" in current) pending.push(current.originalError);
  }
  if (hasDenial || !context || !denialTranslator) return null;
  const translated = denialTranslator(error, context);
  return translated?.usageContext === context ? translated : null;
}

export function getProviderRequestFailureCopy(
  error: ProviderRequestDeniedError,
  locale: string,
  forFallback = false,
): ProviderRequestFailureCopy {
  return error.render(locale, forFallback);
}

export async function notifyProviderToolFailure(
  context: Pick<ToolContext, "channel" | "locale" | "isUserImpersonation" | "suppressFailureNotices">,
  error: ProviderRequestDeniedError,
): Promise<string> {
  const copy = getProviderRequestFailureCopy(error, context.locale);
  if (!context.isUserImpersonation && !context.suppressFailureNotices) {
    // Lazy because the embed helper's import graph reaches provider consumers that import this module.
    const { sendStandardEmbed } = await import("@/utils/discord/embedHelper");
    await sendStandardEmbed(context.channel, context.locale, { ...copy, color: ColorCode.ERROR }).catch((sendError) =>
      log.warn("Failed to send provider request denial notice", sendError),
    );
  }
  return copy.description;
}
