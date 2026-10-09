import type { StreamContext } from "@/types/stream/interfaces";
import type { PendingResponseLimit, PendingResponseTruncation } from "@/types/stream/pendingResponse";
import {
  DISCORD_STREAMING_CONSTANTS,
  type StreamState,
  type TextProcessingConfig,
  type TypingSimulationConfig,
} from "@/types/stream/types";
import { log } from "@/utils/misc/logger";
import { STREAMING_LIMITS } from "@/utils/security/rateLimiter";
import { cleanLLMOutput, truncateBeforeGenericSpeakerLine } from "@/utils/text/processors/llmOutputProcessor";
import { filterDuplicateCustomEmojis } from "@/utils/text/emojiPenalty";
import { extractMarkdownTableSegments } from "@/utils/text/markdownTable";
import {
  MAX_EMPTY_RESPONSE_RETRIES,
  MAX_PENDING_RESPONSE_BYTES,
  MAX_PENDING_RESPONSE_SEGMENTS,
  ORPHAN_PUNCTUATION_REGEX,
} from "@/utils/discord/stream/constants";
import type { ResolvedWebhookIdentity } from "@/utils/discord/webhook/identity";
import { resolveGuildMentions } from "@/utils/discord/stream/mentionResolver";
import type {
  BufferedDeliveryBoundary,
  StreamDeliveryOptions,
  StreamMessageDelivery,
} from "@/utils/discord/stream/messageDelivery";
import {
  collectRenderModifierSourceNames,
  formatRenderModifierWebhookName,
  hasLeadingPlainOwnNameLabel,
  isAllowedRenderModifierSpeakerLabel,
  NEUTRAL_APPEARANCE_MODIFIER,
  type LeadingGenericSpeakerLabelMatch,
  matchesRenderModifierName,
  parseLeadingGenericSpeakerLabel,
  parseLeadingRenderModifier,
} from "@/utils/discord/renderModifierParser";
import {
  collectKnownSpeakerNames,
  resolveCopiedRenderModifierTarget,
  resolveSpriteRenderModifierTarget,
  type SpriteRenderModifierResolution,
} from "@/utils/discord/renderModifierResolver";
import { getCachedPersonaSprites } from "@/utils/cache/personaSpriteCache";
import { normalizePersonaSpriteKey } from "@/utils/persona/sprites";
import { advanceChannelSpriteGroupParity } from "@/utils/discord/stream/channelDeliveryContinuity";
import { isUserImpersonationStreamContext } from "@/utils/discord/stream/uiUpdater";
import { toGroupBreakName } from "@/utils/text/groupBreakName";

type StreamSegmentProcessorDependencies = {
  delivery: StreamMessageDelivery;
  requestStop: (channelId: string, requesterId?: string) => boolean;
};

/**
 * Loose detector for "something that LOOKS like a decorated speaker label": a parenthesized
 * group followed by a colon, anywhere near the head of a segment. Deliberately far more
 * permissive than parseLeadingRenderModifier (no name allowlist, not anchored to the start)
 * so the diagnostic below fires precisely on the cases where the strict parser refused text
 * a human would call a sprite label.
 */
const SUSPECTED_RENDER_MODIFIER_LABEL_RE = /\([^()\n\r:：]{1,64}\)\s*[:：]/;

/** How much of a segment to echo into the diagnostic line. */
const RENDER_MODIFIER_DIAGNOSTIC_HEAD_CHARS = 80;

// Sprite keys can never contain parentheses (validatePersonaSpriteName rejects them), so this key
// cannot collide with a real sprite named "neutral" in the channel's group alternation.
const NEUTRAL_APPEARANCE_GROUP_KEY = "(neutral)";

/**
 * Owns normalization and routing for flushed stream text segments before Discord delivery.
 */
export class StreamSegmentProcessor {
  public constructor(private readonly deps: StreamSegmentProcessorDependencies) {}

  public async sendBufferSegment(
    flushedSegment: string,
    boundary: BufferedDeliveryBoundary | undefined,
    textConfig: TextProcessingConfig,
    typingConfig: TypingSimulationConfig,
    context: StreamContext,
    state: StreamState,
  ): Promise<void> {
    const segment = context.holdResponseText
      ? this.retainHeldSegment(flushedSegment, boundary, context, state)
      : flushedSegment;
    if (segment === null) return;
    const opensLine = state.nextSegmentOpensLine ?? true;
    state.nextSegmentOpensLine = segmentEndsLine(segment, boundary);
    if (!segment.trim()) return;

    const trimmedGuard = segment.trim();
    if (ORPHAN_PUNCTUATION_REGEX.test(trimmedGuard) && (trimmedGuard.length >= 3 || trimmedGuard.includes("…"))) {
      state.pendingOrphanPunctuation = (state.pendingOrphanPunctuation ?? "") + trimmedGuard;
      if (!context.holdResponseText)
        log.info(
          `Stream Orphan: Holding "${trimmedGuard}" (pending="${state.pendingOrphanPunctuation}") for next segment`,
        );
      return;
    }

    if (trimmedGuard.length === 1 && !/\w/u.test(trimmedGuard)) return;
    if (trimmedGuard === "..") return;

    let workingSegment = segment;
    // Track whether orphan punctuation was spliced onto the front, since that mutation
    // happens BEFORE the anchored render-modifier parse and can single-handedly defeat it.
    let orphanPrefixApplied: string | undefined;
    if (state.pendingOrphanPunctuation) {
      if (!context.holdResponseText)
        log.info(`Stream Orphan: Prepending held "${state.pendingOrphanPunctuation}" to next segment`);
      orphanPrefixApplied = state.pendingOrphanPunctuation;
      workingSegment = `${state.pendingOrphanPunctuation}${segment}`;
      state.pendingOrphanPunctuation = undefined;
    }

    const renderModifierSourceNames = collectRenderModifierSourceNames(textConfig.botName, textConfig.botNameAliases);
    const renderModifierChainSourceNames = collectRenderModifierChainSourceNames(textConfig, renderModifierSourceNames);
    let deliveryOptions: StreamDeliveryOptions | undefined;
    const isUserImpersonation = isUserImpersonationStreamContext(context);
    const canUseRenderModifier = !state.isInsideCodeBlock && !isUserImpersonation;
    const renderModifierMatch = canUseRenderModifier
      ? parseLeadingRenderModifier(workingSegment, renderModifierSourceNames, renderModifierChainSourceNames)
      : null;
    this.logUnparsedRenderModifierLabel({
      renderModifierMatch: Boolean(renderModifierMatch),
      canUseRenderModifier,
      orphanPrefixApplied,
      rawSegment: segment,
      workingSegment,
      context,
      state,
      textConfig,
      renderModifierSourceNames,
      renderModifierChainSourceNames,
    });
    if (renderModifierMatch) {
      const sourceDisplayName = context.tomoriState.persona_nickname || textConfig.botName;
      workingSegment = renderModifierMatch.body;

      const spriteResolution = await resolveSpriteRenderModifierTarget(
        renderModifierMatch.modifier,
        context,
        sourceDisplayName,
      );
      const renderTarget =
        spriteResolution.status === "matched"
          ? spriteResolution.target
          : await resolveCopiedRenderModifierTarget(renderModifierMatch.modifier, context, sourceDisplayName);

      if (renderTarget) {
        // Non-identity sprites all share the clean persona username, and Discord groups
        // consecutive webhook messages by webhook + username while ignoring the
        // per-message avatar, so back-to-back sprites would render under the first
        // sprite's avatar. Identity sprites already use a distinct decorated name, so they
        // are excluded.
        const identity =
          renderTarget.spriteRecord && !renderTarget.isIdentitySprite && !context.holdResponseText
            ? this.resolveSpriteGroupBreakIdentity(
                renderTarget.identity,
                renderTarget.contextLabel,
                renderTarget.spriteRecord.spriteName,
                context.channel.id,
                context.channel.lastMessageId,
              )
            : renderTarget.identity;
        // The accumulated-text prefix keeps the decorated "Name (modifier): "
        // label so the model sees its own modifier usage, even when the webhook
        // username is the clean persona name (sprite renders).
        deliveryOptions = {
          identityOverride: identity,
          accumulatedTextPrefix: `${renderTarget.contextLabel}: `,
          spriteRecord: renderTarget.spriteRecord,
        };
        state.activeRenderModifier = {
          identity,
          spriteRecord: renderTarget.spriteRecord,
        };
      } else {
        await this.logUnresolvedRenderModifierTarget(renderModifierMatch.modifier, spriteResolution.status, context);
        state.activeRenderModifier = undefined;
      }
    } else if (!isUserImpersonation && state.activeRenderModifier) {
      // Code-block content is still this speaker's turn, so the active identity carries into it;
      // only label parsing is vetoed there. The flusher sends a closing-fence or overflow segment
      // before clearing isInsideCodeBlock, so gating the carry on it drops the sprite and moves
      // a main persona off its webhook onto the bot user for that segment.
      // The label itself is left in place: cleanLLMOutput strips it like any opening own-name label.
      if (canUseRenderModifier && opensLine && hasLeadingPlainOwnNameLabel(workingSegment, renderModifierSourceNames)) {
        state.activeRenderModifier = this.resolveBaseAppearanceRevert(state.activeRenderModifier, context, textConfig);
      }
      if (state.activeRenderModifier) {
        deliveryOptions = {
          identityOverride: state.activeRenderModifier.identity,
          spriteRecord: state.activeRenderModifier.spriteRecord,
          isNeutralAppearance: state.activeRenderModifier.isNeutralAppearance,
        };
      }
    }

    // Opening-label leak guard: a response that OPENS with a speaker label the render-modifier
    // parse refused (e.g. "Chris (smug): ...": a user name in the persona's decorated-label
    // grammar) would otherwise reach Discord verbatim, because the generic speaker guard
    // exempts the opening line and stripLeakedOwnNameLabels only covers the active persona.
    // Runs regardless of llm_stop_speaker_pattern_enabled: the shapes it fires on are
    // unambiguous leaks, unlike the broader mid-text guard.
    if (
      !renderModifierMatch &&
      canUseRenderModifier &&
      !(state.accumulatedText || state.pendingResponseText || "").trim() &&
      !state.pendingAggregatedText.trim()
    ) {
      const leak = await this.matchLeadingSpeakerLeak(workingSegment, context, renderModifierSourceNames);
      if (leak) {
        const retryCount = context.emptyResponseRetryCount ?? 0;
        if (retryCount < MAX_EMPTY_RESPONSE_RETRIES) {
          // Budget remains: discard the whole attempt. The speaker_guard stop with nothing
          //    sent classifies the turn as empty_response, and maybeScheduleEmptyResponseRetry
          //    regenerates with the "reply only as {persona}" directive injected.
          if (!context.holdResponseText)
            log.warn(
              `Stream opening-label leak guard: discarding response opening with "${leak.matchedPrefix.trim()}" (retry ${retryCount + 1}/${MAX_EMPTY_RESPONSE_RETRIES} will be scheduled)`,
            );
          this.deps.requestStop(context.channel.id, "speaker_guard");
          return;
        }
        // Budget exhausted: better a stripped reply than silence, so drop the leaked label
        //    and deliver the body as the active persona.
        if (!context.holdResponseText)
          log.warn(
            `Stream opening-label leak guard: retry budget exhausted, stripping leaked label "${leak.matchedPrefix.trim()}" and delivering body`,
          );
        workingSegment = leak.body;
        if (!workingSegment.trim()) return;
      }
    }

    const leadingWhitespaceMatch = workingSegment.match(/^\s+/);
    const leadingWhitespace = leadingWhitespaceMatch?.[0] ?? "";
    const normalizedLeadingWhitespace = textConfig.uncensorUnicodeSpacesEnabled
      ? leadingWhitespace.replace(/\u2800/g, " ")
      : leadingWhitespace;

    const filteredSegment = filterDuplicateCustomEmojis(workingSegment, context.contextItems);
    const cleanedSegment = cleanLLMOutput(
      filteredSegment,
      textConfig.botName,
      textConfig.emojiStrings,
      textConfig.emojiUsageEnabled,
      textConfig.mentionMap,
      textConfig.mentionIdSet,
      {
        unicodeSpacesEnabled: textConfig.uncensorUnicodeSpacesEnabled,
        sanitizeEnabled: textConfig.uncensorSanitizeEnabled,
      },
      textConfig.botNameAliases,
      textConfig.personaMentionMap,
    );

    const segmentMentionMap = textConfig.mentionMap ?? new Map<string, string[]>();
    const segmentMentionIdSet = textConfig.mentionIdSet ?? new Set<string>();
    textConfig.mentionMap = segmentMentionMap;
    textConfig.mentionIdSet = segmentMentionIdSet;
    let resolvedSegment = await resolveGuildMentions(
      cleanedSegment,
      context.channel,
      segmentMentionMap,
      segmentMentionIdSet,
      textConfig.personaMentionMap,
    );
    if (
      normalizedLeadingWhitespace &&
      resolvedSegment.length > 0 &&
      !resolvedSegment.startsWith(normalizedLeadingWhitespace)
    ) {
      resolvedSegment = normalizedLeadingWhitespace + resolvedSegment;
    }

    let segmentToSend = this.stripPrefillFromSegment(resolvedSegment, state);

    let shouldStopForSpeakerGuard = false;
    if (context.tomoriState.config.llm_stop_speaker_pattern_enabled ?? false) {
      const speakerGuardResult = truncateBeforeGenericSpeakerLine(segmentToSend, {
        includeStart: Boolean(
          state.accumulatedText.trim() || state.pendingResponseText?.trim() || state.pendingAggregatedText.trim(),
        ),
        isAllowedSpeakerLabel: (label) => isAllowedRenderModifierSpeakerLabel(label, renderModifierSourceNames),
      });
      if (speakerGuardResult.stopTriggered) {
        if (!context.holdResponseText)
          log.warn(
            `Stream speaker guard: stopping before speaker label "${speakerGuardResult.matchedSpeaker ?? "unknown"}"`,
          );
        segmentToSend = speakerGuardResult.text;
        shouldStopForSpeakerGuard = true;
      }
    }

    if (!segmentToSend.trim()) {
      if (shouldStopForSpeakerGuard) {
        this.deps.requestStop(context.channel.id, "speaker_guard");
      }
      return;
    }

    // Copied identities (impersonating a user / another persona) expire at the end
    // of their line so the bot reverts to itself on the next line. Persona sprites
    // instead persist across newlines until a *different* sprite/identity label
    // appears, because an expression is a sustained visual state: e.g.
    //   "Touko (mad): ARGGHHH!\nFine... I'll do it"
    // keeps the "mad" sprite for the second line, and switching only happens when
    // a new "Touko (regret):" label is declared, or a plain "Touko:" label returns
    // to the base persona. Sprites (including is_identity ones) are distinguished by
    // carrying a spriteRecord; copied identities don't. The neutral appearance has
    // no spriteRecord either but is the persona itself, so it persists like a sprite.
    const shouldClearActiveRenderModifier =
      Boolean(deliveryOptions?.identityOverride) &&
      !deliveryOptions?.spriteRecord &&
      !state.activeRenderModifier?.isNeutralAppearance &&
      (boundary === "newline" || segmentToSend.includes("\n"));
    if (context.holdResponseText) {
      state.pendingResponseText =
        (state.pendingResponseText ?? "") + (deliveryOptions?.accumulatedTextPrefix ?? "") + segmentToSend;
      if (shouldClearActiveRenderModifier) state.activeRenderModifier = undefined;
      if (shouldStopForSpeakerGuard) this.deps.requestStop(context.channel.id, "speaker_guard");
      const deliverable = resolveDeliverableHeldLength(context);
      if (deliverable && !state.pendingResponseTruncation && state.pendingResponseText.length > deliverable.chars) {
        this.truncateHeldCollection(deliverable.truncation, context, state);
      }
      return;
    }
    const segmentedParts = extractMarkdownTableSegments(segmentToSend);
    const hasRenderedTable = segmentedParts.some((part) => part.type === "table");
    if (!hasRenderedTable) {
      await this.deps.delivery.sendSegment(
        segmentToSend,
        boundary,
        textConfig,
        typingConfig,
        context,
        state,
        deliveryOptions,
      );
    } else {
      let isFirstTextPart = true;
      let partDeliveryOptions = deliveryOptions;
      for (const part of segmentedParts) {
        if (part.type === "text") {
          if (!part.content.trim()) continue;
          await this.deps.delivery.sendSegment(
            part.content,
            isFirstTextPart ? boundary : undefined,
            textConfig,
            typingConfig,
            context,
            state,
            partDeliveryOptions,
          );
          isFirstTextPart = false;
          if (partDeliveryOptions) {
            partDeliveryOptions = {
              ...partDeliveryOptions,
              accumulatedTextPrefix: undefined,
            };
          }
          continue;
        }

        await this.deps.delivery.sendRenderedMarkdownTable(
          part.content,
          part.table.source,
          textConfig,
          typingConfig,
          context,
          state,
          partDeliveryOptions,
        );
        isFirstTextPart = false;
        if (partDeliveryOptions) {
          partDeliveryOptions = {
            ...partDeliveryOptions,
            accumulatedTextPrefix: undefined,
          };
        }
      }
    }

    if (shouldClearActiveRenderModifier) {
      state.activeRenderModifier = undefined;
    }

    if (shouldStopForSpeakerGuard) {
      this.deps.requestStop(context.channel.id, "speaker_guard");
    }
  }

  /**
   * Diagnostic probe for sprite/render-modifier labels that leak into Discord as literal text.
   *
   * A successful `parseLeadingRenderModifier` always strips the label from the segment, so a
   * label visible in the delivered message proves the parse returned null. This logs every
   * input that decision depends on, letting a leaked label be attributed to exactly one of:
   *
   * - `isInsideCodeBlock` / `isUserImpersonation` vetoing render modifiers outright.
   * - A name mismatch: the label's speaker name is absent from the allowlist built from
   *    `botName` + `botNameAliases`.
   * - Anchor loss: text (notably re-attached orphan punctuation) sits ahead of the label,
   *    so the `^\s*`-anchored pattern cannot reach it.
   *
   * Fires only when the strict parse failed AND the segment still looks like it carried a
   * decorated label, so ordinary prose never triggers it.
   *
   */
  private logUnparsedRenderModifierLabel(args: {
    renderModifierMatch: boolean;
    canUseRenderModifier: boolean;
    orphanPrefixApplied: string | undefined;
    rawSegment: string;
    workingSegment: string;
    context: StreamContext;
    state: StreamState;
    textConfig: TextProcessingConfig;
    renderModifierSourceNames: readonly string[];
    renderModifierChainSourceNames: readonly string[];
  }): void {
    if (args.context.holdResponseText) return;
    // Only interesting when the strict parser declined text that still looks like a label.
    if (args.renderModifierMatch) return;
    const labelHead = args.workingSegment.slice(0, RENDER_MODIFIER_DIAGNOSTIC_HEAD_CHARS);
    if (!SUSPECTED_RENDER_MODIFIER_LABEL_RE.test(labelHead)) return;

    // Echo raw vs working separately so an orphan-punctuation splice is visible as a diff.
    log.warn(
      `Stream RenderModifier Diagnostic: leading label not parsed in channel ${args.context.channel.id}. ` +
        `canUseRenderModifier=${args.canUseRenderModifier} ` +
        `isInsideCodeBlock=${args.state.isInsideCodeBlock} ` +
        `isUserImpersonation=${isUserImpersonationStreamContext(args.context)} ` +
        `isAlter=${args.context.tomoriState.is_alter} ` +
        `personaNickname=${JSON.stringify(args.context.tomoriState.persona_nickname)} ` +
        `botName=${JSON.stringify(args.textConfig.botName)} ` +
        `sourceNames=${JSON.stringify(args.renderModifierSourceNames)} ` +
        `chainSourceNames=${JSON.stringify(args.renderModifierChainSourceNames)} ` +
        `orphanPrefixApplied=${JSON.stringify(args.orphanPrefixApplied ?? null)} ` +
        `rawSegmentHead=${JSON.stringify(args.rawSegment.slice(0, RENDER_MODIFIER_DIAGNOSTIC_HEAD_CHARS))} ` +
        `workingSegmentHead=${JSON.stringify(labelHead)}`,
    );
  }

  /**
   * Diagnostic probe for the silent-drop branch: the model emitted a well-formed
   * "Name (modifier):" label, the parser accepted it and stripped it, but neither a sprite
   * nor a copied identity resolved. The message then ships under the default identity with
   * no sprite and no trace: visually identical to the model never having tried.
   *
   * Logs the persona the sprite lookup was performed against alongside that persona's actual
   * sprite keys, which distinguishes the two candidate causes:
   *
   * - Wrong persona: `personaId` is not the persona the model was told to speak as, so its sprite
   *   keys can never match (the failure mode expected on queued/chained turns).
   * - Right persona, unknown label: the model invented a sprite key, or the sprite exists
   *    but its avatar is unusable (`resolveSpriteIdentity` returning null).
   *
   * @param modifier - The modifier text the model used, e.g. "mad"
   * @param spriteStatus - Whether the sprite lookup matched before identity resolution
   * @param context - Active stream context (supplies the persona used for the lookup)
   */
  private async logUnresolvedRenderModifierTarget(
    modifier: string,
    spriteStatus: SpriteRenderModifierResolution["status"],
    context: StreamContext,
  ): Promise<void> {
    if (context.holdResponseText) return;
    const personaId = context.tomoriState.persona_id;
    // Read back the sprite roster actually visible to the lookup; a cache miss here is
    //    itself a finding, so failures degrade to an explicit marker rather than throwing.
    let availableSpriteKeys: string[] | "lookup_failed" = "lookup_failed";
    if (typeof personaId === "number") {
      availableSpriteKeys = await getCachedPersonaSprites(personaId)
        .then((sprites) => sprites.map((sprite) => sprite.sprite_key))
        .catch(() => "lookup_failed" as const);
    }

    log.warn(
      `Stream RenderModifier Diagnostic: label parsed but no render target resolved in channel ${context.channel.id}. ` +
        `modifier=${JSON.stringify(modifier)} ` +
        `normalizedSpriteKey=${JSON.stringify(normalizePersonaSpriteKey(modifier))} ` +
        `spriteStatus=${spriteStatus} ` +
        `personaId=${personaId ?? "null"} ` +
        `personaNickname=${JSON.stringify(context.tomoriState.persona_nickname)} ` +
        `isAlter=${context.tomoriState.is_alter} ` +
        `availableSpriteKeys=${JSON.stringify(availableSpriteKeys)}`,
    );
  }

  /**
   * Returns the sprite identity with its webhook username chosen to avoid Discord's
   * consecutive-message grouping collapsing different sprites under one avatar.
   *
   * Discord groups webhook messages by `webhook_id` + `username` (ignoring the
   * per-message avatar) and strips zero-width/blank characters from usernames, so
   * two adjacent sprites need names that differ in a character Discord keeps. The
   * "true" half of the parity uses the lookalike-letter variant from
   * {@link toGroupBreakName}, which reads as the clean name; only a name with no
   * swappable letter (kana, hanzi, very short words) falls back to the visible
   * `Persona (sprite)` suffix. A parity toggle flipped on each sprite change guarantees
   * that adjacent different-sprite messages alternate and therefore never match;
   * same-sprite runs keep an identical username and still group naturally.
   *
   * The alternation is tracked per CHANNEL, not per stream. Discord's grouping spans turns,
   * so bookkeeping held in `StreamState` was reset at every turn boundary and let a queued
   * turn's first sprite collide with the previous turn's last sprite. That per-turn reset also
   * used to stand in for adjacency, which is now tested directly via the channel's last message
   * id, so the suffix no longer appears after someone else has already broken the group.
   * See {@link advanceChannelSpriteGroupParity}.
   */
  private resolveSpriteGroupBreakIdentity(
    identity: ResolvedWebhookIdentity,
    fallbackDecoratedUsername: string,
    spriteKey: string,
    channelId: string,
    channelLastMessageId: string | null,
  ): ResolvedWebhookIdentity {
    if (!advanceChannelSpriteGroupParity(channelId, spriteKey, channelLastMessageId)) {
      return identity;
    }
    const groupBreakName = identity.username ? toGroupBreakName(identity.username) : null;
    return { ...identity, username: groupBreakName ?? fallbackDecoratedUsername };
  }

  /**
   * An alter leaving a non-identity sprite sends its base messages through the webhook under the
   * same clean username the sprite used, so Discord would group the reverted line under the
   * sprite's avatar. The base appearance then joins the channel's sprite alternation under its own
   * key, and on the decorated half it is delivered as "Persona (neutral)". That state is returned
   * so later base lines keep the same name.
   */
  private resolveBaseAppearanceRevert(
    previous: NonNullable<StreamState["activeRenderModifier"]>,
    context: StreamContext,
    textConfig: TextProcessingConfig,
  ): StreamState["activeRenderModifier"] {
    if (context.holdResponseText) return undefined;
    if (previous.isNeutralAppearance) return previous;

    const sourceDisplayName = context.tomoriState.persona_nickname || textConfig.botName;
    const baseUsername = context.personaUsername;
    const sharesSpriteUsername =
      Boolean(context.webhook) &&
      baseUsername === sourceDisplayName &&
      previous.spriteRecord !== undefined &&
      !previous.spriteRecord.isIdentity;
    if (!sharesSpriteUsername) return undefined;

    const baseIdentity: ResolvedWebhookIdentity = {
      username: baseUsername,
      avatarUrl: context.personaAvatarUrl,
      avatarDataUri: context.personaAvatarUrl?.startsWith("data:image/") ? context.personaAvatarUrl : undefined,
    };
    const identity = this.resolveSpriteGroupBreakIdentity(
      baseIdentity,
      formatRenderModifierWebhookName(sourceDisplayName, NEUTRAL_APPEARANCE_MODIFIER),
      NEUTRAL_APPEARANCE_GROUP_KEY,
      context.channel.id,
      context.channel.lastMessageId,
    );
    return identity === baseIdentity ? undefined : { identity, isNeutralAppearance: true };
  }

  /**
   * Detects a leaked speaker label at the start of a response segment: a label the
   * render-modifier parse already refused (its source name is not the active persona/aliases).
   *
   * Firing rules, per shape:
   * 1. Decorated "Name (modifier):": always a leak. The parenthetical grammar belongs
   *    exclusively to the active persona (sprites, copied identities), so ANY other name using
   *    it is the model cross-breeding history label formats ("Chris (smug): ...").
   * 2. Plain "Name:": a leak only when Name is a known conversation participant (another
   *    persona or a user in the conversation). Ordinary prose openings ("Note:", "TL;DR:")
   *    never match a participant and pass through untouched.
   *
   * A leading chain of the persona's own plain labels ("Tomori: Chris (smug): hi") is peeled
   * before deciding, since those are stripped later by cleanLLMOutput anyway.
   *
   * @returns The leaked-label match (body = text after the label), or null when clean
   */
  private async matchLeadingSpeakerLeak(
    segment: string,
    context: StreamContext,
    allowedSourceNames: readonly string[],
  ): Promise<LeadingGenericSpeakerLabelMatch | null> {
    // Peel allowed plain self-labels ("Tomori:") so a leak hiding behind them is still seen.
    let working = segment;
    let match = parseLeadingGenericSpeakerLabel(working);
    while (match && !match.modifier && matchesRenderModifierName(match.sourceName, allowedSourceNames)) {
      working = match.body;
      match = parseLeadingGenericSpeakerLabel(working);
    }
    if (!match) return null;

    // A decorated label with an allowed source name is upstream's business (the render-modifier
    //    parse consumes it, including failed sprite resolutions), so never treat it as a leak here.
    if (matchesRenderModifierName(match.sourceName, allowedSourceNames)) return null;

    // Decorated + disallowed name: unambiguous leak.
    if (match.modifier) return match;

    // Plain label: only a leak when the name belongs to a known conversation participant.
    const knownNames = await collectKnownSpeakerNames(context);
    return matchesRenderModifierName(match.sourceName, knownNames) ? match : null;
  }

  public async prepareOutputPrefill(
    context: StreamContext,
    textConfig: TextProcessingConfig,
    state: StreamState,
  ): Promise<void> {
    const rawPrefill = context.outputPrefill?.trim();
    if (!rawPrefill) return;

    const filteredPrefill = filterDuplicateCustomEmojis(rawPrefill, context.contextItems);
    const cleanedPrefill = cleanLLMOutput(
      filteredPrefill,
      textConfig.botName,
      textConfig.emojiStrings,
      textConfig.emojiUsageEnabled,
      textConfig.mentionMap,
      textConfig.mentionIdSet,
      {
        unicodeSpacesEnabled: textConfig.uncensorUnicodeSpacesEnabled,
        sanitizeEnabled: textConfig.uncensorSanitizeEnabled,
      },
      textConfig.botNameAliases,
      textConfig.personaMentionMap,
    );

    const prefillMentionMap = textConfig.mentionMap ?? new Map<string, string[]>();
    const prefillMentionIdSet = textConfig.mentionIdSet ?? new Set<string>();
    textConfig.mentionMap = prefillMentionMap;
    textConfig.mentionIdSet = prefillMentionIdSet;
    const resolvedPrefill = await resolveGuildMentions(
      cleanedPrefill,
      context.channel,
      prefillMentionMap,
      prefillMentionIdSet,
      textConfig.personaMentionMap,
    );
    if (!resolvedPrefill.trim()) return;

    state.prefillTarget = resolvedPrefill;
    state.prefillMatched = 0;
    state.prefillMatchFailed = false;
    state.prefillHeld = "";

    log.info(`Stream Prefill: Prepared output prefill (${resolvedPrefill.length} chars).`);
  }

  public async flushHeldOrphanPunctuation(
    boundary: BufferedDeliveryBoundary,
    textConfig: TextProcessingConfig,
    typingConfig: TypingSimulationConfig,
    context: StreamContext,
    state: StreamState,
  ): Promise<void> {
    if (context.holdResponseText) {
      state.pendingResponseText = (state.pendingResponseText ?? "") + (state.pendingOrphanPunctuation ?? "");
      state.pendingOrphanPunctuation = undefined;
      return;
    }
    const deliveryOptions =
      state.activeRenderModifier && !isUserImpersonationStreamContext(context)
        ? {
            identityOverride: state.activeRenderModifier.identity,
            spriteRecord: state.activeRenderModifier.spriteRecord,
            isNeutralAppearance: state.activeRenderModifier.isNeutralAppearance,
          }
        : undefined;
    await this.deps.delivery.flushHeldOrphanPunctuation(
      boundary,
      textConfig,
      typingConfig,
      context,
      state,
      deliveryOptions,
    );
  }

  private stripPrefillFromSegment(segment: string, state: StreamState): string {
    const target = state.prefillTarget;
    if (!target || state.prefillMatchFailed || state.prefillMatched >= target.length) {
      return segment;
    }

    // The target is trimmed, so whitespace before an echo would otherwise fail the match at index 0.
    let index = state.prefillMatched === 0 ? (segment.match(/^\s*/)?.[0].length ?? 0) : 0;
    while (index < segment.length && state.prefillMatched < target.length) {
      if (segment[index] === target[state.prefillMatched]) {
        state.prefillMatched += 1;
        index += 1;
        continue;
      }
      // Text withheld by an earlier partial match is model output, not an echo, so it is released.
      const released = state.prefillHeld + segment;
      state.prefillHeld = "";
      state.prefillMatchFailed = true;
      state.prefillMatched = target.length;
      return released;
    }

    if (state.prefillMatched >= target.length) {
      state.prefillHeld = "";
      return segment.slice(index);
    }

    state.prefillHeld += segment;
    return "";
  }

  /**
   * Whether `text` waiting in the stream buffer could no longer be retained as held prose. An
   * unterminated table, code fence or semantic marker can keep the buffer from ever flushing a
   * segment, so the segment ceiling alone cannot bound it.
   */
  public exceedsHeldRetention(text: string, context: StreamContext, state: StreamState): boolean {
    const room = resolveHeldLimit(context).maxBytes - (state.pendingResponseBytes ?? 0);
    // A UTF-16 code unit encodes to 1-3 UTF-8 bytes, which skips the byte count for short buffers.
    if (text.length * 3 <= room) return false;
    return text.length > room || Buffer.byteLength(text, "utf8") > room;
  }

  /**
   * Records a flushed segment for replay within the turn's held-prose ceiling, cutting it at the
   * ceiling when it does not fit.
   *
   * @returns The text to normalize, or null once collection has stopped.
   */
  private retainHeldSegment(
    segment: string,
    boundary: BufferedDeliveryBoundary | undefined,
    context: StreamContext,
    state: StreamState,
  ): string | null {
    if (state.pendingResponseTruncation) return null;
    const limit = resolveHeldLimit(context);
    state.pendingResponseSegments ??= [];
    if (state.pendingResponseSegments.length >= limit.maxSegments) {
      this.truncateHeldCollection("retention_limit", context, state);
      return null;
    }
    const usedBytes = state.pendingResponseBytes ?? 0;
    let retained = segment;
    let bytes = Buffer.byteLength(segment, "utf8");
    if (usedBytes + bytes > limit.maxBytes) {
      retained = sliceToUtf8Bytes(segment, Math.max(0, limit.maxBytes - usedBytes));
      bytes = Buffer.byteLength(retained, "utf8");
      this.truncateHeldCollection("retention_limit", context, state);
      if (!retained) return null;
    }
    state.pendingResponseBytes = usedBytes + bytes;
    state.pendingResponseSegments.push({ text: retained, boundary, codeBlock: state.isInsideCodeBlock });
    return retained;
  }

  private truncateHeldCollection(
    truncation: PendingResponseTruncation,
    context: StreamContext,
    state: StreamState,
  ): void {
    state.pendingResponseTruncation = truncation;
    log.warn(
      `Stream: Held response stopped at its ${truncation} (${state.pendingResponseBytes ?? 0} bytes, ${state.pendingResponseSegments?.length ?? 0} segments)`,
    );
    this.deps.requestStop(context.channel.id, "pending_response_limit");
  }
}

function resolveHeldLimit(context: StreamContext): PendingResponseLimit {
  return (
    context.pendingResponseLimit ?? {
      maxBytes: MAX_PENDING_RESPONSE_BYTES,
      maxSegments: MAX_PENDING_RESPONSE_SEGMENTS,
    }
  );
}

/**
 * The longest held text one replay could send, using the same caps `StreamUiUpdater` applies to
 * each delivery. Text past this length can never reach Discord, so collecting it only spends
 * generation and memory. Each pass replays with fresh counters, so the length applies per pass.
 */
function resolveDeliverableHeldLength(
  context: StreamContext,
): { chars: number; truncation: PendingResponseTruncation } | null {
  const sendMessageLimit = context.tomoriState.config.send_message_limit ?? 0;
  const operatorLimited = sendMessageLimit > 0 && sendMessageLimit <= STREAMING_LIMITS.MAX_FLUSH_COUNT;
  const messages = operatorLimited ? sendMessageLimit : STREAMING_LIMITS.MAX_FLUSH_COUNT;
  if (!Number.isFinite(messages)) return null;
  return {
    chars: messages * DISCORD_STREAMING_CONSTANTS.MAX_SINGLE_MESSAGE_LENGTH,
    truncation: operatorLimited ? "send_message_limit" : "flush_limit",
  };
}

/** `encodeInto` writes only whole code points, so `read` never splits a character. */
function sliceToUtf8Bytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  return text.slice(0, new TextEncoder().encodeInto(text, new Uint8Array(maxBytes)).read);
}

/** Only sentence and overflow flushes cut mid-line. */
function segmentEndsLine(segment: string, boundary: BufferedDeliveryBoundary | undefined): boolean {
  if (/\n[ \t]*$/u.test(segment)) return true;
  return boundary !== "period" && boundary !== "overflow";
}

function collectRenderModifierChainSourceNames(
  textConfig: TextProcessingConfig,
  activeSourceNames: readonly string[],
): string[] {
  const knownPersonaLabels: string[] = [];
  if (textConfig.personaMentionMap) {
    for (const [alias, trigger] of textConfig.personaMentionMap) {
      knownPersonaLabels.push(alias, trigger);
    }
  }

  return collectRenderModifierSourceNames(textConfig.botName, [...activeSourceNames, ...knownPersonaLabels]);
}
