import { beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { Client } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { personaRepository } from "@/utils/db/repositories";
import { buildConfigPersonaVoiceRemoteView } from "@/utils/discord/interactions/configPersonaVoiceRoutes";
import { createConfigInteractionRoute } from "@/utils/discord/interactions/configRoutes";
import type { ConfigRouteDependencies, ConfigScope } from "@/utils/discord/interactions/configRouteContext";
import { InteractionRouteRegistry } from "@/utils/discord/interactions/routeRegistry";
import { buildConfigRouteId } from "@/utils/discord/configPanelCatalog";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona, type PersonaFixtureOverrides } from "../../helpers/fixtures";
import { createRouteInteraction, type RouteInteraction } from "../../helpers/routeInteraction";

beforeAll(async () => initializeLocalizer());

const CLIENT = {} as Client;

type ConfigInteraction = Parameters<ReturnType<typeof createConfigInteractionRoute>["execute"]>[1];

/** Voice routes address persona 55 on server 9, and the factory default nickname is "Mirri". */
function makePersona(overrides: PersonaFixtureOverrides = {}): TomoriState {
  return createPersona({ persona_id: 55, server_id: 9, ...overrides });
}

function makeEndpoint(apiStyle: "tts-clone" | "elevenlabs", supportsInstruct = false) {
  return {
    endpoint: {
      api_style: apiStyle,
      extra_config: { supports_instruct: supportsInstruct },
    },
    apiKey: "test-key",
  } as never;
}

interface HarnessOptions {
  persona?: TomoriState;
  apiStyle?: "tts-clone" | "elevenlabs";
  supportsInstruct?: boolean;
  isManager?: boolean;
  writeResult?: boolean;
  noEndpoint?: boolean;
  useRepositoryVoiceWriter?: boolean;
  endpointResponses?: Array<{ apiStyle: "tts-clone" | "elevenlabs"; supportsInstruct?: boolean }>;
  voices?: Array<{
    voiceId: string;
    name: string;
    category: string | null;
    description: string | null;
    previewUrl: string | null;
    labels: Record<string, string>;
  }>;
}

function makeHarness(options: HarnessOptions = {}) {
  const persona = options.persona ?? makePersona();
  const events: string[] = [];
  const modals: unknown[] = [];
  const writes: Array<{ personaId: number; voice: Parameters<ConfigRouteDependencies["setPersonaVoiceConfig"]>[1] }> =
    [];
  const invalidations: string[] = [];
  const renderedPersonaIds: Array<number | null> = [];
  const acknowledgedAtFetch: boolean[] = [];
  const acknowledgedAtWrite: boolean[] = [];
  let activeInteraction: RouteInteraction | null = null;
  let endpointCall = 0;
  let refreshedPersonas: TomoriState[] = [persona];
  const voices = options.voices ?? [
    {
      voiceId: "provider-secret-id",
      name: "Harbor",
      category: "premade",
      description: null,
      previewUrl: null,
      labels: {},
    },
  ];

  const scope = (forceRefresh: boolean): ConfigScope => ({
    serverDiscId: "guild-1",
    guildId: "guild-1",
    internalServerId: 9,
    userId: 1,
    actor: { workspaceKind: "guild", isManager: options.isManager ?? true },
    personas: forceRefresh ? refreshedPersonas : [persona],
    readStatus: "fresh",
  });

  const dependencies: Partial<ConfigRouteDependencies> = {
    resolveScope: async (_interaction, forceRefresh = false) => {
      events.push(forceRefresh ? "resolve:fresh" : "resolve");
      return scope(forceRefresh);
    },
    getPersonaAvatarData: async (_interaction, renderedPersona) => {
      renderedPersonaIds.push(renderedPersona.persona_id ?? null);
      return { url: null, files: [] };
    },
    loadPersonaVoiceView: async (_state) => ({
      capability: {
        apiStyle: options.apiStyle ?? "tts-clone",
        assignable: true,
        supportsVoiceDesign: options.supportsInstruct === true,
      },
      samples:
        options.apiStyle === "elevenlabs"
          ? []
          : [{ sample_id: 101, name: "Harbor sample", ref_text: null, duration_ms: 3000 }],
    }),
    resolveActiveSpeechEndpoint: async () => {
      events.push("endpoint");
      if (options.noEndpoint) return null;
      const response = options.endpointResponses?.[endpointCall++];
      return makeEndpoint(
        response?.apiStyle ?? options.apiStyle ?? "tts-clone",
        response?.supportsInstruct ?? options.supportsInstruct,
      );
    },
    fetchElevenLabsVoiceCatalog: async (apiKey) => {
      events.push(`fetch:${apiKey}`);
      acknowledgedAtFetch.push(Boolean(activeInteraction?.deferred || activeInteraction?.replied));
      expect(apiKey).toBe("test-key");
      return { success: true, voices };
    },
    loadVoiceSamples: async () => [
      {
        sample_id: 101,
        server_id: 9,
        name: "Harbor sample",
        file_path: "secret/path",
        ref_text: null,
        duration_ms: 3000,
      },
    ],
    setPersonaVoiceConfig: async (personaId, voice) => {
      events.push("write");
      acknowledgedAtWrite.push(Boolean(activeInteraction?.deferred || activeInteraction?.replied));
      writes.push({ personaId, voice });
      if (options.useRepositoryVoiceWriter) {
        return personaRepository.setVoiceConfig(personaId, voice);
      }
      return options.writeResult ?? true;
    },
    invalidatePersonaVoiceCache: (serverDiscId) => {
      events.push("invalidate");
      invalidations.push(serverDiscId);
    },
    createNonce: () => "nonce1234567",
    showModal: async (_interaction, payload) => {
      events.push("modal");
      modals.push(payload);
    },
  };

  function makeInteraction(
    customId: string,
    kind: "button" | "select" | "modal",
    values: string[] = [],
    fields = {},
  ): RouteInteraction {
    const interaction = createRouteInteraction({
      customId,
      kind: kind === "select" ? "string-select" : kind,
      isManager: options.isManager ?? true,
      values,
      fields,
    });
    activeInteraction = interaction;
    return interaction;
  }

  async function dispatch(customId: string, kind: "button" | "select" | "modal", values: string[] = [], fields = {}) {
    const interaction = makeInteraction(customId, kind, values, fields);
    await new InteractionRouteRegistry([createConfigInteractionRoute(dependencies)]).dispatch(
      CLIENT,
      interaction as unknown as ConfigInteraction,
    );
    return interaction;
  }

  return {
    dependencies,
    dispatch,
    events,
    invalidations,
    acknowledgedAtFetch,
    acknowledgedAtWrite,
    modals,
    refreshedPersona: (next: TomoriState | null) => {
      refreshedPersonas = next ? [next] : [];
    },
    renderedPersonaIds,
    writes,
  };
}

describe("Persona > Voice routes", () => {
  it("saves a description without a target and preserves the independent Clone sources and priority", async () => {
    const harness = makeHarness({
      noEndpoint: true,
      persona: makePersona({
        speech_voice_sample_id: 101,
        speech_voice_id: "provider-id",
        speech_voice_name: "Harbor",
        voice_source_priority: "clone",
      }),
    });
    await harness.dispatch(
      buildConfigRouteId({
        action: "voice-design-submit",
        locale: "en-US",
        personaId: 55,
        nonce: "nonce1234567",
      }),
      "modal",
      [],
      { voice_design_prompt_nonce1234567: "Warm narrator" },
    );
    expect(harness.writes[0]?.voice).toEqual({
      speech_voice_sample_id: 101,
      speech_voice_id: "provider-id",
      speech_voice_name: "Harbor",
      speech_voice_design_prompt: "Warm narrator",
      voice_source_priority: "clone",
    });
    expect(harness.events).not.toContain("endpoint");
    expect(harness.invalidations).toEqual(["guild-1"]);
  });

  it("changes priority without changing saved sources and rejects non-managers", async () => {
    for (const action of ["voice-priority-design", "voice-priority-clone"] as const) {
      const harness = makeHarness({
        persona: makePersona({
          speech_voice_sample_id: 101,
          speech_voice_id: "provider-id",
          speech_voice_design_prompt: "Warm voice",
        }),
      });
      await harness.dispatch(buildConfigRouteId({ action, locale: "en-US", personaId: 55 }), "button");
      expect(harness.writes[0]?.voice).toEqual(
        expect.objectContaining({
          speech_voice_sample_id: 101,
          speech_voice_id: "provider-id",
          speech_voice_design_prompt: "Warm voice",
          voice_source_priority: action === "voice-priority-design" ? "design" : "clone",
        }),
      );
      const denied = makeHarness({ isManager: false });
      await denied.dispatch(buildConfigRouteId({ action, locale: "en-US", personaId: 55 }), "button");
      expect(denied.writes).toHaveLength(0);
    }
  });

  it("acknowledges before loading a clone sample and writes all four voice columns", async () => {
    const harness = makeHarness({
      apiStyle: "tts-clone",
      persona: makePersona({
        speech_voice_id: "provider-id",
        speech_voice_design_prompt: "Existing prompt",
        speech_voice_name: "Old",
      }),
    });
    await harness.dispatch(buildConfigRouteId({ action: "voice-select", locale: "en-US", personaId: 55 }), "select", [
      "0",
    ]);

    // Read as the write runs, so this is the defer-before-write proof rather than a restatement of it.
    expect(harness.acknowledgedAtWrite).toEqual([true]);
    expect(harness.writes).toEqual([
      {
        personaId: 55,
        voice: {
          voice_source_priority: "design",
          speech_voice_sample_id: 101,
          speech_voice_id: "provider-id",
          speech_voice_name: "Harbor sample",
          speech_voice_design_prompt: "Existing prompt",
        },
      },
    ]);
    expect(harness.events.indexOf("write")).toBeLessThan(harness.events.indexOf("invalidate"));
    expect(harness.invalidations).toEqual(["guild-1"]);
  });

  it("acknowledges before fetching and writing a remote voice, then rechecks the endpoint", async () => {
    const voice = {
      voiceId: "provider-secret-id",
      name: "Harbor",
      category: "premade",
      description: null,
      previewUrl: null,
      labels: {},
    };
    const fingerprint = buildConfigPersonaVoiceRemoteView("en-US", [voice]).voices?.[0]?.fingerprint;
    const harness = makeHarness({ apiStyle: "elevenlabs", voices: [voice] });
    await harness.dispatch(buildConfigRouteId({ action: "voice-select", locale: "en-US", personaId: 55 }), "select", [
      `voice:0:${fingerprint}`,
    ]);

    expect(harness.acknowledgedAtFetch).toEqual([true]);
    expect(harness.acknowledgedAtWrite).toEqual([true]);
    expect(harness.events.filter((event) => event === "endpoint")).toHaveLength(3);
    expect(harness.writes[0]).toEqual({
      personaId: 55,
      voice: {
        voice_source_priority: "design",
        speech_voice_id: "provider-secret-id",
        speech_voice_name: "Harbor",
        speech_voice_sample_id: null,
        speech_voice_design_prompt: null,
      },
    });
  });

  it("preserves the clone clear ladder and all four columns", async () => {
    const harness = makeHarness({
      apiStyle: "tts-clone",
      persona: makePersona({
        speech_voice_sample_id: 101,
        speech_voice_id: "stranded-provider-id",
        speech_voice_name: "VoiceDesign",
        speech_voice_design_prompt: "Existing prompt",
      }),
    });
    await harness.dispatch(buildConfigRouteId({ action: "voice-select", locale: "en-US", personaId: 55 }), "select", [
      "none:reference",
    ]);

    expect(harness.writes[0]).toEqual({
      personaId: 55,
      voice: {
        voice_source_priority: "design",
        speech_voice_sample_id: null,
        speech_voice_id: "stranded-provider-id",
        speech_voice_name: null,
        speech_voice_design_prompt: "Existing prompt",
      },
    });
  });

  it("preserves the ElevenLabs clear ladder and all four columns", async () => {
    const harness = makeHarness({
      apiStyle: "elevenlabs",
      persona: makePersona({
        speech_voice_sample_id: 101,
        speech_voice_id: "provider-id",
        speech_voice_name: "Harbor",
        speech_voice_design_prompt: "Existing prompt",
      }),
    });
    await harness.dispatch(
      buildConfigRouteId({ action: "voice-provider-clear", locale: "en-US", personaId: 55 }),
      "button",
    );

    expect(harness.writes[0]).toEqual({
      personaId: 55,
      voice: {
        voice_source_priority: "design",
        speech_voice_sample_id: 101,
        speech_voice_id: null,
        speech_voice_name: null,
        speech_voice_design_prompt: "Existing prompt",
      },
    });
  });

  it("keeps the saved reference sample when an ElevenLabs voice is chosen", async () => {
    const voice = {
      voiceId: "provider-secret-id",
      name: "Harbor",
      category: "premade",
      description: null,
      previewUrl: null,
      labels: {},
    };
    const fingerprint = buildConfigPersonaVoiceRemoteView("en-US", [voice]).voices?.[0]?.fingerprint;
    const harness = makeHarness({
      apiStyle: "elevenlabs",
      voices: [voice],
      persona: makePersona({ speech_voice_sample_id: 101, speech_voice_name: "Harbor sample" }),
    });
    await harness.dispatch(buildConfigRouteId({ action: "voice-select", locale: "en-US", personaId: 55 }), "select", [
      `voice:0:${fingerprint}`,
    ]);

    expect(harness.writes[0]?.voice).toEqual(
      expect.objectContaining({ speech_voice_id: "provider-secret-id", speech_voice_sample_id: 101 }),
    );
  });

  it("clears only the matching source when None is chosen from a voice dropdown", async () => {
    for (const [value, expected] of [
      ["none:reference", { speech_voice_sample_id: null, speech_voice_id: "provider-id" }],
      ["none:provider", { speech_voice_sample_id: 101, speech_voice_id: null }],
    ] as const) {
      const harness = makeHarness({
        apiStyle: value === "none:provider" ? "elevenlabs" : "tts-clone",
        persona: makePersona({
          speech_voice_sample_id: 101,
          speech_voice_id: "provider-id",
          speech_voice_design_prompt: "Existing prompt",
        }),
      });
      await harness.dispatch(buildConfigRouteId({ action: "voice-select", locale: "en-US", personaId: 55 }), "select", [
        value,
      ]);

      expect(harness.writes).toHaveLength(1);
      expect(harness.writes[0]?.voice).toEqual(
        expect.objectContaining({ ...expected, speech_voice_design_prompt: "Existing prompt" }),
      );
      expect(harness.events.indexOf("write")).toBeLessThan(harness.events.indexOf("invalidate"));
    }
  });

  it("clears stored voice state without an endpoint and invalidates after success", async () => {
    const harness = makeHarness({
      noEndpoint: true,
      persona: makePersona({
        speech_voice_sample_id: 101,
        speech_voice_id: "stranded-provider-id",
        speech_voice_name: "VoiceDesign",
        speech_voice_design_prompt: "Existing prompt",
      }),
    });
    await harness.dispatch(buildConfigRouteId({ action: "voice-select", locale: "en-US", personaId: 55 }), "select", [
      "none:reference",
    ]);

    expect(harness.writes).toEqual([
      {
        personaId: 55,
        voice: {
          voice_source_priority: "design",
          speech_voice_sample_id: null,
          speech_voice_id: "stranded-provider-id",
          speech_voice_name: null,
          speech_voice_design_prompt: "Existing prompt",
        },
      },
    ]);
    expect(harness.invalidations).toEqual(["guild-1"]);
    expect(harness.events).not.toContain("endpoint");
  });

  it("clears a legacy provider ID without a Clone target while preserving the sample and description", async () => {
    const harness = makeHarness({
      noEndpoint: true,
      persona: makePersona({
        speech_voice_sample_id: 101,
        speech_voice_id: "legacy-provider-id",
        speech_voice_design_prompt: "Warm narration",
        voice_source_priority: "clone",
      }),
    });
    await harness.dispatch(
      buildConfigRouteId({ action: "voice-provider-clear", locale: "en-US", personaId: 55 }),
      "button",
    );
    expect(harness.writes).toEqual([
      {
        personaId: 55,
        voice: {
          speech_voice_sample_id: 101,
          speech_voice_id: null,
          speech_voice_name: null,
          speech_voice_design_prompt: "Warm narration",
          voice_source_priority: "clone",
        },
      },
    ]);
    expect(harness.invalidations).toEqual(["guild-1"]);
    expect(harness.events.indexOf("write")).toBeLessThan(harness.events.indexOf("invalidate"));
    expect(harness.events).not.toContain("endpoint");
  });

  it("preserves the design-removal ladder and all four columns", async () => {
    const harness = makeHarness({
      apiStyle: "tts-clone",
      supportsInstruct: true,
      persona: makePersona({
        speech_voice_sample_id: 101,
        speech_voice_id: "provider-id",
        speech_voice_name: "VoiceDesign",
        speech_voice_design_prompt: "Existing prompt",
      }),
    });
    await harness.dispatch(
      buildConfigRouteId({ action: "voice-design-remove", locale: "en-US", personaId: 55 }),
      "button",
    );

    expect(harness.writes[0]).toEqual({
      personaId: 55,
      voice: {
        voice_source_priority: "design",
        speech_voice_sample_id: 101,
        speech_voice_id: "provider-id",
        speech_voice_design_prompt: null,
        speech_voice_name: "VoiceDesign",
      },
    });
  });

  it("does not invalidate the voice cache after a failed write", async () => {
    const harness = makeHarness({ apiStyle: "tts-clone", writeResult: false });
    await harness.dispatch(buildConfigRouteId({ action: "voice-select", locale: "en-US", personaId: 55 }), "select", [
      "0",
    ]);

    expect(harness.writes).toHaveLength(1);
    expect(harness.invalidations).toEqual([]);
  });

  it("refuses a remote selection when the endpoint changes before the write", async () => {
    const voice = {
      voiceId: "provider-secret-id",
      name: "Harbor",
      category: "premade",
      description: null,
      previewUrl: null,
      labels: {},
    };
    const fingerprint = buildConfigPersonaVoiceRemoteView("en-US", [voice]).voices?.[0]?.fingerprint;
    const harness = makeHarness({
      apiStyle: "elevenlabs",
      voices: [voice],
      endpointResponses: [{ apiStyle: "elevenlabs" }, { apiStyle: "elevenlabs" }, { apiStyle: "tts-clone" }],
    });
    await harness.dispatch(buildConfigRouteId({ action: "voice-select", locale: "en-US", personaId: 55 }), "select", [
      `voice:0:${fingerprint}`,
    ]);

    expect(harness.writes).toEqual([]);
    expect(harness.invalidations).toEqual([]);
  });

  it("refuses a stale remote fingerprint without exposing the provider ID", async () => {
    const harness = makeHarness({ apiStyle: "elevenlabs" });
    const interaction = await harness.dispatch(
      buildConfigRouteId({ action: "voice-select", locale: "en-US", personaId: 55 }),
      "select",
      ["voice:0:stale"],
    );

    expect(harness.writes).toEqual([]);
    expect(JSON.stringify(interaction.edits)).not.toContain("provider-secret-id");
    expect(harness.events).toContain("fetch:test-key");
  });

  it("opens VoiceDesign as the acknowledgement with a text input component", async () => {
    const harness = makeHarness({ apiStyle: "tts-clone", supportsInstruct: true });
    const interaction = await harness.dispatch(
      buildConfigRouteId({ action: "voice-design-open", locale: "en-US", personaId: 55 }),
      "button",
    );

    // A modal is the acknowledgement here, so the route must not have deferred or replied first.
    expect(interaction.deferred).toBe(false);
    expect(interaction.replied).toBe(false);
    expect(harness.events).toContain("modal");
    const modal = harness.modals[0] as {
      components: Array<{ type?: number; component?: { type?: number } }>;
    };
    expect(modal.components[0]?.type).toBe(18);
    expect(modal.components[0]?.component?.type).toBe(4);
  });

  it("does not write for a guild member through the registered route seam", async () => {
    const harness = makeHarness({ apiStyle: "tts-clone", isManager: false, useRepositoryVoiceWriter: true });
    const repositoryWrite = spyOn(personaRepository, "setVoiceConfig").mockResolvedValue(true);
    try {
      await harness.dispatch(buildConfigRouteId({ action: "voice-select", locale: "en-US", personaId: 55 }), "select", [
        "none:reference",
      ]);
      expect(repositoryWrite).not.toHaveBeenCalled();
      expect(harness.writes).toEqual([]);
    } finally {
      repositoryWrite.mockRestore();
    }
  });

  it("uses the current persona row for a VoiceDesign write", async () => {
    const current = makePersona({
      persona_id: 55,
      speech_voice_sample_id: 11,
      speech_voice_id: "old-provider",
      speech_voice_name: "Old",
      speech_voice_design_prompt: "Old prompt",
    });
    const harness = makeHarness({ apiStyle: "tts-clone", supportsInstruct: true, persona: current });
    const refreshed = makePersona({
      persona_id: 55,
      speech_voice_sample_id: 22,
      speech_voice_id: "new-provider",
      speech_voice_name: "New",
      speech_voice_design_prompt: "New prompt",
    });
    harness.refreshedPersona(refreshed);
    await harness.dispatch(
      buildConfigRouteId({ action: "voice-design-submit", locale: "en-US", personaId: 55, nonce: "nonce1234567" }),
      "modal",
      [],
      { voice_design_prompt_nonce1234567: "Bright, patient narrator" },
    );

    expect(harness.writes[0]).toEqual({
      personaId: 55,
      voice: {
        voice_source_priority: "design",
        speech_voice_sample_id: 22,
        speech_voice_id: "new-provider",
        speech_voice_design_prompt: "Bright, patient narrator",
        speech_voice_name: "New",
      },
    });
  });

  it("does not retarget a removed persona on chooser cancel or page", async () => {
    const cancelHarness = makeHarness({ apiStyle: "tts-clone" });
    cancelHarness.refreshedPersona(null);
    await cancelHarness.dispatch(
      buildConfigRouteId({ action: "voice-chooser-cancel", locale: "en-US", personaId: 55 }),
      "button",
    );
    expect(cancelHarness.renderedPersonaIds).toEqual([]);

    const pageHarness = makeHarness({ apiStyle: "elevenlabs" });
    pageHarness.refreshedPersona(null);
    await pageHarness.dispatch(
      buildConfigRouteId({ action: "voice-page", locale: "en-US", personaId: 55, start: 0 }),
      "button",
    );
    expect(pageHarness.renderedPersonaIds).toEqual([]);
    expect(pageHarness.events).not.toContain("endpoint");
  });

  it("keeps remote option values bounded to fingerprints", () => {
    const view = buildConfigPersonaVoiceRemoteView("en-US", [
      {
        voiceId: "provider-secret-id",
        name: "Harbor",
        category: null,
        description: null,
        previewUrl: null,
        labels: {},
      },
    ]);
    expect(view.voices?.[0]).toMatchObject({ label: "Harbor", fingerprint: expect.any(String) });
    expect(JSON.stringify(view)).not.toContain("provider-secret-id");

    const unnamed = buildConfigPersonaVoiceRemoteView("en-US", [
      {
        voiceId: "provider-secret-id",
        name: "provider-secret-id",
        category: null,
        description: null,
        previewUrl: null,
        labels: {},
      },
    ]);
    expect(unnamed.voices?.[0]?.label).toBeTruthy();
    expect(JSON.stringify(unnamed)).not.toContain("provider-secret-id");
  });
});
