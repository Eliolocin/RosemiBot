import { beforeAll, describe, expect, it } from "bun:test";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { buildConfigRouteId } from "@/utils/discord/configPanelCatalog";
import {
  missingScopeMessageKey,
  type ConfigRouteDependencies,
  type ConfigScope,
} from "@/utils/discord/interactions/configRouteContext";
import { createConfigInteractionRoute, executeConfigCommand } from "@/utils/discord/interactions/configRoutes";
import { InteractionRouteRegistry } from "@/utils/discord/interactions/routeRegistry";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy } from "../../helpers/localeCases";
import { createRouteInteraction, type RouteInteraction } from "../../helpers/routeInteraction";

beforeAll(async () => initializeLocalizer());

const CLIENT = {} as Client;

function outdatedPanelCopy(): string {
  return localizedCopy("en-US", "commands.config.panel.outdated_panel", { command: "/config" });
}
const GUILD_ID = "guild-1";
const USER_ID = "user-1";

/**
 * The two workspace reads a `/config` miss can come from. No entry is a workspace that really has no
 * personas, which is the setup gap; a recorded failure is the transient read that must not be
 * reported as one.
 */
const NO_RECORDED_FAILURE = () => null;
const RECORDED_FAILURE = () => ({ message: "connection retired", timestamp: Date.now() });

function makeState(): TomoriState {
  return {
    server_id: 9,
    persona_id: 55,
    persona_nickname: "Mirri",
    is_alter: false,
    trigger_words: [],
    naming_config: { prefixes: {}, suffixes: {}, addressTerms: {} },
    attribute_list: [],
    sample_dialogues_in: [],
    sample_dialogues_out: [],
    llm: { llm_id: 1, llm_codename: "gemini-2.5-flash", llm_provider: "google", sees_images: true, has_tools: true },
    vision_llm: null,
    fallback_chain: [],
    config: { llm_id: 1, vision_llm_id: null, embedding_model_id: null, imagegen_enabled: true },
  } as unknown as TomoriState;
}

function makeScope(): ConfigScope {
  return {
    serverDiscId: GUILD_ID,
    guildId: GUILD_ID,
    internalServerId: 9,
    userId: 1,
    actor: { workspaceKind: "guild", isManager: true },
    personas: [makeState()],
    readStatus: "fresh",
  };
}

interface Harness {
  /** The single interaction this harness drives; it also owns the recording arrays read below. */
  interaction: RouteInteraction;
  dependencies: Partial<ConfigRouteDependencies>;
  readonly replies: unknown[];
  readonly edits: unknown[];
}

function makeHarness(options: { customId: string; kind?: "button" | "modal" }): Harness {
  const interaction = createRouteInteraction({
    customId: options.customId,
    guildId: GUILD_ID,
    kind: options.kind,
  });

  return {
    interaction,
    dependencies: {
      createNonce: () => "nonce1234567",
      showModal: async () => undefined,
      takeSelectValue: () => "general",
    },
    // Read through to the interaction so exactly one object owns each payload list.
    get edits() {
      return interaction.edits;
    },
    get replies() {
      return interaction.replies;
    },
  };
}

async function dispatch(harness: Harness): Promise<void> {
  const registry = new InteractionRouteRegistry([createConfigInteractionRoute(harness.dependencies)]);
  await registry.dispatch(CLIENT, harness.interaction as never);
}

function contentOf(payload: unknown): string {
  return JSON.stringify(payload);
}

function renameOpenRoute(personaId: number): string {
  return buildConfigRouteId({ action: "rename-open", locale: "en-US", personaId });
}

describe("config scope failure copy", () => {
  it("names the setup gap when the workspace read simply found nothing", () => {
    const key = missingScopeMessageKey(
      { guildId: GUILD_ID, user: { id: USER_ID } },
      { getLastDbError: NO_RECORDED_FAILURE },
    );

    expect(key).toBe("commands.config.panel.not_setup");
  });

  it("names the DM setup gap when the workspace read found nothing in a DM context", () => {
    const key = missingScopeMessageKey(
      { guildId: null, user: { id: USER_ID } },
      { getLastDbError: NO_RECORDED_FAILURE },
    );

    expect(key).toBe("commands.config.panel.not_setup_dm");
  });

  it("reports a transient read instead of a setup gap when a failure was recorded", () => {
    const key = missingScopeMessageKey(
      { guildId: GUILD_ID, user: { id: USER_ID } },
      { getLastDbError: RECORDED_FAILURE },
    );

    expect(key).toBe("commands.config.panel.unavailable");
  });

  it("keys the lookup to the DM workspace when the interaction has no guild", () => {
    const seen: string[] = [];

    missingScopeMessageKey(
      { guildId: null, user: { id: USER_ID } },
      {
        getLastDbError: (serverDiscId) => {
          seen.push(serverDiscId);
          return null;
        },
      },
    );

    expect(seen).toEqual([USER_ID]);
  });

  it("tells an admin to run /setup from the bare command when nothing was recorded", async () => {
    const harness = makeHarness({ customId: "config" });

    await executeConfigCommand(harness.interaction as unknown as ChatInputCommandInteraction, "en-US", {
      resolveScope: async () => null,
      getLastDbError: NO_RECORDED_FAILURE,
    });

    expect(contentOf(harness.edits[0])).toContain(localizedCopy("en-US", "commands.config.panel.not_setup"));
  });

  it("offers a retry rather than /setup when the workspace read failed", async () => {
    const harness = makeHarness({ customId: "config" });

    await executeConfigCommand(harness.interaction as unknown as ChatInputCommandInteraction, "en-US", {
      resolveScope: async () => null,
      getLastDbError: RECORDED_FAILURE,
    });

    const rendered = contentOf(harness.edits[0]);
    expect(rendered).toContain(localizedCopy("en-US", "commands.config.panel.unavailable"));
    expect(rendered).not.toContain("/setup");
  });

  it("routes a panel button on an unset-up workspace to the setup instruction", async () => {
    const harness = makeHarness({ customId: renameOpenRoute(55) });
    harness.dependencies.resolveScope = async () => null;
    harness.dependencies.getLastDbError = NO_RECORDED_FAILURE;

    await dispatch(harness);

    expect(contentOf(harness.replies[0])).toContain(localizedCopy("en-US", "commands.config.panel.not_setup"));
  });

  it("routes a panel button on a failed read to the transient copy", async () => {
    const harness = makeHarness({ customId: renameOpenRoute(55) });
    harness.dependencies.resolveScope = async () => null;
    harness.dependencies.getLastDbError = RECORDED_FAILURE;

    await dispatch(harness);

    expect(contentOf(harness.replies[0])).toContain(localizedCopy("en-US", "commands.config.panel.unavailable"));
  });

  it("sends a write whose persona is gone to a re-run of /config, not to /setup", async () => {
    const harness = makeHarness({ customId: renameOpenRoute(999) });
    harness.dependencies.resolveScope = async () => makeScope();
    harness.dependencies.getLastDbError = NO_RECORDED_FAILURE;

    await dispatch(harness);

    const rendered = contentOf(harness.replies[0]);
    expect(rendered).toContain(outdatedPanelCopy());
    expect(rendered).not.toContain("/setup");
  });

  it("never claims a setup gap when a resolved scope carries no persona (MCP add)", async () => {
    const harness = makeHarness({
      customId: buildConfigRouteId({ action: "mcp-add-submit", locale: "en-US", nonce: "nonce1234567" }),
      kind: "modal",
    });
    harness.dependencies.resolveScope = async () => ({ ...makeScope(), personas: [] });
    harness.dependencies.getLastDbError = NO_RECORDED_FAILURE;

    await dispatch(harness);

    const rendered = contentOf(harness.edits.at(-1));
    expect(rendered).toContain(outdatedPanelCopy());
    expect(rendered).not.toContain("/setup");
  });

  it("never claims a setup gap when a resolved scope carries no persona (permissions modal open)", async () => {
    const harness = makeHarness({
      customId: buildConfigRouteId({
        action: "permissions-manage-open",
        locale: "en-US",
        page: "available-tools",
      }),
    });
    harness.dependencies.resolveScope = async () => ({ ...makeScope(), personas: [] });
    harness.dependencies.getLastDbError = NO_RECORDED_FAILURE;

    await dispatch(harness);

    expect(contentOf(harness.replies[0])).toContain(outdatedPanelCopy());
    expect(contentOf(harness.replies[0])).not.toContain("/setup");
  });

  it("still reports the setup gap when that same handler has no scope at all", async () => {
    const harness = makeHarness({
      customId: buildConfigRouteId({
        action: "permissions-manage-open",
        locale: "en-US",
        page: "available-tools",
      }),
    });
    harness.dependencies.resolveScope = async () => null;
    harness.dependencies.getLastDbError = NO_RECORDED_FAILURE;

    await dispatch(harness);

    expect(contentOf(harness.replies[0])).toContain(localizedCopy("en-US", "commands.config.panel.not_setup"));
  });
});
