import type { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import type {
  SupporterFundingFailureDetails,
  SupporterFundingFailureReason,
  SupporterRequestDenialFacts,
} from "@/modules/supporter-billing/runtime/types";
import type { ProviderRequestFailureCopy } from "@/utils/provider/providerUsage";
import { commandRegistry } from "@/utils/discord/commandRegistry";
import { localizer } from "@/utils/text/localizer";
import type { ToolContext } from "@/types/tool/interfaces";
import { sendStandardEmbed } from "@/utils/discord/embedHelper";
import { ColorCode, log } from "@/utils/misc/logger";
import { inlineCode } from "discord.js";

const SCOPE_KEYS = {
  personal: "commands.subscribe.request.scope.personal",
  server: "commands.subscribe.request.scope.server",
} satisfies Record<SupporterRequestDenialFacts["fundingScope"], string>;

const CAPABILITY_KEYS = {
  text: "commands.subscribe.request.capabilities.text",
  vision: "commands.subscribe.request.capabilities.vision",
  image: "commands.subscribe.request.capabilities.image",
  video: "commands.subscribe.request.capabilities.video",
  voice: "commands.subscribe.request.capabilities.voice",
  decision: "commands.subscribe.request.capabilities.decision",
  embedding: "commands.subscribe.request.capabilities.embedding",
} satisfies Record<SupporterRequestDenialFacts["capability"], string>;

const FAILURE_DESCRIPTION_KEYS: Record<SupporterFundingFailureReason, string> = {
  billing_unavailable: "commands.subscribe.sponsorship.errors.billing_unavailable",
  missing_sponsorship: "commands.subscribe.sponsorship.errors.missing_sponsorship",
  missing_subscription: "commands.subscribe.sponsorship.errors.unlinked",
  inconsistent: "commands.subscribe.sponsorship.errors.inconsistent",
  inactive_entitlement: "commands.subscribe.sponsorship.errors.inactive",
  unconfigured_tier: "commands.subscribe.sponsorship.errors.unconfigured_tier",
  allowance_exhausted: "commands.subscribe.sponsorship.errors.exhausted",
  model_not_allowed: "commands.subscribe.sponsorship.errors.model_not_allowed",
};

function formatDiscordTimestamp(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:D>`;
}

function getFailureDescriptionKey(
  reason: SupporterFundingFailureReason,
  details?: SupporterFundingFailureDetails,
): string {
  if (details?.periodEnd && reason === "allowance_exhausted") {
    return "commands.subscribe.sponsorship.errors.exhausted_generation";
  }

  return FAILURE_DESCRIPTION_KEYS[reason];
}

function getFailureDescriptionVars(details?: SupporterFundingFailureDetails): Record<string, string> {
  return {
    period_end: details?.periodEnd ? formatDiscordTimestamp(details.periodEnd) : "",
  };
}

export function getSupporterRequestFailureMessage(
  error: SupporterRequestDenialFacts,
  locale: string,
  forFallback = false,
): { titleKey: string; descriptionKey: string; descriptionVars: Record<string, string> } {
  const subscription = commandRegistry.getCommandMention("subscribe", undefined, undefined, true);
  const minimumBalance = error.reason === "allowance_exhausted" ? error.details?.minimumBalanceUsd : undefined;
  const vars = {
    ...getFailureDescriptionVars(error.details),
    scope: localizer(locale, SCOPE_KEYS[error.fundingScope]),
    capability: localizer(locale, CAPABILITY_KEYS[error.capability]),
    renewal: error.details?.periodEnd
      ? localizer(locale, "commands.subscribe.request.renewal", getFailureDescriptionVars(error.details))
      : localizer(locale, "commands.subscribe.request.renewal_unknown", { subscription }),
    retry: error.details?.retryAt
      ? localizer(locale, "commands.subscribe.request.retry_at", {
          retry_at: `<t:${Math.ceil(error.details.retryAt.getTime() / 1000)}:R>`,
        })
      : localizer(locale, "commands.subscribe.request.retry_later"),
    fallback: localizer(locale, "commands.subscribe.request.fallback_failed"),
    subscription,
    model: error.details?.modelCodename
      ? inlineCode(error.details.modelCodename)
      : localizer(locale, "commands.subscribe.request.model_unknown"),
    config:
      error.fundingScope === "personal"
        ? commandRegistry.getCommandMention("personal", "config", undefined, true)
        : commandRegistry.getCommandMention("config", undefined, undefined, true),
    providers:
      error.fundingScope === "personal"
        ? commandRegistry.getCommandMention("personal", "providers", undefined, true)
        : commandRegistry.getCommandMention("providers", undefined, undefined, true),
  };
  let descriptionKey =
    error.reason === "allowance_exhausted"
      ? "commands.subscribe.request.exhausted"
      : error.reason === "capacity_unavailable"
        ? error.details?.retryable === false
          ? "commands.subscribe.request.capacity_unavailable"
          : "commands.subscribe.request.capacity"
        : error.reason === "model_not_allowed" ||
            error.reason === "model_unavailable" ||
            error.reason === "unsupported_capability"
          ? "commands.subscribe.request.unsupported"
          : getFailureDescriptionKey(error.reason, error.details);
  if (forFallback && error.reason === "allowance_exhausted") {
    descriptionKey = "commands.subscribe.request.allowance_reason";
  } else if (forFallback && error.reason === "capacity_unavailable") {
    descriptionKey = "commands.subscribe.request.capacity_reason";
  }
  if (minimumBalance !== undefined) {
    descriptionKey = forFallback
      ? "commands.subscribe.request.minimum_balance_reason"
      : "commands.subscribe.request.minimum_balance";
  }
  const titleKey =
    minimumBalance !== undefined
      ? "commands.subscribe.request.minimum_balance_title"
      : error.reason === "allowance_exhausted"
        ? "commands.subscribe.request.allowance_title"
        : "commands.subscribe.request.title";
  return { titleKey, descriptionKey, descriptionVars: vars };
}

export function getSupporterRequestFailureCopy(
  error: SupporterRequestDenialFacts,
  locale: string,
  forFallback = false,
): ProviderRequestFailureCopy {
  const message = getSupporterRequestFailureMessage(error, locale, forFallback);
  return {
    titleKey: message.titleKey,
    description: localizer(locale, message.descriptionKey, message.descriptionVars),
  };
}

/**
 * A tool's error reaches only the model, which may paraphrase or drop it, so the subscription notice
 * also goes to the channel directly.
 *
 * @returns The localized description to return to the model as the tool error.
 */
export async function notifySupporterToolFailure(
  context: Pick<ToolContext, "channel" | "locale" | "isUserImpersonation">,
  error: SupporterRequestDeniedError,
): Promise<string> {
  const copy = getSupporterRequestFailureCopy(error, context.locale);
  if (!context.isUserImpersonation) {
    await sendStandardEmbed(context.channel, context.locale, { ...copy, color: ColorCode.ERROR }).catch((sendError) =>
      log.warn("Failed to send subscription tool notice", sendError),
    );
  }
  return copy.description;
}
