import { createHash } from "node:crypto";
import { MAX_VOICE_DESIGN_PROMPT_LENGTH } from "@/constants/speech";
import { MessageFlags, TextInputStyle, type ModalSubmitInteraction } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import type { ElevenLabsVoiceCatalogEntry } from "@/utils/audio/elevenLabsVoiceCatalog";
import { buildConfigModalFieldId, type RawModalPayload } from "@/utils/discord/ui/configModals";
import { isConfigRouteAuthorized, type ConfigActor } from "@/utils/discord/interactions/configPermissionPolicy";
import {
  repaint,
  staleReceipt,
  missingScopeMessageKey,
  type ConfigRouteDependencies,
  type ConfigScope,
} from "@/utils/discord/interactions/configRouteContext";
import type { ConfigPersonaVoiceRemoteView } from "@/utils/discord/ui/configVoicePanel";
import { buildConfigRouteId, type ConfigPanelRoute } from "@/utils/discord/configPanelCatalog";
import type { GlobalRoutableInteraction } from "@/utils/discord/interactions/routeRegistry";
import { buildTextPreview } from "@/utils/text/textPreview";
import { localizer } from "@/utils/text/localizer";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import { DISCORD_SELECT_OPTIONS_MAX } from "@/utils/discord/ui/componentsV2Limits";

const VOICE_DESIGN_PROMPT_FIELD = "voice_design_prompt";
const VOICE_PAGE_SIZE = DISCORD_SELECT_OPTIONS_MAX;

export const CONFIG_PERSONA_VOICE_MODAL_OPEN_ACTIONS = new Set<ConfigPanelRoute["action"]>(["voice-design-open"]);

const CONFIG_PERSONA_VOICE_ACTIONS = new Set<ConfigPanelRoute["action"]>([
  "voice-priority-design",
  "voice-priority-clone",
  "voice-select",
  "voice-page",
  "voice-chooser-cancel",
  "voice-provider-clear",
  "voice-design-open",
  "voice-design-submit",
  "voice-design-remove",
]);

export interface ConfigPersonaVoiceRouteContext {
  interaction: GlobalRoutableInteraction;
  route: ConfigPanelRoute;
  scope: ConfigScope;
  dependencies: ConfigRouteDependencies;
}

type ActiveVoiceMode = { apiStyle: "tts-clone" } | { apiStyle: "elevenlabs"; apiKey: string };

function receipt(
  locale: string,
  tone: "success" | "warning" | "error" | "info",
  headingKey: string,
  detailKey: string,
  vars: Record<string, string | number> = {},
) {
  return {
    tone,
    heading: localizer(locale, headingKey),
    detail: localizer(locale, detailKey, vars),
  } as const;
}

function exactPersona(scope: ConfigScope, personaId: number): TomoriState | null {
  return scope.personas.find((persona) => persona.persona_id === personaId) ?? null;
}

async function freshPersona(
  context: ConfigPersonaVoiceRouteContext,
): Promise<{ scope: ConfigScope; persona: TomoriState } | null> {
  const scope = (await context.dependencies.resolveScope(context.interaction, true)) ?? null;
  if (!scope) return null;
  const personaId = "personaId" in context.route ? context.route.personaId : null;
  const persona = typeof personaId !== "number" ? null : exactPersona(scope, personaId);
  return persona ? { scope, persona } : null;
}

async function resolveActiveVoiceMode(
  persona: TomoriState,
  dependencies: ConfigRouteDependencies,
): Promise<ActiveVoiceMode> {
  const endpoint = await dependencies.resolveActiveSpeechEndpoint(persona.server_id, "clone");
  return endpoint?.endpoint?.api_style === "elevenlabs" && endpoint.apiKey.trim()
    ? { apiStyle: "elevenlabs", apiKey: endpoint.apiKey }
    : { apiStyle: "tts-clone" };
}

function buildVoiceDesignModal(
  locale: string,
  personaId: number,
  nonce: string,
  existingPrompt: string | null | undefined,
): RawModalPayload {
  return {
    custom_id: buildConfigRouteId({ action: "voice-design-submit", locale, personaId, nonce }),
    title: safeSelectOptionText(localizer(locale, "commands.config.panel.voice_design.modal_title"), 45),
    components: [
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.config.panel.voice_design.prompt_label"), 45),
        description: safeSelectOptionText(localizer(locale, "commands.config.panel.voice_design.prompt_help"), 100),
        component: {
          type: 4,
          custom_id: buildConfigModalFieldId(VOICE_DESIGN_PROMPT_FIELD, nonce),
          style: TextInputStyle.Paragraph,
          placeholder: safeSelectOptionText(
            localizer(locale, "commands.config.panel.voice_design.prompt_placeholder"),
            100,
          ),
          max_length: MAX_VOICE_DESIGN_PROMPT_LENGTH,
          required: true,
          value: existingPrompt?.trim().slice(0, MAX_VOICE_DESIGN_PROMPT_LENGTH) || undefined,
        },
      },
    ],
  };
}

function catalogEntryFingerprint(entry: ElevenLabsVoiceCatalogEntry): string {
  const labels = Object.fromEntries(Object.entries(entry.labels).sort(([left], [right]) => left.localeCompare(right)));
  return createHash("sha256")
    .update(
      JSON.stringify({
        voiceId: entry.voiceId,
        name: entry.name,
        category: entry.category,
        description: entry.description,
        previewUrl: entry.previewUrl,
        labels,
      }),
    )
    .digest("base64url")
    .slice(0, 16);
}

function safeRemoteVoiceLabel(voice: ElevenLabsVoiceCatalogEntry): string {
  const name = voice.name.trim();
  const voiceId = voice.voiceId.trim();
  return name && (!voiceId || !name.includes(voiceId)) ? name : "";
}

function localizedRemoteVoiceLabel(locale: string, voice: ElevenLabsVoiceCatalogEntry): string {
  return (
    safeRemoteVoiceLabel(voice) || localizer(locale, "commands.config.voice.elevenlabs.voice_available_description")
  );
}

function catalogFingerprint(voices: readonly ElevenLabsVoiceCatalogEntry[]): string {
  return createHash("sha256")
    .update(voices.map((voice) => catalogEntryFingerprint(voice)).join("\n"))
    .digest("base64url")
    .slice(0, 16);
}

export function buildConfigPersonaVoiceRemoteView(
  locale: string,
  voices: readonly ElevenLabsVoiceCatalogEntry[],
  pageStart = 0,
  selectedVoiceId?: string | null,
): ConfigPersonaVoiceRemoteView {
  const selectedVoice = voices.find((voice) => voice.voiceId === selectedVoiceId);
  return {
    voices: voices.map((voice) => ({
      label: localizedRemoteVoiceLabel(locale, voice),
      fingerprint: catalogEntryFingerprint(voice),
      selected: voice.voiceId === selectedVoiceId,
    })),
    catalogFingerprint: catalogFingerprint(voices),
    selectedVoiceLabel: selectedVoice ? localizedRemoteVoiceLabel(locale, selectedVoice) : undefined,
    pageStart,
  };
}

function parseVoiceSelection(
  value: string | null,
): { kind: "sample"; index: number } | { kind: "remote"; index: number; fingerprint: string } | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const index = Number(value);
    return Number.isSafeInteger(index) ? { kind: "sample", index } : null;
  }

  const remote = /^voice:(\d+):([A-Za-z0-9_-]{1,16})$/.exec(value);
  if (remote) {
    const index = Number(remote[1]);
    return Number.isSafeInteger(index) ? { kind: "remote", index, fingerprint: remote[2] } : null;
  }

  return null;
}

function isValidVoicePageStart(start: number, catalogLength: number, hasSelection: boolean): boolean {
  if (!Number.isSafeInteger(start) || start < 0) return false;
  const pageSize = VOICE_PAGE_SIZE - Number(hasSelection);
  const pageCount = Math.max(1, Math.ceil(catalogLength / pageSize));
  const lastPageStart = (pageCount - 1) * pageSize;
  return start <= lastPageStart && start % pageSize === 0;
}

async function loadRemoteCatalog(
  persona: TomoriState,
  dependencies: ConfigRouteDependencies,
  locale: string,
): Promise<{ voices: ElevenLabsVoiceCatalogEntry[]; view: ConfigPersonaVoiceRemoteView } | null> {
  const mode = await resolveActiveVoiceMode(persona, dependencies);
  if (mode.apiStyle !== "elevenlabs") return null;
  const result = await dependencies.fetchElevenLabsVoiceCatalog(mode.apiKey);
  if (!result.success || !result.voices?.length) return null;
  const voices = [...result.voices].sort((left, right) => left.name.localeCompare(right.name, "en"));
  return { voices, view: buildConfigPersonaVoiceRemoteView(locale, voices, 0, persona.speech_voice_id) };
}

async function repaintVoice(
  context: ConfigPersonaVoiceRouteContext,
  scope: ConfigScope,
  personaId: number | null,
  options: {
    receipt?: ReturnType<typeof receipt>;
    remoteView?: ConfigPersonaVoiceRemoteView;
    personaVoicePageStart?: number;
  } = {},
): Promise<void> {
  await repaint(context.interaction, {
    locale: context.route.locale,
    scope,
    category: "persona",
    page: "voice",
    selectedPersonaId: personaId,
    personaVoiceRemoteView: options.remoteView,
    personaVoicePageStart: options.personaVoicePageStart,
    receipt: options.receipt,
    dependencies: context.dependencies,
  });
}

async function rejectModalRoute(
  interaction: GlobalRoutableInteraction,
  locale: string,
  contentKey: string,
): Promise<void> {
  await interaction.reply({
    content: localizer(locale, contentKey),
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleConfigPersonaVoiceModalOpen(
  interaction: GlobalRoutableInteraction,
  route: ConfigPanelRoute,
  dependencies: ConfigRouteDependencies,
  actor: ConfigActor,
): Promise<boolean> {
  if (!CONFIG_PERSONA_VOICE_MODAL_OPEN_ACTIONS.has(route.action)) return false;
  if (!isConfigRouteAuthorized(route, actor)) {
    await rejectModalRoute(interaction, route.locale, "commands.config.panel.denied_detail");
    return true;
  }

  const scope = await dependencies.resolveScope(interaction, false);
  if (!scope) {
    await rejectModalRoute(interaction, route.locale, missingScopeMessageKey(interaction, dependencies));
    return true;
  }
  const personaId = "personaId" in route ? route.personaId : null;
  const persona = typeof personaId === "number" ? exactPersona(scope, personaId) : null;
  if (!persona) {
    await rejectModalRoute(interaction, route.locale, "commands.config.panel.stale_detail");
    return true;
  }
  if (!isConfigRouteAuthorized(route, scope.actor)) {
    await rejectModalRoute(interaction, route.locale, "commands.config.panel.denied_detail");
    return true;
  }

  await dependencies.showModal(
    interaction,
    buildVoiceDesignModal(
      route.locale,
      persona.persona_id as number,
      dependencies.createNonce(),
      persona.speech_voice_design_prompt,
    ),
  );
  return true;
}

async function handleVoiceSelection(
  context: ConfigPersonaVoiceRouteContext,
  initialScope: ConfigScope,
  submittedValue: string | null,
): Promise<void> {
  const current = await freshPersona(context);
  if (!current) {
    await repaintVoice(context, initialScope, null, { receipt: staleReceipt(context.route.locale) });
    return;
  }
  if (!isConfigRouteAuthorized(context.route, current.scope.actor)) {
    await repaintVoice(context, current.scope, current.persona.persona_id ?? null, {
      receipt: {
        tone: "error",
        heading: localizer(context.route.locale, "commands.config.panel.denied_heading"),
        detail: localizer(context.route.locale, "commands.config.panel.denied_detail"),
      },
    });
    return;
  }
  const scope = current.scope;
  const persona = current.persona;
  const mode = await resolveActiveVoiceMode(persona, context.dependencies);

  if (mode.apiStyle === "tts-clone") {
    const parsed = parseVoiceSelection(submittedValue);
    const samples = await context.dependencies.loadVoiceSamples(persona.server_id);
    if (!parsed || parsed.kind === "remote") {
      await repaintVoice(context, scope, persona.persona_id ?? null, { receipt: staleReceipt(context.route.locale) });
      return;
    }
    const sample = samples[parsed.index];
    if (!sample || sample.sample_id === undefined) {
      await repaintVoice(context, scope, persona.persona_id ?? null, { receipt: staleReceipt(context.route.locale) });
      return;
    }
    const writeMode = await resolveActiveVoiceMode(persona, context.dependencies);
    if (writeMode.apiStyle !== "tts-clone") {
      await repaintVoice(context, scope, persona.persona_id ?? null, { receipt: staleReceipt(context.route.locale) });
      return;
    }
    const updated = await context.dependencies.setPersonaVoiceConfig(persona.persona_id as number, {
      speech_voice_sample_id: sample.sample_id,
      speech_voice_id: persona.speech_voice_id ?? null,
      speech_voice_name: sample.name,
      speech_voice_design_prompt: persona.speech_voice_design_prompt ?? null,
      voice_source_priority: persona.voice_source_priority,
    });
    if (!updated) {
      await repaintVoice(context, scope, persona.persona_id ?? null, {
        receipt: receipt(
          context.route.locale,
          "error",
          "commands.config.panel.write_failed_heading",
          "commands.config.panel.write_failed_detail",
        ),
      });
      return;
    }
    context.dependencies.invalidatePersonaVoiceCache(scope.serverDiscId);
    const refreshedScope = (await context.dependencies.resolveScope(context.interaction, true)) ?? scope;
    await repaintVoice(context, refreshedScope, persona.persona_id ?? null, {
      receipt: receipt(
        context.route.locale,
        "success",
        "commands.config.panel.voice_assign.success_title",
        "commands.config.panel.voice_assign.success_description",
        { persona: persona.persona_nickname, voice: sample.name },
      ),
    });
    return;
  }

  const remote = await loadRemoteCatalog(persona, context.dependencies, context.route.locale);
  if (!remote) {
    await repaintVoice(context, scope, persona.persona_id ?? null, {
      receipt: receipt(
        context.route.locale,
        "error",
        "commands.config.panel.voice_assign.elevenlabs_voice_fetch_failed_title",
        "commands.config.panel.voice_assign.elevenlabs_voice_fetch_failed_description",
      ),
    });
    return;
  }

  const parsed = parseVoiceSelection(submittedValue);
  if (!parsed) {
    await repaintVoice(context, scope, persona.persona_id ?? null, { remoteView: remote.view });
    return;
  }
  if (parsed.kind !== "remote") {
    await repaintVoice(context, scope, persona.persona_id ?? null, {
      remoteView: remote.view,
      receipt: staleReceipt(context.route.locale),
    });
    return;
  }

  const chosenVoice = remote.voices[parsed.index];
  if (!chosenVoice || catalogEntryFingerprint(chosenVoice) !== parsed.fingerprint) {
    await repaintVoice(context, scope, persona.persona_id ?? null, {
      remoteView: remote.view,
      receipt: staleReceipt(context.route.locale),
    });
    return;
  }

  const writeMode = await resolveActiveVoiceMode(persona, context.dependencies);
  if (writeMode.apiStyle !== "elevenlabs") {
    await repaintVoice(context, scope, persona.persona_id ?? null, {
      remoteView: remote.view,
      receipt: staleReceipt(context.route.locale),
    });
    return;
  }

  const updated = await context.dependencies.setPersonaVoiceConfig(persona.persona_id as number, {
    speech_voice_id: chosenVoice.voiceId,
    speech_voice_name: chosenVoice.name ?? (persona.speech_voice_design_prompt?.trim() ? "VoiceDesign" : null),
    speech_voice_sample_id: persona.speech_voice_sample_id ?? null,
    speech_voice_design_prompt: persona.speech_voice_design_prompt ?? null,
    voice_source_priority: persona.voice_source_priority,
  });
  if (!updated) {
    await repaintVoice(context, scope, persona.persona_id ?? null, {
      remoteView: remote.view,
      receipt: receipt(
        context.route.locale,
        "error",
        "commands.config.panel.write_failed_heading",
        "commands.config.panel.write_failed_detail",
      ),
    });
    return;
  }
  context.dependencies.invalidatePersonaVoiceCache(scope.serverDiscId);
  const refreshedScope = (await context.dependencies.resolveScope(context.interaction, true)) ?? scope;
  await repaintVoice(context, refreshedScope, persona.persona_id ?? null, {
    receipt: receipt(
      context.route.locale,
      "success",
      "commands.config.panel.voice_assign.success_title",
      "commands.config.panel.voice_assign.success_description",
      { persona: persona.persona_nickname, voice: localizedRemoteVoiceLabel(context.route.locale, chosenVoice) },
    ),
  });
}

async function handleVoiceClear(context: ConfigPersonaVoiceRouteContext, clearProviderVoice: boolean): Promise<void> {
  const current = await freshPersona(context);
  if (!current) {
    await repaintVoice(context, context.scope, null, { receipt: staleReceipt(context.route.locale) });
    return;
  }
  if (!isConfigRouteAuthorized(context.route, current.scope.actor)) {
    await repaintVoice(context, current.scope, current.persona.persona_id ?? null, {
      receipt: {
        tone: "error",
        heading: localizer(context.route.locale, "commands.config.panel.denied_heading"),
        detail: localizer(context.route.locale, "commands.config.panel.denied_detail"),
      },
    });
    return;
  }
  const updated = await context.dependencies.setPersonaVoiceConfig(current.persona.persona_id as number, {
    speech_voice_sample_id: clearProviderVoice ? (current.persona.speech_voice_sample_id ?? null) : null,
    speech_voice_id: clearProviderVoice ? null : (current.persona.speech_voice_id ?? null),
    speech_voice_name: null,
    speech_voice_design_prompt: current.persona.speech_voice_design_prompt ?? null,
    voice_source_priority: current.persona.voice_source_priority,
  });
  if (!updated) {
    await repaintVoice(context, current.scope, current.persona.persona_id ?? null, {
      receipt: receipt(
        context.route.locale,
        "error",
        "commands.config.panel.write_failed_heading",
        "commands.config.panel.write_failed_detail",
      ),
    });
    return;
  }
  context.dependencies.invalidatePersonaVoiceCache(current.scope.serverDiscId);
  const refreshedScope = (await context.dependencies.resolveScope(context.interaction, true)) ?? current.scope;
  await repaintVoice(context, refreshedScope, current.persona.persona_id ?? null, {
    receipt: receipt(
      context.route.locale,
      "success",
      "commands.config.panel.voice_assign.cleared_title",
      "commands.config.panel.voice_assign.cleared_description",
      { persona: current.persona.persona_nickname },
    ),
  });
}

async function handleVoiceDesignSubmit(context: ConfigPersonaVoiceRouteContext): Promise<void> {
  const current = await freshPersona(context);
  if (!current) {
    await repaintVoice(context, context.scope, null, { receipt: staleReceipt(context.route.locale) });
    return;
  }
  if (!isConfigRouteAuthorized(context.route, current.scope.actor)) {
    await repaintVoice(context, current.scope, current.persona.persona_id ?? null, {
      receipt: {
        tone: "error",
        heading: localizer(context.route.locale, "commands.config.panel.denied_heading"),
        detail: localizer(context.route.locale, "commands.config.panel.denied_detail"),
      },
    });
    return;
  }
  const modal = context.interaction as ModalSubmitInteraction;
  const nonce = "nonce" in context.route ? context.route.nonce : "";
  const prompt = modal.fields.getTextInputValue(buildConfigModalFieldId(VOICE_DESIGN_PROMPT_FIELD, nonce)).trim();
  if (!prompt || prompt.length > MAX_VOICE_DESIGN_PROMPT_LENGTH) {
    await repaintVoice(context, current.scope, current.persona.persona_id ?? null, {
      receipt: receipt(
        context.route.locale,
        "warning",
        "commands.config.panel.voice_design.prompt_required_title",
        "commands.config.panel.voice_design.prompt_required_description",
      ),
    });
    return;
  }

  const updated = await context.dependencies.setPersonaVoiceConfig(current.persona.persona_id as number, {
    speech_voice_sample_id: current.persona.speech_voice_sample_id ?? null,
    speech_voice_id: current.persona.speech_voice_id ?? null,
    speech_voice_design_prompt: prompt,
    voice_source_priority: current.persona.voice_source_priority,
    speech_voice_name: current.persona.speech_voice_name ?? null,
  });
  if (!updated) {
    await repaintVoice(context, current.scope, current.persona.persona_id ?? null, {
      receipt: receipt(
        context.route.locale,
        "error",
        "commands.config.panel.write_failed_heading",
        "commands.config.panel.write_failed_detail",
      ),
    });
    return;
  }
  context.dependencies.invalidatePersonaVoiceCache(current.scope.serverDiscId);
  const refreshedScope = (await context.dependencies.resolveScope(context.interaction, true)) ?? current.scope;
  const preview = buildTextPreview(prompt);
  await repaintVoice(context, refreshedScope, current.persona.persona_id ?? null, {
    receipt: receipt(
      context.route.locale,
      "success",
      "commands.config.panel.voice_design.success_title",
      "commands.config.panel.voice_design.success_description",
      { persona: current.persona.persona_nickname, preview: preview.text },
    ),
  });
}

async function handleVoiceDesignRemove(context: ConfigPersonaVoiceRouteContext): Promise<void> {
  const current = await freshPersona(context);
  if (!current) {
    await repaintVoice(context, context.scope, null, { receipt: staleReceipt(context.route.locale) });
    return;
  }
  if (!isConfigRouteAuthorized(context.route, current.scope.actor)) {
    await repaintVoice(context, current.scope, current.persona.persona_id ?? null, {
      receipt: {
        tone: "error",
        heading: localizer(context.route.locale, "commands.config.panel.denied_heading"),
        detail: localizer(context.route.locale, "commands.config.panel.denied_detail"),
      },
    });
    return;
  }
  if (!current.persona.speech_voice_design_prompt?.trim()) {
    await repaintVoice(context, current.scope, current.persona.persona_id ?? null, {
      receipt: receipt(
        context.route.locale,
        "info",
        "commands.config.panel.voice_design.no_prompt_title",
        "commands.config.panel.voice_design.no_prompt_description",
      ),
    });
    return;
  }

  const updated = await context.dependencies.setPersonaVoiceConfig(current.persona.persona_id as number, {
    speech_voice_sample_id: current.persona.speech_voice_sample_id ?? null,
    speech_voice_id: current.persona.speech_voice_id ?? null,
    speech_voice_design_prompt: null,
    voice_source_priority: current.persona.voice_source_priority,
    speech_voice_name: current.persona.speech_voice_name ?? null,
  });
  if (!updated) {
    await repaintVoice(context, current.scope, current.persona.persona_id ?? null, {
      receipt: receipt(
        context.route.locale,
        "error",
        "commands.config.panel.write_failed_heading",
        "commands.config.panel.write_failed_detail",
      ),
    });
    return;
  }
  context.dependencies.invalidatePersonaVoiceCache(current.scope.serverDiscId);
  const refreshedScope = (await context.dependencies.resolveScope(context.interaction, true)) ?? current.scope;
  const preview = buildTextPreview(current.persona.speech_voice_design_prompt);
  await repaintVoice(context, refreshedScope, current.persona.persona_id ?? null, {
    receipt: receipt(
      context.route.locale,
      "success",
      "commands.config.panel.voice_design.cleared_title",
      "commands.config.panel.voice_design.cleared_description_with_prompt",
      { persona: current.persona.persona_nickname, removed_prompt: preview.text },
    ),
  });
}

export async function handleConfigPersonaVoiceRoutes(context: ConfigPersonaVoiceRouteContext): Promise<boolean> {
  if (!CONFIG_PERSONA_VOICE_ACTIONS.has(context.route.action)) return false;

  if (context.route.action === "voice-design-submit") {
    await handleVoiceDesignSubmit(context);
    return true;
  }
  if (context.route.action === "voice-design-remove") {
    await handleVoiceDesignRemove(context);
    return true;
  }
  if (context.route.action === "voice-provider-clear") {
    await handleVoiceClear(context, true);
    return true;
  }

  const current = await freshPersona(context);
  if (!current) {
    await repaintVoice(context, context.scope, null, { receipt: staleReceipt(context.route.locale) });
    return true;
  }
  if (!isConfigRouteAuthorized(context.route, current.scope.actor)) {
    await repaintVoice(context, current.scope, current.persona.persona_id ?? null, {
      receipt: {
        tone: "error",
        heading: localizer(context.route.locale, "commands.config.panel.denied_heading"),
        detail: localizer(context.route.locale, "commands.config.panel.denied_detail"),
      },
    });
    return true;
  }
  const scope = current.scope;
  const persona = current.persona;

  if (context.route.action === "voice-priority-design" || context.route.action === "voice-priority-clone") {
    const updated = await context.dependencies.setPersonaVoiceConfig(persona.persona_id as number, {
      speech_voice_sample_id: persona.speech_voice_sample_id ?? null,
      speech_voice_id: persona.speech_voice_id ?? null,
      speech_voice_name: persona.speech_voice_name ?? null,
      speech_voice_design_prompt: persona.speech_voice_design_prompt ?? null,
      voice_source_priority: context.route.action === "voice-priority-design" ? "design" : "clone",
    });
    if (updated) context.dependencies.invalidatePersonaVoiceCache(scope.serverDiscId);
    await repaintVoice(
      context,
      (await context.dependencies.resolveScope(context.interaction, true)) ?? scope,
      persona.persona_id ?? null,
      {
        receipt: updated
          ? undefined
          : receipt(
              context.route.locale,
              "error",
              "commands.config.panel.write_failed_heading",
              "commands.config.panel.write_failed_detail",
            ),
      },
    );
    return true;
  }

  if (context.route.action === "voice-chooser-cancel") {
    await repaintVoice(context, scope, persona.persona_id ?? null);
    return true;
  }

  if (context.route.action === "voice-page") {
    const mode = await resolveActiveVoiceMode(persona, context.dependencies);
    if (mode.apiStyle === "elevenlabs") {
      const remote = await loadRemoteCatalog(persona, context.dependencies, context.route.locale);
      if (!remote) {
        await repaintVoice(context, scope, persona.persona_id ?? null, {
          receipt: receipt(
            context.route.locale,
            "error",
            "commands.config.panel.voice_assign.elevenlabs_voice_fetch_failed_title",
            "commands.config.panel.voice_assign.elevenlabs_voice_fetch_failed_description",
          ),
        });
        return true;
      }
      if (!isValidVoicePageStart(context.route.start, remote.voices.length, Boolean(persona.speech_voice_id?.trim()))) {
        await repaintVoice(context, scope, persona.persona_id ?? null, {
          remoteView: remote.view,
          receipt: staleReceipt(context.route.locale),
        });
        return true;
      }
      await repaintVoice(context, scope, persona.persona_id ?? null, {
        remoteView: { ...remote.view, pageStart: context.route.start },
      });
      return true;
    }
    if (mode.apiStyle !== "tts-clone") {
      await repaintVoice(context, scope, persona.persona_id ?? null, {
        receipt: staleReceipt(context.route.locale),
      });
      return true;
    }
    const samples = await context.dependencies.loadVoiceSamples(persona.server_id);
    if (!isValidVoicePageStart(context.route.start, samples.length, persona.speech_voice_sample_id != null)) {
      await repaintVoice(context, scope, persona.persona_id ?? null, {
        personaVoicePageStart: 0,
        receipt: staleReceipt(context.route.locale),
      });
      return true;
    }
    await repaintVoice(context, scope, persona.persona_id ?? null, {
      personaVoicePageStart: context.route.start,
    });
    return true;
  }

  const submittedValue = context.interaction.isStringSelectMenu() ? (context.interaction.values[0] ?? null) : null;
  if (
    context.route.action === "voice-select" &&
    (submittedValue === "none:reference" || submittedValue === "none:provider")
  ) {
    await handleVoiceClear(context, submittedValue === "none:provider");
    return true;
  }
  if (context.route.action === "voice-select" && !submittedValue) {
    const mode = await resolveActiveVoiceMode(persona, context.dependencies);
    if (mode.apiStyle === "elevenlabs") {
      const remote = await loadRemoteCatalog(persona, context.dependencies, context.route.locale);
      if (remote) {
        await repaintVoice(context, scope, persona.persona_id ?? null, { remoteView: remote.view });
        return true;
      }
      await repaintVoice(context, scope, persona.persona_id ?? null, {
        receipt: receipt(
          context.route.locale,
          "error",
          "commands.config.panel.voice_assign.elevenlabs_voice_fetch_failed_title",
          "commands.config.panel.voice_assign.elevenlabs_voice_fetch_failed_description",
        ),
      });
      return true;
    }
  }

  await handleVoiceSelection(context, scope, submittedValue);
  return true;
}
