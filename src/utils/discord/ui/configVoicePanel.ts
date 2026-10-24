import { commandRegistry } from "@/utils/discord/commandRegistry";
import {
  ButtonStyle,
  ComponentType,
  type ActionRowData,
  type ButtonComponentData,
  type ComponentInContainerData,
  type SelectMenuComponentOptionData,
  type StringSelectMenuComponentData,
  type TextDisplayComponentData,
} from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import type { PanelReadStatus } from "@/types/discord/panel";
import type { ConfigActor } from "@/utils/discord/interactions/configPermissionPolicy";
import type { ConfigPersonaVoiceView } from "@/utils/discord/interactions/configPersonaVoiceLoader";
import {
  buildConfigRouteId,
  buildConfigRouteSegments,
  CONFIG_ROUTE_NAMESPACE,
  CONFIG_ROUTE_VERSION,
} from "@/utils/discord/configPanelCatalog";
import { buildOptionalThumbnailSection, buildStateControlRow, buildPaginationRow } from "@/utils/discord/ui/panel";
import { resolveRangeSelection } from "@/utils/discord/interactions/panelController";
import { DISCORD_SELECT_OPTIONS_MAX } from "@/utils/discord/ui/componentsV2Limits";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import { localizer } from "@/utils/text/localizer";
import { renderFencedPreview } from "@/utils/text/textPreview";

const CONFIG_PERSONA_VOICE_PAGE_SIZE = DISCORD_SELECT_OPTIONS_MAX;

/**
 * The route layer owns remote catalog fetching. The renderer receives only bounded labels and
 * fingerprints, so an external provider ID can never become a component value by accident.
 */
interface ConfigPersonaVoiceRemoteOptionView {
  label: string;
  fingerprint?: string;
  selected?: boolean;
}

const VOICE_PRIORITY_KEYS: Record<TomoriState["voice_source_priority"], string> = {
  design: "commands.config.panel.voice_priority_design",
  clone: "commands.config.panel.voice_priority_clone",
};

export interface ConfigPersonaVoiceRemoteView {
  /** `voices` is the normal name; `options` keeps fixture views easy to adapt from catalog APIs. */
  voices?: readonly ConfigPersonaVoiceRemoteOptionView[];
  options?: readonly ConfigPersonaVoiceRemoteOptionView[];
  catalogFingerprint?: string;
  selectedVoiceLabel?: string;
  pageStart?: number;
}

export type ConfigPersonaVoiceRenderView = ConfigPersonaVoiceView & {
  remoteChooser?: ConfigPersonaVoiceRemoteView;
};

export interface ConfigVoicePanelInput {
  locale: string;
  actor: ConfigActor;
  readStatus: PanelReadStatus;
  selectedPersona: TomoriState | null;
  selectedPersonaAvatarUrl?: string | null;
  view?: ConfigPersonaVoiceRenderView;
  remoteView?: ConfigPersonaVoiceRemoteView;
  samplePageStart?: number;
  remotePageStart?: number;
}

function selectedPersonaId(input: ConfigVoicePanelInput): number | null {
  const personaId = input.selectedPersona?.persona_id;
  return typeof personaId === "number" && Number.isSafeInteger(personaId) && personaId > 0 ? personaId : null;
}

function buildVoiceRoute(
  input: ConfigVoicePanelInput,
  route:
    | { action: "voice-select"; personaId: number }
    | { action: "voice-page"; personaId: number; start: number }
    | { action: "voice-provider-clear"; personaId: number }
    | { action: "voice-design-open"; personaId: number }
    | { action: "voice-design-remove"; personaId: number },
): string {
  return buildConfigRouteId({ locale: input.locale, ...route });
}

function currentVoiceLabel(input: ConfigVoicePanelInput, view: ConfigPersonaVoiceView): string {
  const persona = input.selectedPersona;
  if (!persona) return localizer(input.locale, "commands.config.panel.voice_page_unassigned");

  if (
    view.capability.apiStyle !== "elevenlabs" &&
    persona.speech_voice_sample_id !== null &&
    persona.speech_voice_sample_id !== undefined
  ) {
    const sample = view.samples.find((candidate) => candidate.sample_id === persona.speech_voice_sample_id);
    return localizer(input.locale, "commands.config.panel.voice_page_sample_value", {
      name: sample?.name ?? localizer(input.locale, "commands.config.panel.voice_page_unknown_sample"),
    });
  }

  if (view.capability.apiStyle === "elevenlabs" && persona.speech_voice_id) {
    return localizer(input.locale, "commands.config.panel.voice_page_provider_value", {
      name:
        input.remoteView?.selectedVoiceLabel ??
        input.view?.remoteChooser?.selectedVoiceLabel ??
        localizer(input.locale, "commands.config.panel.voice_page_named_voice"),
    });
  }

  return localizer(input.locale, "commands.config.panel.voice_page_unassigned");
}

function voicePageSize(input: ConfigVoicePanelInput): number {
  const hasSelection =
    input.view?.capability.apiStyle === "elevenlabs"
      ? Boolean(input.selectedPersona?.speech_voice_id?.trim())
      : input.selectedPersona?.speech_voice_sample_id != null;
  return CONFIG_PERSONA_VOICE_PAGE_SIZE - Number(hasSelection);
}

function resolveSamplePage(
  input: ConfigVoicePanelInput,
  samplesLength: number,
  requestedStart: number | undefined,
): number {
  const pageSize = voicePageSize(input);
  const requestedPage = Number.isFinite(requestedStart) ? Math.floor((requestedStart ?? 0) / pageSize) : 0;
  const pageCount = Math.max(1, Math.ceil(samplesLength / pageSize));
  return Math.min(Math.max(requestedPage, 0), pageCount - 1) * pageSize;
}

function buildVoicePagination(
  input: ConfigVoicePanelInput,
  count: number,
  start: number,
): ActionRowData<ButtonComponentData> | null {
  return buildPaginationRow({
    locale: input.locale,
    rangeIndex: start / voicePageSize(input),
    rangeCount: Math.ceil(count / voicePageSize(input)),
    namespace: CONFIG_ROUTE_NAMESPACE,
    version: CONFIG_ROUTE_VERSION,
    disabled: input.readStatus !== "fresh" || !input.actor.isManager,
    buildSegments: {
      page: (page) =>
        buildConfigRouteSegments({
          action: "voice-page",
          locale: input.locale,
          personaId: selectedPersonaId(input) ?? 0,
          start: page * voicePageSize(input),
        }),
    },
  });
}

function buildSampleSelector(input: ConfigVoicePanelInput, view: ConfigPersonaVoiceView): ComponentInContainerData {
  const personaId = selectedPersonaId(input) ?? 0;
  const samples = view.samples;
  const start = resolveSamplePage(input, samples.length, input.samplePageStart);
  const options: SelectMenuComponentOptionData[] =
    input.selectedPersona?.speech_voice_sample_id != null
      ? [{ label: localizer(input.locale, "commands.config.panel.none_label"), value: "none:reference" }]
      : [];
  const visibleSamples = resolveRangeSelection(samples, start / voicePageSize(input), {
    reservedOptions: options.length,
  }).visibleItems;
  options.push(
    ...visibleSamples.map((sample, offset) => ({
      label: safeSelectOptionText(sample.name, 100),
      value: String(start + offset),
      description: sample.ref_text?.trim()
        ? safeSelectOptionText(sample.ref_text.trim(), 100)
        : sample.duration_ms > 0
          ? `${(sample.duration_ms / 1000).toFixed(1)}s`
          : undefined,
      default: sample.sample_id === input.selectedPersona?.speech_voice_sample_id,
    })),
  );

  if (options.length === 0) {
    options.push({
      label: safeSelectOptionText(localizer(input.locale, "commands.config.panel.voice_page_no_samples_option"), 100),
      value: "none",
      description: undefined,
      default: false,
    });
  }

  return {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.StringSelect,
        customId: buildVoiceRoute(input, { action: "voice-select", personaId }),
        placeholder: safeSelectOptionText(
          localizer(input.locale, "commands.config.panel.voice_page_sample_placeholder"),
          150,
        ),
        options,
        disabled:
          input.readStatus !== "fresh" ||
          !input.actor.isManager ||
          (samples.length === 0 && input.selectedPersona?.speech_voice_sample_id == null),
      },
    ],
  } satisfies ActionRowData<StringSelectMenuComponentData>;
}

function buildVoiceActionRow(
  input: ConfigVoicePanelInput,
  personaId: number,
  options: {
    chooseProvider?: boolean;
    cancelChooser?: boolean;
    includeDesign?: boolean;
    chooseProviderDisabled?: boolean;
  } = {},
): ActionRowData<ButtonComponentData> | null {
  const prompt = input.selectedPersona?.speech_voice_design_prompt?.trim();
  const disabled = input.readStatus !== "fresh" || !input.actor.isManager;
  const buttons: ButtonComponentData[] = [];

  if (options.chooseProvider || options.cancelChooser) {
    buttons.push({
      type: ComponentType.Button,
      style: ButtonStyle.Secondary,
      customId: options.cancelChooser
        ? buildConfigRouteId({ locale: input.locale, action: "voice-chooser-cancel", personaId })
        : buildVoiceRoute(input, { action: "voice-select", personaId }),
      label: localizer(
        input.locale,
        options.cancelChooser
          ? "commands.config.panel.voice_page_cancel_button"
          : "commands.config.panel.voice_page_choose_provider_button",
      ),
      disabled: disabled || options.chooseProviderDisabled === true,
    });
  }

  if (options.includeDesign) {
    buttons.push(
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        customId: buildVoiceRoute(input, { action: "voice-design-open", personaId }),
        label: localizer(
          input.locale,
          prompt
            ? "commands.config.panel.voice_page_edit_design_button"
            : "commands.config.panel.voice_page_design_button",
        ),
        disabled,
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        customId: buildVoiceRoute(input, { action: "voice-design-remove", personaId }),
        label: localizer(input.locale, "commands.config.panel.voice_page_clear_design_button"),
        disabled: disabled || !prompt,
      },
    );
  }

  if (!options.includeDesign) {
    const clearActions: Array<"voice-provider-clear"> = [];
    if (input.view?.capability.apiStyle !== "elevenlabs" && input.selectedPersona?.speech_voice_id?.trim()) {
      clearActions.push("voice-provider-clear");
    }
    for (const action of clearActions) {
      buttons.push({
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        customId: buildVoiceRoute(input, { action, personaId }),
        label: localizer(input.locale, "commands.config.panel.voice_page_clear_provider_button"),
        disabled,
      });
    }
  }

  return buttons.length === 0
    ? null
    : ({
        type: ComponentType.ActionRow,
        components: buttons,
      } satisfies ActionRowData<ButtonComponentData>);
}

function remoteCatalogOptions(view: ConfigPersonaVoiceRemoteView): readonly ConfigPersonaVoiceRemoteOptionView[] {
  return view.voices ?? view.options ?? [];
}

function boundedFingerprint(value: string | undefined): string {
  const normalized = value?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16);
  return normalized || "catalog";
}

function buildRemoteVoiceValue(position: number, fingerprint: string | undefined): string {
  return `voice:${Math.max(0, Math.floor(position))}:${boundedFingerprint(fingerprint)}`;
}

function applyRemotePageStart(
  view: ConfigPersonaVoiceRemoteView,
  pageStart: number | undefined,
): ConfigPersonaVoiceRemoteView {
  return pageStart === undefined ? view : { ...view, pageStart };
}

function buildRemoteChooser(
  input: ConfigVoicePanelInput,
  view: ConfigPersonaVoiceRemoteView,
): ComponentInContainerData {
  const personaId = selectedPersonaId(input) ?? 0;
  const voices = remoteCatalogOptions(view);
  const start = resolveSamplePage(input, voices.length, view.pageStart);
  const options: SelectMenuComponentOptionData[] = input.selectedPersona?.speech_voice_id?.trim()
    ? [{ label: localizer(input.locale, "commands.config.panel.none_label"), value: "none:provider" }]
    : [];
  const visibleVoices = resolveRangeSelection(voices, start / voicePageSize(input), {
    reservedOptions: options.length,
  }).visibleItems;
  options.push(
    ...visibleVoices.map((voice, offset) => ({
      label: safeSelectOptionText(
        voice.label || localizer(input.locale, "commands.config.voice.elevenlabs.voice_available_description"),
        100,
      ),
      value: buildRemoteVoiceValue(start + offset, voice.fingerprint ?? view.catalogFingerprint),
      default: voice.selected ?? false,
    })),
  );

  if (options.length === 0) {
    options.push({
      label: safeSelectOptionText(localizer(input.locale, "commands.config.panel.voice_page_no_samples_option"), 100),
      value: "none",
      default: false,
    });
  }

  return {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.StringSelect,
        customId: buildVoiceRoute(input, { action: "voice-select", personaId }),
        placeholder: safeSelectOptionText(
          localizer(input.locale, "commands.config.panel.voice_page_choose_provider_button"),
          150,
        ),
        options,
        disabled: input.readStatus !== "fresh" || !input.actor.isManager,
      },
    ],
  } satisfies ActionRowData<StringSelectMenuComponentData>;
}

function pushListControls(
  components: ComponentInContainerData[],
  pagination: ActionRowData<ButtonComponentData> | null,
  notice: string,
  actions: ActionRowData<ButtonComponentData> | null,
): void {
  // A list's action buttons share its page row, because a separate row overflows Discord's 40-component limit on a fully loaded page.
  if (pagination) {
    components.push(
      actions ? { ...pagination, components: [...pagination.components, ...actions.components] } : pagination,
    );
  }
  components.push({ type: ComponentType.TextDisplay, content: notice });
  if (actions && !pagination) components.push(actions);
}

export function buildConfigVoiceBody(input: ConfigVoicePanelInput): ComponentInContainerData[] {
  const view: ConfigPersonaVoiceRenderView = input.view ?? {
    capability: { apiStyle: null, assignable: false, supportsVoiceDesign: false },
    samples: [],
  };
  const personaId = selectedPersonaId(input);
  const components: ComponentInContainerData[] = [];
  const heading: TextDisplayComponentData = {
    type: ComponentType.TextDisplay,
    content: `### ${localizer(input.locale, "commands.config.panel.page_persona_voice")}\n${localizer(input.locale, "commands.config.panel.voice_page_description")}`,
  };
  components.push(buildOptionalThumbnailSection(heading, input.selectedPersonaAvatarUrl));

  if (personaId !== null) {
    const priority = input.selectedPersona?.voice_source_priority ?? "design";
    components.push({
      type: ComponentType.TextDisplay,
      content: `**${localizer(input.locale, "commands.config.panel.voice_priority_title")}**\n${localizer(input.locale, "commands.config.panel.voice_priority_question")}`,
    });
    components.push(
      buildStateControlRow(
        (["design", "clone"] as const).map((mode) => ({
          value: mode,
          customId: buildConfigRouteId({
            locale: input.locale,
            action: mode === "design" ? "voice-priority-design" : "voice-priority-clone",
            personaId,
          }),
          label: localizer(input.locale, VOICE_PRIORITY_KEYS[mode]),
        })),
        priority,
        input.readStatus !== "fresh" || !input.actor.isManager,
      ),
    );
    if (view.effectiveSource)
      components.push({
        type: ComponentType.TextDisplay,
        content: `> ${localizer(
          input.locale,
          view.effectiveSource === priority
            ? "commands.config.panel.voice_priority_effect"
            : view.preferredUnavailableReason === "target"
              ? "commands.config.panel.voice_priority_fallback_target"
              : "commands.config.panel.voice_priority_fallback_input",
          {
            priority: localizer(input.locale, VOICE_PRIORITY_KEYS[priority]),
            source: localizer(input.locale, VOICE_PRIORITY_KEYS[view.effectiveSource]),
            target: view.effectiveTarget ?? localizer(input.locale, "commands.choices.none"),
          },
        )}`,
      });
    const prompt = input.selectedPersona?.speech_voice_design_prompt?.trim();
    components.push({
      type: ComponentType.TextDisplay,
      content: `**${localizer(input.locale, "commands.config.panel.voice_page_design_preview_title")}**\n${
        prompt
          ? renderFencedPreview(input.locale, prompt, {
              actionLabel: localizer(input.locale, "commands.config.panel.voice_page_edit_design_button"),
            })
          : localizer(input.locale, "commands.config.panel.voice_page_unassigned")
      }`,
    });
    const designActions = buildVoiceActionRow(input, personaId, { includeDesign: true });
    if (designActions) components.push(designActions);
  }
  components.push({
    type: ComponentType.TextDisplay,
    content: `**${localizer(input.locale, "commands.config.panel.voice_priority_clone")}**\n> ${currentVoiceLabel(input, view)}`,
  });
  if (view.capability.apiStyle === "elevenlabs") {
    const remoteView = input.remoteView ?? view.remoteChooser;
    let pagination: ActionRowData<ButtonComponentData> | null = null;
    if (remoteView) {
      const visibleView = applyRemotePageStart(remoteView, input.remotePageStart);
      components.push(buildRemoteChooser(input, visibleView));
      pagination = buildVoicePagination(
        input,
        remoteCatalogOptions(visibleView).length,
        resolveSamplePage(input, remoteCatalogOptions(visibleView).length, visibleView.pageStart),
      );
    }
    pushListControls(
      components,
      pagination,
      `> ${localizer(input.locale, "commands.config.panel.voice_page_provider_notice")}`,
      personaId === null
        ? null
        : buildVoiceActionRow(input, personaId, { chooseProvider: !remoteView, cancelChooser: Boolean(remoteView) }),
    );
  } else {
    components.push(buildSampleSelector(input, view));
    pushListControls(
      components,
      buildVoicePagination(
        input,
        view.samples.length,
        resolveSamplePage(input, view.samples.length, input.samplePageStart),
      ),
      `> ${localizer(input.locale, "commands.config.panel.voice_page_reference_notice", {
        page: localizer(input.locale, "commands.config.panel.page_models_voices"),
      })}`,
      personaId === null ? null : buildVoiceActionRow(input, personaId),
    );
  }
  if (!view.effectiveSource) {
    components.push({
      type: ComponentType.TextDisplay,
      content: `**${localizer(input.locale, "commands.config.panel.capability_notice_title")}**\n${localizer(
        input.locale,
        view.hasTargets
          ? "commands.config.panel.voice_page_no_usable_source"
          : "commands.config.panel.voice_page_no_model_notice",
        {
          models: `${commandRegistry.getCommandMention("config")} > ${localizer(input.locale, "commands.config.panel.category_models")}`,
        },
      )}`,
    });
  }
  return components;
}
