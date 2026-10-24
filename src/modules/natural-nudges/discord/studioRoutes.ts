import { MessageFlags, type ChatInputCommandInteraction, type ModalSubmitInteraction } from "discord.js";
import type { PanelAction } from "@/constants/panelActions";
import type { TomoriState } from "@/types/db/schema";
import type { PanelReceipt } from "@/types/discord/panel";
import { CUSTOM_IDLE_NUDGE_LIMIT, type NaturalNudgeCategory } from "@/modules/natural-nudges/db/types";
import {
  buildNudgeStudioRouteId,
  NUDGE_STUDIO_ROUTE_NAMESPACE,
  NUDGE_STUDIO_ROUTE_VERSION,
  nudgeStudioFieldId,
  parseNudgeStudioRoute,
  type NudgeStudioRoute,
} from "@/modules/natural-nudges/discord/studioCatalog";
import {
  idleNudgeContentFromCustom,
  idleNudgeContentFromDefinition,
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
  buildPersonaAvailabilityModal,
  buildRemovalModal,
  checklistGroupCount,
  NUDGE_STUDIO_ADD_VALUE,
  NUDGE_STUDIO_PAGE_SIZE,
  parseStudioRemovalKey,
  personaNudgeFormTarget,
  removalOptions,
  studioEntryOwnerName,
  studioEntrySelectionValue,
} from "@/modules/natural-nudges/discord/studioPanel";
import { resolveRangeSelection } from "@/utils/discord/interactions/panelController";
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
  "persona-edit-submit": "nudge-studio.workspace.idle-nudge.edit",
  "toggle-submit": "nudge-studio.workspace.idle-nudge.set",
  "persona-toggle-submit": "nudge-studio.workspace.idle-nudge.set",
  "remove-submit": "nudge-studio.workspace.idle-nudge.remove",
};

/** The page a route was on, so every repaint keeps the admin where they were. */
function routePage(route: NudgeStudioRoute): number {
  return ("page" in route ? route.page : undefined) ?? 0;
}

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
  const view = await deps.loadView(scope.serverId, category, scope.personas, { judgeBlockers: false });
  const nonce = deps.createNonce();
  const page = routePage(route);
  const modalInteraction = interaction as Parameters<typeof showRoutedRawModal>[0];
  // No modal opened, so the click can still repaint the panel to show why.
  const refuse = async (receipt: PanelReceipt) => {
    await interaction.deferUpdate();
    await repaint(interaction, locale, category, scope, deps, page, receipt);
  };
  const livePersonaIds = scope.personas.flatMap((persona) => (persona.persona_id ? [persona.persona_id] : []));

  if (route.action === "select") {
    const value = interaction.isStringSelectMenu() ? interaction.values[0] : undefined;
    if (value === NUDGE_STUDIO_ADD_VALUE) {
      if (view.customCount >= CUSTOM_IDLE_NUDGE_LIMIT) return refuse(limitReceipt(locale));
      return deps.showModal(
        modalInteraction,
        buildIdleNudgeFormModal(locale, category, nonce, undefined, {
          customId: buildNudgeStudioRouteId({ action: "add-submit", locale, category, nonce, page }),
        }),
      );
    }
    const entry = view.entries.find((candidate) => studioEntrySelectionValue(candidate) === value);
    if (!entry) return refuse(writeReceipt(locale, route.action, "stale"));
    if (entry.custom) {
      return deps.showModal(
        modalInteraction,
        buildIdleNudgeFormModal(locale, category, nonce, idleNudgeContentFromCustom(entry.custom), {
          customId: buildNudgeStudioRouteId({
            action: "edit-submit",
            locale,
            category,
            id: entry.custom.custom_idle_nudge_id,
            nonce,
            page,
          }),
        }),
      );
    }
    const target = personaNudgeFormTarget(entry);
    if (!target || !livePersonaIds.includes(target.ownerId)) return refuse(writeReceipt(locale, route.action, "stale"));
    return deps.showModal(
      modalInteraction,
      buildIdleNudgeFormModal(locale, category, nonce, idleNudgeContentFromDefinition(entry.definition), {
        customId: buildNudgeStudioRouteId({
          action: "persona-edit-submit",
          locale,
          category,
          page,
          ownerId: target.ownerId,
          idleNudgeId: target.idleNudgeId,
          fp: target.fp,
          nonce,
        }),
      }),
    );
  }
  if (route.action === "toggle-open") {
    const key = interaction.isStringSelectMenu() ? interaction.values[0] : undefined;
    const entry = view.entries.find((candidate) => candidate.definition.key === key);
    if (!entry) return refuse(writeReceipt(locale, route.action, "stale"));
    const ownerId = entry.definition.ownerPersonaId;
    if (ownerId !== undefined) {
      if (!livePersonaIds.includes(ownerId)) return refuse(writeReceipt(locale, route.action, "stale"));
      return deps.showModal(
        modalInteraction,
        buildPersonaAvailabilityModal(
          locale,
          category,
          entry,
          route.page,
          nonce,
          studioEntryOwnerName(entry, view.personaNames) ?? "",
        ),
      );
    }
    const options = availabilityOptions(scope.personas, entry);
    deps.storeSnapshot(
      nonce,
      options.map((option) => option.value),
    );
    return deps.showModal(
      modalInteraction,
      buildAvailabilityModal(locale, category, entry, route.page, nonce, options),
    );
  }
  if (route.action !== "remove-open") return;
  const selection = resolveRangeSelection(view.entries, page, NUDGE_STUDIO_PAGE_SIZE);
  const options = removalOptions(selection.visibleItems);
  if (options.length === 0) return refuse(writeReceipt(locale, route.action, "stale"));
  deps.storeSnapshot(
    nonce,
    options.map((option) => option.value),
  );
  return deps.showModal(modalInteraction, buildRemovalModal(locale, category, nonce, options, page));
}

function readForm(interaction: ModalSubmitInteraction, route: NudgeStudioRoute, deps: NudgeStudioRouteDependencies) {
  const nonce = "nonce" in route ? route.nonce : "";
  const text = (field: "title" | "brief" | "agenda") =>
    interaction.fields.getTextInputValue(nudgeStudioFieldId(field, nonce));
  return {
    title: text("title"),
    brief: text("brief"),
    agendaHint: text("agenda"),
    prerequisites: deps.takeSelectValues(interaction.id, nudgeStudioFieldId("needs", nonce)) ?? [],
    recommendedTools: deps.takeSelectValues(interaction.id, nudgeStudioFieldId("tools", nonce)) ?? [],
  };
}

async function runWrite(
  interaction: ModalSubmitInteraction,
  route: NudgeStudioRoute,
  { serverId, personas }: StudioScope,
  deps: NudgeStudioRouteDependencies,
): Promise<StudioWriteResult> {
  const { category } = route;
  const livePersonaIds = personas.flatMap((persona) => (persona.persona_id ? [persona.persona_id] : []));
  if (route.action === "add-submit" || route.action === "edit-submit") {
    const form = readForm(interaction, route, deps);
    return route.action === "add-submit"
      ? deps.operations.addCustomIdleNudge(serverId, category, form)
      : deps.operations.updateCustomIdleNudge(serverId, category, route.id, form);
  }
  if (route.action === "persona-edit-submit") {
    return deps.operations.updatePersonaIdleNudge(
      category,
      livePersonaIds,
      route.ownerId,
      route.idleNudgeId,
      route.fp,
      readForm(interaction, route, deps),
    );
  }
  if (route.action === "persona-toggle-submit") {
    const checked = deps.takeCheckboxValues(interaction.id, nudgeStudioFieldId("checklist", route.nonce));
    if (!checked) return "stale";
    return deps.operations.setPersonaIdleNudgeAvailability(
      category,
      livePersonaIds,
      route.ownerId,
      route.idleNudgeId,
      checked.includes("available"),
    );
  }
  const presented = deps.takeSnapshot("nonce" in route ? route.nonce : "");
  if (!presented) return "stale";
  const checked = checklistValues(deps, interaction.id, "nonce" in route ? route.nonce : "", presented.length);
  if (!checked) return "stale";
  if (route.action === "toggle-submit") {
    if (route.key.startsWith("persona:")) return "stale";
    return deps.operations.setIdleNudgeAvailability(
      serverId,
      category,
      route.key,
      livePersonaIds,
      presented.map(Number),
      new Set([...checked].map(Number)),
    );
  }
  if (route.action !== "remove-submit") return "invalid";
  const customIds: number[] = [];
  const personaEntries: Array<{ ownerPersonaId: number; idleNudgeId: string; fp: string }> = [];
  const keptKeys = new Set<string>();
  for (const value of presented) {
    const parsed = parseStudioRemovalKey(value);
    if (!parsed) continue;
    if (checked.has(value)) {
      keptKeys.add(parsed.kind === "custom" ? `custom:${parsed.id}` : `${parsed.ownerPersonaId}:${parsed.idleNudgeId}`);
      continue;
    }
    if (parsed.kind === "custom") customIds.push(parsed.id);
    else personaEntries.push({ ownerPersonaId: parsed.ownerPersonaId, idleNudgeId: parsed.idleNudgeId, fp: parsed.fp });
  }
  const customKept = new Set(
    [...keptKeys].flatMap((key) => {
      const match = /^custom:(\d+)$/.exec(key);
      return match ? [Number(match[1])] : [];
    }),
  );
  const personaKept = new Set([...keptKeys].filter((key) => !key.startsWith("custom:")));
  const personaResult = await deps.operations.removePersonaIdleNudges(
    category,
    livePersonaIds,
    personaEntries,
    personaKept,
  );
  if (personaResult === "stale" || personaResult === "write-failed" || personaResult === "invalid")
    return personaResult;
  const customResult = await deps.operations.removeCustomIdleNudges(serverId, category, customIds, customKept);
  if (customResult === "write-failed") return "write-failed";
  if (customResult === "success" || personaResult === "success") return "success";
  return "unchanged";
}

async function repaint(
  interaction: StudioInteraction,
  locale: string,
  category: NaturalNudgeCategory,
  scope: StudioScope,
  deps: NudgeStudioRouteDependencies,
  page: number,
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
  await deliverGuardedPanel(interaction, buildNudgeStudioPayload({ locale, view, page, receipt }), {
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
const SELECT_ACTIONS = new Set<NudgeStudioRoute["action"]>(["select", "toggle-open"]);
const SUBMIT_ACTIONS = new Set<NudgeStudioRoute["action"]>([
  "add-submit",
  "edit-submit",
  "persona-edit-submit",
  "toggle-submit",
  "persona-toggle-submit",
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
        : SELECT_ACTIONS.has(route.action)
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
      if (!writeAction) return repaint(interaction, route.locale, route.category, scope, deps, routePage(route));
      const result = await runWrite(interaction as ModalSubmitInteraction, route, scope, deps);
      if (result === "success")
        void deps.recordAction({ action: writeAction, serverId: scope.serverId, userDiscId: interaction.user.id });
      await repaint(
        interaction,
        route.locale,
        route.category,
        scope,
        deps,
        routePage(route),
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
  await repaint(interaction, locale, "ping_user", scope, defaults, 0);
}
