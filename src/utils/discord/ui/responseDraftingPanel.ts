import { ButtonStyle, ComponentType, type ButtonComponentData, type ComponentInContainerData } from "discord.js";
import { RESPONSE_REVIEWER_PROMPT_MAX_LENGTH, type TomoriState } from "@/types/db/schema";
import { CONFIG_MODEL_PAGE_SIZE, buildConfigRouteId, type DraftModelSlot } from "@/utils/discord/configPanelCatalog";
import { buildStateControlRow } from "@/utils/discord/ui/panel";
import { buildModelRoutingControl, buildProviderPageEntries } from "@/utils/discord/ui/modelRoutingControls";
import { buildProviderSelectWindow, resolveProviderEntryStart } from "@/utils/discord/ui/providerSelectWindow";
import {
  encodeConfigProviderPageValue,
  encodeConfigProviderRangeValue,
} from "@/utils/discord/interactions/configModelLoaders";
import {
  checkerFingerprint,
  effectiveReviewerPrompt,
  type ResponseDraftingView,
  type DraftModelGroup,
} from "@/utils/discord/interactions/responseDraftingOperations";
import { buildConfigModalFieldId } from "@/utils/discord/ui/configModals";
import { buildConfigModelSelectModal } from "@/utils/discord/ui/configModelModals";
import type { RawModalPayload } from "@/utils/discord/ui/configModals";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { localizer } from "@/utils/text/localizer";
import { renderFencedPreview } from "@/utils/text/textPreview";

export type DraftPicker =
  | { slot: DraftModelSlot; provider: string | null; start: number }
  | { slot: "checker"; start: number };
export const DRAFT_CLEAR_VALUE = "__none__";
/** None and the advance entry reserve two of Discord's 25 options. */
export const DRAFT_CHECKER_PAGE_SIZE = 23;

export function buildDraftPromptModal(state: TomoriState, locale: string, nonce: string): RawModalPayload {
  return {
    custom_id: buildConfigRouteId({ action: "draft-prompt-submit", locale, nonce }),
    title: localizer(locale, "commands.config.drafting.prompt_title"),
    components: [
      {
        type: 18,
        label: localizer(locale, "commands.config.drafting.prompt_label"),
        description: localizer(locale, "commands.config.drafting.prompt_guidance"),
        component: {
          type: 4,
          custom_id: buildConfigModalFieldId("draft_prompt", nonce),
          style: 2,
          required: true,
          min_length: 1,
          max_length: RESPONSE_REVIEWER_PROMPT_MAX_LENGTH,
          value: effectiveReviewerPrompt(state, locale),
        },
      },
    ],
  };
}

export function buildDraftModelModal(
  state: TomoriState,
  locale: string,
  nonce: string,
  slot: DraftModelSlot,
  group: DraftModelGroup,
  start: number,
): RawModalPayload {
  const payload = buildConfigModelSelectModal(
    locale,
    "text",
    group.provider,
    nonce,
    group.models.slice(start, start + CONFIG_MODEL_PAGE_SIZE),
    slot === "reviewer" ? state.config.response_reviewer_llm_id : state.config.response_decision_model_id,
  );
  payload.custom_id = buildConfigRouteId({
    action: "draft-model-submit",
    locale,
    nonce,
    slot,
    provider: group.provider,
  });
  payload.title = localizer(
    locale,
    slot === "reviewer" ? "commands.config.drafting.reviewer_button" : "commands.config.drafting.decision_button",
  );
  return payload;
}

export function buildResponseDraftingBody(
  state: TomoriState,
  locale: string,
  view: ResponseDraftingView | undefined,
  picker: DraftPicker | undefined,
  disabled: boolean,
): ComponentInContainerData[] {
  const t = (key: string, vars: Record<string, string> = {}) => localizer(locale, key, vars);
  const text = (content: string): ComponentInContainerData => ({ type: ComponentType.TextDisplay, content });
  const button = (
    label: string,
    route: Parameters<typeof buildConfigRouteId>[0],
    danger = false,
  ): ButtonComponentData => ({
    type: ComponentType.Button as const,
    style: danger ? ButtonStyle.Danger : ButtonStyle.Secondary,
    label,
    customId: buildConfigRouteId(route),
    disabled,
  });
  const modelLabel = (slot: DraftModelSlot): string => {
    const id = slot === "reviewer" ? state.config.response_reviewer_llm_id : state.config.response_decision_model_id;
    if (id === null)
      return slot === "reviewer"
        ? `${safeSelectOptionText(state.llm.llm_codename, 150)} (${getProviderDisplayName(state.llm.llm_provider)})${view?.inheritedReviewerAvailable ? "" : `: ${t("commands.config.drafting.unavailable")}`}`
        : t("commands.config.drafting.none");
    for (const group of slot === "reviewer" ? (view?.reviewers ?? []) : (view?.decisions ?? [])) {
      const model = group.models.find((candidate) => candidate.id === id);
      if (model) return safeSelectOptionText(`${model.name} (${getProviderDisplayName(group.provider)})`, 180);
    }
    return t("commands.config.drafting.unavailable");
  };
  const components: ComponentInContainerData[] = [
    text(`## ${t("commands.config.drafting.title")}\n${t("commands.config.drafting.description")}`),
    buildStateControlRow(
      [
        {
          value: false,
          label: t("commands.config.panel.off_button"),
          customId: buildConfigRouteId({ action: "draft-set", locale, enabled: false }),
        },
        {
          value: true,
          label: t("commands.config.panel.on_button"),
          customId: buildConfigRouteId({ action: "draft-set", locale, enabled: true }),
        },
      ],
      state.config.response_drafting_enabled,
      disabled,
    ),
    text(
      `> ${t(state.config.response_drafting_enabled ? "commands.config.drafting.on" : "commands.config.drafting.off")}`,
    ),
    text(`### ${t("commands.config.drafting.models_title")}\n${t("commands.config.drafting.models_description")}`),
  ];
  for (const slot of ["reviewer", "decision"] as const) {
    if (!view) break;
    const slotPicker = picker?.slot === slot ? picker : { provider: null, start: 0 };
    const groups = slot === "reviewer" ? view.reviewers : view.decisions;
    const expanded = groups.find((group) => group.provider === slotPicker.provider);
    const capabilityLabel = t(
      slot === "reviewer" ? "commands.config.drafting.reviewer_label" : "commands.config.drafting.decision_label",
    );
    const pages = buildProviderPageEntries({
      providers: groups.map((group) => group.provider),
      expandedProvider: slotPicker.provider,
      expandedOptionCount: expanded?.models.length ?? 0,
      pageSize: CONFIG_MODEL_PAGE_SIZE,
      locale,
      pageLabelKey: "commands.config.panel.provider_page_label",
      encodeProviderValue: (provider) => provider,
      encodePageValue: encodeConfigProviderPageValue,
    });
    const window = buildProviderSelectWindow({
      entries: pages.entries,
      entryStart: slotPicker.provider
        ? resolveProviderEntryStart(slotPicker.start, pages.expandedStartIndex)
        : slotPicker.start,
      directLimit: 24,
      expandedProvider: slotPicker.provider,
      expandedPageCount: pages.expandedPageCount,
      locale,
      capabilityLabel,
      pagePlaceholderKey: "commands.config.panel.model_provider_page_placeholder",
      encodeAdvanceValue: encodeConfigProviderRangeValue,
    });
    components.push(
      buildModelRoutingControl({
        capabilityLabel,
        activeModelName: null,
        activeProvider: null,
        providerEntries: [...window.visibleEntries, ...(window.advanceEntry ? [window.advanceEntry] : [])],
        customId: buildConfigRouteId({ action: "draft-provider", locale, slot }),
        serverDefaultValue: DRAFT_CLEAR_VALUE,
        serverDefaultLabel: t(
          slot === "reviewer" ? "commands.config.drafting.inherit" : "commands.config.drafting.none",
        ),
        serverDefaultDisplay: modelLabel(slot),
        placeholderOverride:
          window.placeholderOverride ??
          t(
            slot === "decision"
              ? "commands.config.drafting.decision_status"
              : state.config.response_reviewer_llm_id === null
                ? "commands.config.drafting.inherited_status"
                : "commands.config.drafting.reviewer_status",
            { model: modelLabel(slot) },
          ),
        disabled,
      }),
    );
  }
  components.push(text(`> ${t("commands.config.drafting.decision_note")}`));
  const binding = state.config.response_rule_checker_ref;
  const checker = binding
    ? view?.checkers.find((choice) => JSON.stringify(choice.reference) === JSON.stringify(binding))
    : null;
  components.push(
    text(`### ${t("commands.config.drafting.rules_title")}\n${t("commands.config.drafting.rules_description")}`),
  );
  if (view) {
    const choices = view.checkers;
    const requestedStart = picker?.slot === "checker" ? picker.start : 0;
    const start = Math.min(
      Math.floor(requestedStart / DRAFT_CHECKER_PAGE_SIZE) * DRAFT_CHECKER_PAGE_SIZE,
      Math.max(0, Math.floor((choices.length - 1) / DRAFT_CHECKER_PAGE_SIZE) * DRAFT_CHECKER_PAGE_SIZE),
    );
    components.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          customId: buildConfigRouteId({
            action: "draft-checker-select",
            locale,
            start,
            fp: checkerFingerprint(choices),
          }),
          placeholder: safeSelectOptionText(
            t("commands.config.drafting.checker_status", {
              checker: binding
                ? checker
                  ? checker.label
                  : t("commands.config.drafting.unavailable")
                : t("commands.config.drafting.none"),
            }),
            150,
          ),
          options: [
            { label: t("commands.config.drafting.none"), value: DRAFT_CLEAR_VALUE },
            ...choices.slice(start, start + DRAFT_CHECKER_PAGE_SIZE).map((choice, index) => ({
              label: safeSelectOptionText(choice.label, 100),
              value: String(start + index),
            })),
            ...(choices.length > DRAFT_CHECKER_PAGE_SIZE
              ? [
                  {
                    label: t("general.pagination.next"),
                    value: `page|${start + DRAFT_CHECKER_PAGE_SIZE < choices.length ? start + DRAFT_CHECKER_PAGE_SIZE : 0}`,
                  },
                ]
              : []),
          ],
          disabled,
        },
      ],
    });
  }
  const preview = renderFencedPreview(locale, effectiveReviewerPrompt(state, locale), {
    actionLabel: t("commands.config.drafting.prompt_button"),
  });
  components.push(
    text(
      `### ${t("commands.config.drafting.prompt_title")}\n${t("commands.config.drafting.prompt_description")}\n${preview}`,
    ),
    {
      type: ComponentType.ActionRow,
      components: [
        button(t("commands.config.drafting.prompt_button"), { action: "draft-prompt-open", locale }),
        {
          ...button(t("commands.config.drafting.default_button"), { action: "draft-default", locale }, true),
          disabled: disabled || state.config.response_reviewer_prompt === null,
        },
      ],
    },
  );
  return components;
}
