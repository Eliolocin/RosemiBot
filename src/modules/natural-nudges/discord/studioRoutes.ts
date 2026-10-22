import { MessageFlags, type ChatInputCommandInteraction, type ModalSubmitInteraction } from "discord.js";
import type { PanelAction } from "@/constants/panelActions";
import type { TomoriState } from "@/types/db/schema";
import type { PanelReceipt } from "@/types/discord/panel";
import { CUSTOM_IDLE_NUDGE_LIMIT, type NaturalNudgeCategory } from "@/modules/natural-nudges/db/types";
import {
  NUDGE_STUDIO_ROUTE_NAMESPACE,
  NUDGE_STUDIO_ROUTE_VERSION,
  nudgeStudioFieldId,
  parseNudgeStudioRoute,
  type NudgeStudioRoute,
} from "@/modules/natural-nudges/discord/studioCatalog";
import {
  loadNudgeStudioView,
  nudgeStudioOperations,
  type NudgeStudioView,
  type StudioWriteResult,
} from "@/modules/natural-nudges/discord/studioOperations";
import {
  availabilityOptions,
  buildAvailabilityModal,
  buildIdleNudgeFormModal,
  buildNudgeStudioPayload,
  buildNudgeStudioTerminalPayload,
  buildRemovalModal,
  checklistGroupCount,
  NUDGE_STUDIO_ADD_VALUE,
  removalOptions,
} from "@/modules/natural-nudges/discord/studioPanel";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { storeChecklistSnapshot, takeChecklistSnapshot } from "@/utils/discord/interactions/checklistSnapshotStore";
import { beginPanelInteraction } from "@/utils/discord/interactions/panelController";
import type { GlobalInteractionRoute, GlobalRoutableInteraction } from "@/utils/discord/interactions/routeRegistry";
import { createNonce } from "@/utils/discord/panelRouteTokens";
import { deliverGuardedPanel } from "@/utils/discord/ui/interactionCore";
import {
  showRoutedRawModal,
  takeRawModalCheckboxGroupValues,
  takeRawModalStringSelectValues,
} from "@/utils/discord/ui/modals";
import { recordPanelActionStat } from "@/utils/stats/panelActionMetrics";
import { localizer } from "@/utils/text/localizer";

type StudioInteraction = GlobalRoutableInteraction | ChatInputCommandInteraction;

interface StudioScope {
  serverId: number;
  personas: TomoriState[];
}

function isAuthorized(interaction: StudioInteraction): boolean {
  return Boolean(interaction.guildId && (interaction.memberPermissions?.has("ManageGuild") ?? false));
}

async function resolveScope(interaction: StudioInteraction): Promise<StudioScope | null> {
  if (!interaction.guildId) return null;
  const personas = await getCachedAllPersonas(interaction.guildId);
  const serverId = personas[0]?.server_id;
  return serverId ? { serverId, personas } : null;
}

export interface NudgeStudioRouteDependencies {
  isAuthorized: typeof isAuthorized;
  resolveScope: typeof resolveScope;
  loadView: typeof loadNudgeStudioView;
  operations: typeof nudgeStudioOperations;
  showModal: typeof showRoutedRawModal;
  takeCheckboxValues: typeof takeRawModalCheckboxGroupValues;
  takeSelectValues: typeof takeRawModalStringSelectValues;
  storeSnapshot: typeof storeChecklistSnapshot;
  takeSnapshot: typeof takeChecklistSnapshot;
  recordAction: typeof recordPanelActionStat;
  createNonce: typeof createNonce;
}

const defaults: NudgeStudioRouteDependencies = {
  isAuthorized,
  resolveScope,
  loadView: loadNudgeStudioView,
  operations: nudgeStudioOperations,
  showModal: showRoutedRawModal,
  takeCheckboxValues: takeRawModalCheckboxGroupValues,
  takeSelectValues: takeRawModalStringSelectValues,
  storeSnapshot: storeChecklistSnapshot,
  takeSnapshot: takeChecklistSnapshot,
  recordAction: recordPanelActionStat,
  createNonce,
};

const WRITE_ACTIONS: Partial<Record<NudgeStudioRoute["action"], PanelAction>> = {
  "add-submit": "nudge-studio.workspace.idle-nudge.add",
  "edit-submit": "nudge-studio.workspace.idle-nudge.edit",
  "toggle-submit": "nudge-studio.workspace.idle-nudge.set",
  "remove-submit": "nudge-studio.workspace.idle-nudge.remove",
};

function writeReceipt(locale: string, action: NudgeStudioRoute["action"], result: StudioWriteResult): PanelReceipt {
  const t = (key: string) => localizer(locale, key);
  if (result === "success")
    return {
      tone: "success",
      heading: t("commands.nudge-studio.saved_heading"),
      detail: t(
        action === "remove-submit" ? "commands.nudge-studio.removed_detail" : "commands.nudge-studio.saved_detail",
      ),
    };
  if (result === "unchanged")
    return {
      tone: "info",
      heading: t("commands.nudge-studio.unchanged_heading"),
      detail: t("commands.nudge-studio.unchanged_detail"),
    };
  if (result === "stale")
    return {
      tone: "warning",
      heading: t("commands.nudge-studio.stale_heading"),
      detail: t("commands.nudge-studio.stale_detail"),
    };
  return {
    tone: "error",
    heading: t("commands.nudge-studio.write_failed_heading"),
    detail: t(
      result === "invalid"
        ? "commands.nudge-studio.invalid_detail"
        : result === "limit"
          ? "commands.nudge-studio.limit_detail"
          : "commands.nudge-studio.write_failed_detail",
    ),
  };
}

/**
 * Null when no checkbox group reached this submit. Unchecked means off or removed, so reading that
 * absence as "every box cleared" would disable or delete every presented idle nudge.
 */
function checklistValues(
  deps: NudgeStudioRouteDependencies,
  interactionId: string,
  nonce: string,
  presentedCount: number,
): Set<string> | null {
  const checked = new Set<string>();
  let arrived = false;
  for (let group = 0; group < checklistGroupCount(presentedCount); group++) {
    const values = deps.takeCheckboxValues(interactionId, nudgeStudioFieldId("checklist", nonce, group));
    if (values === undefined) continue;
    arrived = true;
    for (const value of values) checked.add(value);
  }
  return arrived ? checked : null;
}

async function reply(interaction: GlobalRoutableInteraction, locale: string, key: string): Promise<void> {
  await interaction.reply({ content: localizer(locale, key), flags: MessageFlags.Ephemeral });
}

function limitReceipt(locale: string): PanelReceipt {
  return {
    tone: "warning",
    heading: localizer(locale, "commands.nudge-studio.limit_heading"),
    detail: localizer(locale, "commands.nudge-studio.limit_detail"),
  };
}

/**
 * Routes that answer with a modal. `showModal()` must be the acknowledgement, so authorization and
 * the database read finish first, and the read skips tool resolution.
 */
async function openModal(
  interaction: GlobalRoutableInteraction,
  route: NudgeStudioRoute,
  deps: NudgeStudioRouteDependencies,
): Promise<void> {
  const { locale, category } = route;
  if (!deps.isAuthorized(interaction))
    return reply(interaction, locale, "general.errors.permission_denied_description");
  const scope = await deps.resolveScope(interaction);
  if (!scope) return reply(interaction, locale, "general.errors.tomori_not_setup_description");
  const view = await deps.loadView(scope.serverId, category, null);
  const nonce = deps.createNonce();
  const modalInteraction = interaction as Parameters<typeof showRoutedRawModal>[0];
  // No modal opened, so the click can still repaint the panel to show why.
  const refuse = async (receipt: PanelReceipt) => {
    await interaction.deferUpdate();
    await repaint(interaction, locale, category, scope, deps, receipt);
  };

  if (route.action === "select") {
    const value = interaction.isStringSelectMenu() ? interaction.values[0] : undefined;
    if (value === NUDGE_STUDIO_ADD_VALUE) {
      if (view.customCount >= CUSTOM_IDLE_NUDGE_LIMIT) return refuse(limitReceipt(locale));
      return deps.showModal(modalInteraction, buildIdleNudgeFormModal(locale, category, nonce));
    }
    const custom = view.entries.find((entry) => String(entry.custom?.custom_idle_nudge_id) === value)?.custom;
    if (!custom) return refuse(writeReceipt(locale, route.action, "stale"));
    return deps.showModal(modalInteraction, buildIdleNudgeFormModal(locale, category, nonce, custom));
  }
  if (route.action === "toggle-open") {
    const options = availabilityOptions(locale, view);
    deps.storeSnapshot(
      nonce,
      options.map((option) => option.value),
    );
    return deps.showModal(modalInteraction, buildAvailabilityModal(locale, category, nonce, options));
  }
  const options = removalOptions(view);
  if (options.length === 0) return refuse(writeReceipt(locale, route.action, "stale"));
  deps.storeSnapshot(
    nonce,
    options.map((option) => option.value),
  );
  return deps.showModal(modalInteraction, buildRemovalModal(locale, category, nonce, options));
}

async function runWrite(
  interaction: ModalSubmitInteraction,
  route: NudgeStudioRoute,
  serverId: number,
  deps: NudgeStudioRouteDependencies,
): Promise<StudioWriteResult> {
  const { category } = route;
  if (route.action === "add-submit" || route.action === "edit-submit") {
    const text = (field: "title" | "brief" | "agenda") =>
      interaction.fields.getTextInputValue(nudgeStudioFieldId(field, route.nonce));
    const form = {
      title: text("title"),
      brief: text("brief"),
      agendaHint: text("agenda"),
      prerequisites: deps.takeSelectValues(interaction.id, nudgeStudioFieldId("needs", route.nonce)) ?? [],
      recommendedTools: deps.takeSelectValues(interaction.id, nudgeStudioFieldId("tools", route.nonce)) ?? [],
    };
    return route.action === "add-submit"
      ? deps.operations.addCustomIdleNudge(serverId, category, form)
      : deps.operations.updateCustomIdleNudge(serverId, category, route.id, form);
  }
  if (route.action !== "toggle-submit" && route.action !== "remove-submit") return "invalid";
  const presented = deps.takeSnapshot(route.nonce);
  if (!presented) return "stale";
  const checked = checklistValues(deps, interaction.id, route.nonce, presented.length);
  if (!checked) return "stale";
  if (route.action === "toggle-submit")
    return deps.operations.setIdleNudgeAvailability(serverId, category, presented, checked);
  return deps.operations.removeCustomIdleNudges(
    serverId,
    category,
    presented.map(Number),
    new Set([...checked].map(Number)),
  );
}

async function repaint(
  interaction: StudioInteraction,
  locale: string,
  category: NaturalNudgeCategory,
  scope: StudioScope,
  deps: NudgeStudioRouteDependencies,
  receipt?: PanelReceipt,
): Promise<void> {
  let view: NudgeStudioView;
  try {
    view = await deps.loadView(scope.serverId, category, scope.personas);
  } catch {
    await deliverGuardedPanel(
      interaction,
      buildNudgeStudioTerminalPayload(locale, "commands.nudge-studio.unavailable"),
      { method: "editReply", locale },
    );
    return;
  }
  await deliverGuardedPanel(interaction, buildNudgeStudioPayload({ locale, view, receipt }), {
    method: "editReply",
    locale,
    receipt,
  });
}

function terminal(interaction: StudioInteraction, locale: string, key: string): Promise<unknown> {
  return deliverGuardedPanel(interaction, buildNudgeStudioTerminalPayload(locale, key), {
    method: "editReply",
    locale,
  });
}

const MODAL_ACTIONS = new Set<NudgeStudioRoute["action"]>(["select", "toggle-open", "remove-open"]);
const SUBMIT_ACTIONS = new Set<NudgeStudioRoute["action"]>([
  "add-submit",
  "edit-submit",
  "toggle-submit",
  "remove-submit",
]);

export function createNudgeStudioInteractionRoute(
  overrides: Partial<NudgeStudioRouteDependencies> = {},
): GlobalInteractionRoute {
  const deps = { ...defaults, ...overrides };
  return {
    namespace: NUDGE_STUDIO_ROUTE_NAMESPACE,
    version: NUDGE_STUDIO_ROUTE_VERSION,
    async execute(_client, interaction, parsed) {
      const route = parseNudgeStudioRoute(parsed);
      if (!route) throw new Error("Malformed Nudge Studio route");
      const typeMatches = SUBMIT_ACTIONS.has(route.action)
        ? interaction.isModalSubmit()
        : route.action === "select"
          ? interaction.isStringSelectMenu()
          : interaction.isButton();
      if (!typeMatches) throw new Error("Nudge Studio route interaction type mismatch");
      if (MODAL_ACTIONS.has(route.action)) return openModal(interaction, route, deps);

      const scope = await beginPanelInteraction(interaction, {
        authorize: () => deps.isAuthorized(interaction),
        onDenied: () => terminal(interaction, route.locale, "general.errors.permission_denied_description"),
        load: () => deps.resolveScope(interaction),
        onMissing: () => terminal(interaction, route.locale, "general.errors.tomori_not_setup_description"),
      });
      if (!scope) return;
      const writeAction = WRITE_ACTIONS[route.action];
      if (!writeAction) return repaint(interaction, route.locale, route.category, scope, deps);
      const result = await runWrite(interaction as ModalSubmitInteraction, route, scope.serverId, deps);
      if (result === "success")
        void deps.recordAction({ action: writeAction, serverId: scope.serverId, userDiscId: interaction.user.id });
      await repaint(
        interaction,
        route.locale,
        route.category,
        scope,
        deps,
        writeReceipt(route.locale, route.action, result),
      );
    },
  };
}

export const nudgeStudioInteractionRoute = createNudgeStudioInteractionRoute();

export async function executeNudgeStudioCommand(
  interaction: ChatInputCommandInteraction,
  locale: string,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!isAuthorized(interaction)) {
    await terminal(interaction, locale, "general.errors.permission_denied_description");
    return;
  }
  const scope = await resolveScope(interaction);
  if (!scope) {
    await terminal(interaction, locale, "general.errors.tomori_not_setup_description");
    return;
  }
  await repaint(interaction, locale, "ping_user", scope, defaults);
}
