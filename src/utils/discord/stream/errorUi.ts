import { findProviderRequestDeniedError, getProviderRequestFailureCopy } from "@/utils/provider/providerUsage";
import { MessageFlags, PermissionFlagsBits, type ButtonInteraction, type ColorResolvable } from "discord.js";
import type { RestrictedDetailModal } from "@/types/discord/embed";
import type { ProviderError, StreamProvider, StreamContext } from "@/types/stream/interfaces";
import { sendStandardEmbed } from "@/utils/discord/embedHelper";
import { ColorCode, log, redactLogString } from "@/utils/misc/logger";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import {
  getProviderErrorDetail,
  isAccountBalanceExhaustedError,
  isContextLengthError,
  isCreditAffordabilityError,
  isNvidiaCredentialRejected,
  isOperatorActionableProviderError,
  isProviderModelError,
} from "@/utils/provider/providerErrorClassification";
import { localizer } from "@/utils/text/localizer";
import { withSupporterNudge, type SupporterNudgeContext } from "@/modules/supporter-billing/discord/conversionNudge";

const PERSONAL_TIP_KEYS = {
  "genai.tips.adjust_parameters": "genai.tips.adjust_parameters_personal",
  "genai.tips.choose_supported_model": "genai.tips.choose_supported_model_personal",
  "genai.tips.model_fallback": "genai.tips.model_fallback_personal",
  "genai.tips.nvidia_register_free_model": "genai.tips.nvidia_register_free_model_personal",
  "genai.tips.openrouter_add_credits": "genai.tips.openrouter_add_credits_personal",
  "genai.tips.openrouter_free_models": "genai.tips.openrouter_free_models_personal",
  "genai.tips.openrouter_models": "genai.tips.openrouter_models_personal",
  "genai.tips.reduce_output_tokens": "genai.tips.reduce_output_tokens_personal",
  "genai.tips.switch_model_provider": "genai.tips.switch_model_provider_personal",
  "genai.tips.verify_api_key": "genai.tips.verify_api_key_personal",
};

/** Attributes an internal failure to TomoriBot so users do not debug their provider for it. */
export const TOMORIBOT_ERROR_FOOTER_KEY = "genai.stream.error_footer_tomoribot";

/**
 * Names the provider a failed request ran on, so an upstream refusal or outage is not read as a
 * TomoriBot bug. A personal route names the member's own provider ahead of the DM wording because
 * the member's key failed, not the bot owner's.
 */
export function resolveProviderErrorFooter(args: {
  providerName: string;
  textCredentialSource?: "server" | "personal" | "supporter";
  isDM?: boolean;
}): { footerKey: string; footerVars: { provider: string } } {
  const footerVars = { provider: getProviderDisplayName(args.providerName) };
  if (args.textCredentialSource === "personal") {
    return { footerKey: "genai.stream.error_footer_personal_provider", footerVars };
  }
  if (args.isDM) {
    return { footerKey: "genai.stream.error_footer_dm_provider", footerVars };
  }
  return { footerKey: "genai.stream.error_footer_server_provider", footerVars };
}

/** Guild channels carry their guild; a DM channel has none, and test doubles need not implement `isDMBased`. */
export function isDirectMessageChannel(channel: object): boolean {
  return !("guild" in channel && channel.guild);
}

function supporterNudgeContext(context: StreamContext): SupporterNudgeContext {
  return {
    userDiscId: context.triggererDiscId,
    serverId: context.tomoriState.server_id,
    credentialSource: context.textCredentialSource,
  };
}

/**
 * Owns provider and generic stream error reporting to Discord.
 */
export class StreamErrorUi {
  public async handleProviderError(error: unknown, provider: StreamProvider, context: StreamContext): Promise<void> {
    const providerError = error as ProviderError;
    const locale = context.locale;
    const denied = findProviderRequestDeniedError(error, context.usageContext);
    const denialCopy = denied ? getProviderRequestFailureCopy(denied, locale) : null;
    const isModelError = isProviderModelError(providerError);
    const providerDescription =
      denialCopy?.description ?? this.resolveProviderDescription(providerError, provider, locale, isModelError);
    const errorMessage =
      providerDescription ||
      localizer(locale, "genai.stream.provider_error_interaction", {
        reason: providerError.type || "unknown",
      });

    const providerDetail = denied ? null : getProviderErrorDetail(providerError);
    const operatorDetail = boundOperatorDetail(providerDetail);
    if (!denied && isOperatorActionableProviderError(providerError)) {
      const providerName = provider.getProviderInfo().name;
      // Not awaited: an unacknowledged initialInteraction is replied to below. The raw provider
      // error is the payload because errorMessage is localized for the guild, not the operator.
      void log.error(
        `Provider stream error (${providerName} ${providerError.type}/${providerError.code ?? "unknown"}): ${operatorDetail}`,
        providerError.originalError ?? providerError,
        {
          serverId: context.tomoriState.server_id,
          userId: context.triggererUserId ?? null,
          errorType: "ProviderStreamError",
          metadata: {
            // A personal route ran on the user's own key and endpoint, not the server's provider.
            textCredentialSource: context.textCredentialSource ?? "server",
            provider: providerName,
            providerErrorType: providerError.type,
            providerErrorCode: providerError.code ?? "unknown",
            channelId: context.channel.id,
          },
        },
      );
    } else {
      log.warn(`Stream error (${providerError.type}/${providerError.code ?? "unknown"}): ${operatorDetail}`, error);
    }

    if (context.initialInteraction) {
      if (!context.initialInteraction.replied && !context.initialInteraction.deferred) {
        await context.initialInteraction
          .reply({ content: errorMessage, flags: MessageFlags.Ephemeral })
          .catch((e) => log.warn("Stream: Failed to reply to initial interaction with error", e));
      } else {
        await context.initialInteraction
          .followUp({ content: errorMessage, flags: MessageFlags.Ephemeral })
          .catch((e) => log.warn("Stream: Failed to followUp initial interaction with error", e));
      }
      return;
    }

    const restrictedDetail = providerDetail ? buildRestrictedErrorDetail(providerDetail, context) : undefined;
    const sourceFooter = resolveProviderErrorFooter({
      providerName: context.tomoriState.llm.llm_provider,
      textCredentialSource: context.textCredentialSource,
      isDM: isDirectMessageChannel(context.channel),
    });

    if (providerDescription) {
      const { titleKey, tipKeys, color } = denialCopy
        ? { titleKey: denialCopy.titleKey, tipKeys: [], color: ColorCode.ERROR }
        : this.resolveProviderErrorPresentation(providerError, provider, context);

      await sendStandardEmbed(context.channel, locale, {
        titleKey,
        description: providerDescription,
        color,
        tipKeys: denied ? tipKeys : await withSupporterNudge(tipKeys, supporterNudgeContext(context)),
        restrictedDetail,
        ...sourceFooter,
      }).catch((e) => log.warn("Stream: Failed to send provider error embed to channel", e));
      return;
    }

    await sendStandardEmbed(context.channel, locale, {
      titleKey: "genai.stream.response_stopped_title",
      descriptionKey: "genai.stream.response_stopped_description",
      descriptionVars: {
        reason: providerError.type || "unknown",
      },
      color: ColorCode.ERROR,
      tipKeys: await withSupporterNudge(
        [
          "genai.tips.refresh_context",
          context.textCredentialSource === "personal"
            ? "genai.tips.switch_model_provider_personal"
            : "genai.tips.switch_model_provider",
        ],
        supporterNudgeContext(context),
      ),
      restrictedDetail,
      ...sourceFooter,
    }).catch((e) => log.warn("Stream: Failed to send error embed to channel", e));
  }

  public async handleStreamError(error: Error, context: StreamContext): Promise<void> {
    const denied = findProviderRequestDeniedError(error, context.usageContext);
    if (denied) {
      const copy = getProviderRequestFailureCopy(denied, context.locale);
      if (context.initialInteraction) {
        const payload = { content: copy.description, flags: MessageFlags.Ephemeral } as const;
        const interaction = context.initialInteraction;
        await (interaction.replied || interaction.deferred
          ? interaction.followUp(payload)
          : interaction.reply(payload)
        ).catch((sendError) => log.warn("Failed to send provider request denial", sendError));
      } else {
        await sendStandardEmbed(context.channel, context.locale, { ...copy, color: ColorCode.ERROR }).catch(
          (sendError) => log.warn("Failed to send provider request denial", sendError),
        );
      }
      return;
    }
    // The orchestrator already logged the exception; its text can carry an endpoint's response.
    const errorMessage = localizer(context.locale, "genai.stream.streaming_failed_description");

    if (context.initialInteraction) {
      if (!context.initialInteraction.replied && !context.initialInteraction.deferred) {
        await context.initialInteraction
          .reply({ content: errorMessage, flags: MessageFlags.Ephemeral })
          .catch((e) => log.warn("Stream: Failed to reply to initial interaction with error", e));
      } else {
        await context.initialInteraction
          .followUp({ content: errorMessage, flags: MessageFlags.Ephemeral })
          .catch((e) => log.warn("Stream: Failed to followUp initial interaction with error", e));
      }
      return;
    }

    await sendStandardEmbed(context.channel, context.locale, {
      titleKey: "genai.generic_error_title",
      descriptionKey: "genai.stream.streaming_failed_description",
      color: ColorCode.ERROR,
      tipKeys: await withSupporterNudge(["genai.tips.refresh_context"], supporterNudgeContext(context)),
      footerKey: TOMORIBOT_ERROR_FOOTER_KEY,
    }).catch((e) => log.warn("Stream: Failed to send generic error embed to channel", e));
  }

  /**
   * Resolves the title, tip-item keys, and color for a provider error embed.
   *
   * Tips are composed from atomic keys so conditional items stay declarative:
   * - `model_fallback` is only offered when the server has no fallback chain configured yet.
   * - OpenRouter-specific items (free-model list / model list) are appended only for that provider.
   * - Every command-bearing tip resolves against `context.textCredentialSource`, so a failure on
   *   the user's own key never recommends a manager-only server command that cannot repair it.
   * @param provider - The active stream provider (used to detect OpenRouter for conditional tips).
   * @returns The title key, ordered tip-item keys, and embed color.
   */
  private resolveProviderErrorPresentation(
    providerError: ProviderError,
    provider: StreamProvider,
    context: StreamContext,
  ): {
    titleKey: string;
    tipKeys: string[];
    color: ColorResolvable;
  } {
    // Detect the provider and whether a fallback chain already exists: both gate conditional tips.
    const providerName = provider.getProviderInfo().name;
    const isOpenRouter = providerName === "openrouter";
    const isPersonal = context.textCredentialSource === "personal";

    /** Picks the personal variant of a tip key when the failing request used a personal key. */
    const scoped = (key: keyof typeof PERSONAL_TIP_KEYS): string => (isPersonal ? PERSONAL_TIP_KEYS[key] : key);

    // A personal text override reads the user's own fallback chain, not the server's, so the
    // server-side chain says nothing about whether this request had a fallback to fall back to.
    const hasFallbackModels =
      !isPersonal && (context.tomoriState.fallback_chain?.length ?? context.tomoriState.fallback_llms?.length ?? 0) > 0;
    const modelFallbackTip = hasFallbackModels ? [] : [scoped("genai.tips.model_fallback")];

    // Offered whenever a personal text route failed: the user can usually recover immediately by
    // handing the turn back to the server default, except where User BYOK mode forbids it.
    const disableOverrideTip = isPersonal ? ["genai.tips.disable_personal_text_override"] : [];

    // Unscoped: the tip names no command, so it reads the same for a personal key.
    const keyRejectionTips = isNvidiaCredentialRejected(providerName, providerError)
      ? ["genai.tips.verify_api_key_expiry"]
      : [];

    // NVIDIA retires hosted models faster than the seeded catalog can follow, and a backed-up free
    // queue looks like a timeout or overload, so each of those points at a model NVIDIA serves today.
    const nvidiaFreeModelTip = providerName === "nvidia" ? [scoped("genai.tips.nvidia_register_free_model")] : [];

    // Specialized Error Conditions
    const isPrivacyError = providerError.message.includes("Privacy Policy Error");
    if (isPrivacyError) {
      return {
        titleKey: "genai.stream.privacy_error_title",
        tipKeys: [
          "genai.tips.openrouter_privacy_settings",
          scoped("genai.tips.choose_supported_model"),
          ...(isOpenRouter ? [scoped("genai.tips.openrouter_models")] : []),
        ],
        color: ColorCode.ERROR,
      };
    }

    const isTempTopPConflict =
      typeof providerError.userMessage === "string" &&
      providerError.userMessage.includes("`temperature` and `top_p` cannot both be specified");
    if (isTempTopPConflict) {
      return {
        titleKey: "genai.stream.api_error_title",
        tipKeys: [scoped("genai.tips.adjust_parameters"), scoped("genai.tips.switch_model_provider")],
        color: ColorCode.ERROR,
      };
    }

    // Model errors (unsupported/unknown/deprecated model IDs): steer toward a supported model.
    if (isProviderModelError(providerError)) {
      return {
        titleKey: "genai.stream.model_error_title",
        tipKeys: [
          scoped("genai.tips.choose_supported_model"),
          ...nvidiaFreeModelTip,
          ...(isOpenRouter ? [scoped("genai.tips.openrouter_models")] : []),
          ...disableOverrideTip,
        ],
        color: ColorCode.ERROR,
      };
    }

    // Exhausted account balance (e.g. DeepSeek 402 "Insufficient Balance"): checked before the
    //    affordability branch because an empty wallet is the stricter condition, and before the
    //    generic api_error default, whose `verify_api_key` tip misdiagnoses a perfectly valid key.
    if (isAccountBalanceExhaustedError(providerError)) {
      return {
        titleKey: "genai.stream.balance_exhausted_title",
        tipKeys: [
          "genai.tips.top_up_provider_balance",
          ...(providerName === "deepseek" ? ["genai.tips.deepseek_top_up"] : []),
          ...(isOpenRouter ? [scoped("genai.tips.openrouter_add_credits")] : []),
          scoped("genai.tips.switch_model_provider"),
          ...disableOverrideTip,
        ],
        color: ColorCode.ERROR,
      };
    }

    // Credit-affordability ceiling (e.g. OpenRouter 402): the account cannot pay for the
    //    requested max_tokens. Adding history back does not help, so steer toward lowering the
    //    output-token cap or topping up credits. Checked before the context-length branch
    //    because the 402 copy is the more specific signal.
    if (isCreditAffordabilityError(providerError)) {
      return {
        titleKey: "genai.stream.credit_limit_title",
        tipKeys: [
          scoped("genai.tips.reduce_output_tokens"),
          ...(isOpenRouter ? [scoped("genai.tips.openrouter_add_credits")] : []),
          scoped("genai.tips.switch_model_provider"),
          ...disableOverrideTip,
        ],
        color: ColorCode.ERROR,
      };
    }

    // Hard context-window overflow (e.g. OpenRouter 400 "maximum context length"): trimming the
    //    request genuinely helps. Lead with the output-token cap (the reserve the truncator honors),
    //    then context refresh / shorter message, then a model-fallback nudge when none is configured.
    if (isContextLengthError(providerError)) {
      return {
        titleKey: "genai.stream.context_length_title",
        tipKeys: [
          scoped("genai.tips.reduce_output_tokens"),
          "genai.tips.refresh_context",
          "genai.tips.shorten_message",
          ...modelFallbackTip,
        ],
        color: ColorCode.ERROR,
      };
    }

    switch (providerError.type) {
      case "rate_limit":
        return {
          titleKey: context.rotationKeyRetriesUsed
            ? "genai.stream.rate_limit_title_all_rotation_keys"
            : "genai.stream.rate_limit_title",
          tipKeys: [
            "genai.tips.wait_and_retry",
            // Rotation pools are a server-scoped, manager-only feature; a personal key has none.
            ...(isPersonal ? [] : ["genai.tips.api_key_rotation"]),
            ...modelFallbackTip,
            ...(isOpenRouter ? [scoped("genai.tips.openrouter_free_models")] : []),
            ...(isOpenRouter && providerError.message.includes("free-models-per-day")
              ? ["genai.tips.openrouter_fund_account"]
              : []),
            ...disableOverrideTip,
          ],
          color: ColorCode.WARN,
        };
      case "content_blocked":
        return {
          titleKey: "genai.stream.content_blocked_title",
          tipKeys: [
            "genai.tips.nsfw_jailbreaks",
            "genai.tips.review_messages",
            "genai.tips.review_memories",
            "genai.tips.blacklist_member",
            scoped("genai.tips.switch_model_provider"),
          ],
          color: ColorCode.ERROR,
        };
      case "timeout":
        return {
          titleKey: "genai.stream.timeout_title",
          tipKeys: ["genai.tips.shorten_message", "genai.tips.refresh_context", ...nvidiaFreeModelTip],
          color: ColorCode.WARN,
        };
      case "provider_overloaded":
        return {
          titleKey: "genai.stream.provider_overloaded_title",
          tipKeys: ["genai.tips.provider_overloaded_wait", ...modelFallbackTip, ...nvidiaFreeModelTip],
          color: ColorCode.WARN,
        };
      default:
        return {
          titleKey: "genai.stream.api_error_title",
          tipKeys: [
            // Google rejects a Vertex-style OAuth/service account credential with
            // ACCESS_TOKEN_TYPE_UNSUPPORTED. "Double-check your API key" misleads here: the key is
            // not mistyped, it is the wrong kind of credential for this provider.
            ...(providerError.message.includes("ACCESS_TOKEN_TYPE_UNSUPPORTED")
              ? ["genai.tips.google_credential_type"]
              : []),
            scoped("genai.tips.verify_api_key"),
            ...keyRejectionTips,
            // NIM answers some retired routes with a bare "404 page not found" that no model
            // pattern can recognize without also catching unrelated 404s.
            ...(providerError.code === "404" || providerError.code === "410" ? nvidiaFreeModelTip : []),
            scoped("genai.tips.switch_model_provider"),
            ...(isOpenRouter ? [scoped("genai.tips.openrouter_models")] : []),
            ...disableOverrideTip,
          ],
          color: providerError.retryable ? ColorCode.WARN : ColorCode.ERROR,
        };
    }
  }

  /**
   * The provider's localized, classified headline. Upstream response text stays out of the embed:
   * the embed is public, self-debug feeds it back into model context, and an endpoint can echo the
   * bearer value it received in any encoding pattern redaction would miss. The raw text is offered
   * only through {@link buildRestrictedErrorDetail}.
   * @param isModelError - Whether the error classifies as a model-selection error (drives the headline fallback).
   * @returns The headline, or null when no headline can be produced.
   */
  private resolveProviderDescription(
    providerError: ProviderError,
    provider: StreamProvider,
    locale: string,
    isModelError: boolean,
  ): string | null {
    const providerHeadline = provider.createErrorDescription(providerError, locale);
    return providerHeadline || (isModelError ? localizer(locale, "genai.stream.model_error_description") : null);
  }
}

const OPERATOR_ERROR_DETAIL_CHARS = 2000;

/** Response bodies are unbounded, and logger truncation is opt-in per deployment. */
function boundOperatorDetail(detail: string | null): string {
  if (!detail) return "no provider detail";
  return detail.length > OPERATOR_ERROR_DETAIL_CHARS ? `${detail.slice(0, OPERATOR_ERROR_DETAIL_CHARS)}...` : detail;
}

/** One 4000-char text display minus the code fence, so the fence never splits across displays. */
const ERROR_DETAIL_MODAL_CHARS = 3_900;
/** Adapter prefixes are a short label; anything longer is upstream text that must leave room for the body. */
const ERROR_DETAIL_PREFIX_CHARS = 500;
/** Placed between adjacent backticks so provider text cannot close the code fence early. */
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const CODE_FENCE = "```";
const NESTED_JSON_DEPTH = 4;

/**
 * Offers the raw provider error behind a gated modal. A modal reaches only the viewer and never
 * enters channel history, so neither the channel nor self-debug sees it; the remaining exposure
 * is limited to the people who could already replace the failing key.
 */
export function buildRestrictedErrorDetail(
  detail: string,
  context: Pick<StreamContext, "textCredentialSource" | "triggererDiscId">,
): RestrictedDetailModal {
  // A personal route ran on the triggerer's own key and endpoint, which server managers do not own.
  if (context.textCredentialSource === "personal") {
    const ownerDiscId = context.triggererDiscId;
    return {
      content: formatProviderErrorDetail(detail),
      access: {
        canOpen: (interaction) => ownerDiscId !== undefined && interaction.user.id === ownerDiscId,
        deniedKey: "genai.error_detail.personal_only",
      },
    };
  }
  return {
    content: formatProviderErrorDetail(detail),
    access: { canOpen: canManageServerCredentials, deniedKey: "genai.error_detail.manage_server_only" },
  };
}

/** Outside a guild the only person who can press the button is the DM's own user. */
function canManageServerCredentials(interaction: ButtonInteraction): boolean {
  if (!interaction.inGuild()) return true;
  return interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild);
}

/**
 * Pretty-prints the JSON body an adapter wraps in its own prefix (Google nests a second JSON
 * document inside `error.message`), then redacts the rendered text so unwrapping cannot expose a
 * credential that was escaped in the original.
 */
export function formatProviderErrorDetail(detail: string): string {
  const jsonStart = detail.indexOf("{");
  const parsed = jsonStart === -1 ? undefined : tryParseJson(detail.slice(jsonStart));
  const prefix =
    parsed === undefined
      ? ""
      : boundText(redactLogString(detail.slice(0, jsonStart).trim()), ERROR_DETAIL_PREFIX_CHARS);
  const body = parsed === undefined ? detail : JSON.stringify(unwrapNestedJson(parsed, 0), null, 2);
  const language = parsed === undefined ? "" : "json";
  const escaped = redactLogString(body).replace(/`(?=`)/g, `\`${ZERO_WIDTH_SPACE}`);
  const fenced = boundText(escaped, ERROR_DETAIL_MODAL_CHARS - prefix.length);
  const block = [`${CODE_FENCE}${language}`, fenced, CODE_FENCE].join("\n");
  return prefix ? `${prefix}\n${block}` : block;
}

/** Redact before bounding, so a cut never leaves half a credential the patterns can no longer match. */
function boundText(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function unwrapNestedJson(value: unknown, depth: number): unknown {
  if (depth >= NESTED_JSON_DEPTH) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
    const parsed = tryParseJson(trimmed);
    return parsed === undefined ? value : unwrapNestedJson(parsed, depth + 1);
  }
  if (Array.isArray(value)) return value.map((entry) => unwrapNestedJson(entry, depth + 1));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, unwrapNestedJson(entry, depth + 1)]));
  }
  return value;
}
