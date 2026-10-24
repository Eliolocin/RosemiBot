import { MessageFlags, type ModalSubmitInteraction } from "discord.js";
import type { PanelAction } from "@/constants/panelActions";
import type { PanelReceipt } from "@/types/discord/panel";
import type { ConfigPanelRoute } from "@/utils/discord/configPanelCatalog";
import { CONFIG_MODEL_PAGE_SIZE } from "@/utils/discord/configPanelCatalog";
import { decodeConfigProviderPageValue } from "@/utils/discord/interactions/configModelLoaders";
import { isConfigRouteAuthorized, type ConfigActor } from "@/utils/discord/interactions/configPermissionPolicy";
import {
  repaint,
  staleReceipt,
  type ConfigRouteDependencies,
  type ConfigScope,
} from "@/utils/discord/interactions/configRouteContext";
import type { GlobalRoutableInteraction } from "@/utils/discord/interactions/routeRegistry";
import { buildConfigModalFieldId } from "@/utils/discord/ui/configModals";
import { CONFIG_MODEL_SELECT_FIELD } from "@/utils/discord/ui/configModelModals";
import { localizer } from "@/utils/text/localizer";
import type { IdleNudgeFrequencyLevel } from "@/modules/natural-nudges/db/types";
import {
  computeInterestFingerprint,
  type NaturalNudgesPanelState,
  type NudgeWriteResult,
} from "@/modules/natural-nudges/discord/operations";
import {
  buildCheckerModelModal,
  buildInterestModal,
  buildInterestRemovalModal,
  buildPlannerModelModal,
  NUDGE_ADD_VALUE,
  NUDGE_CLEAR_MODEL_VALUE,
  NUDGE_DECISION_PROVIDER_PREFIX,
  NUDGE_INTEREST_CHECKLIST_FIELD,
  NUDGE_INTEREST_DESCRIPTION_FIELD,
  NUDGE_INTEREST_LABEL_FIELD,
} from "@/modules/natural-nudges/discord/panel";

type ConfigAction = ConfigPanelRoute["action"];

export const NUDGE_STRING_SELECT_ACTIONS: ReadonlySet<ConfigAction> = new Set<ConfigAction>([
  "nudge-talk-select",
  "nudge-interest-select",
  "nudge-provider",
  "nudge-checker-provider",
  "nudge-idle-nudges-frequency-select",
  "nudge-active-nudges-frequency-select",
]);

export const NUDGE_CHANNEL_SELECT_ACTIONS: ReadonlySet<ConfigAction> = new Set<ConfigAction>(["nudge-channels-select"]);

export const NUDGE_MODAL_SUBMIT_ACTIONS: ReadonlySet<ConfigAction> = new Set<ConfigAction>([
  "nudge-interest-add-submit",
  "nudge-interest-edit-submit",
  "nudge-interest-remove-submit",
  "nudge-model-submit",
  "nudge-checker-model-submit",
  "nudge-checker-decision-submit",
]);

function selectedValues(interaction: GlobalRoutableInteraction): string[] {
  return interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() ? [...interaction.values] : [];
}

function parseIndex(value: string | undefined): number | null {
  return value && /^\d+$/.test(value) ? Number(value) : null;
}

/**
 * Routes that answer with a modal. `showModal()` must be the acknowledgement, so authorization and
 * the one fast read finish before it; returning false hands the click to the deferred path.
 */
export async function handleNudgeModalOpen(
  interaction: GlobalRoutableInteraction,
  route: ConfigPanelRoute,
  dependencies: ConfigRouteDependencies,
  actor: ConfigActor,
): Promise<boolean> {
  const value = interaction.isStringSelectMenu() ? interaction.values[0] : undefined;
  const opensModal =
    route.action === "nudge-interest-select" ||
    route.action === "nudge-interest-remove-open" ||
    ((route.action === "nudge-provider" || route.action === "nudge-checker-provider") &&
      value !== undefined &&
      value !== NUDGE_CLEAR_MODEL_VALUE);
  if (!opensModal) return false;

  const locale = route.locale;
  const deny = async (key: string) =>
    interaction.reply({ content: localizer(locale, key), flags: MessageFlags.Ephemeral });
  if (!isConfigRouteAuthorized(route, actor)) {
    await deny("commands.config.panel.denied_detail");
    return true;
  }
  const scope = await dependencies.resolveScope(interaction, false);
  const serverId = scope?.personas[0]?.server_id;
  if (!scope || serverId === undefined || scope.readStatus !== "fresh") {
    await deny("commands.config.panel.stale_detail");
    return true;
  }
  const nudges = dependencies.naturalNudges;
  const nonce = dependencies.createNonce();

  if (route.action === "nudge-interest-select") {
    if (value === NUDGE_ADD_VALUE) {
      await dependencies.showModal(interaction, buildInterestModal(locale, nonce, { personaId: route.personaId }));
      return true;
    }
    const index = parseIndex(value);
    const config = await nudges.loadPersonaConfig(route.personaId);
    const interest = index === null ? undefined : config?.interests[index];
    if (index === null || !interest) {
      await deny("commands.config.panel.stale_detail");
      return true;
    }
    const fp = computeInterestFingerprint(route.personaId, index, interest);
    await dependencies.showModal(
      interaction,
      buildInterestModal(locale, nonce, { personaId: route.personaId, index, fp }, interest),
    );
    return true;
  }
  if (route.action === "nudge-interest-remove-open") {
    const config = await nudges.loadPersonaConfig(route.personaId);
    if (!config || config.interests.length === 0) {
      await deny("commands.config.panel.stale_detail");
      return true;
    }
    await dependencies.showModal(
      interaction,
      buildInterestRemovalModal(locale, nonce, route.personaId, config.interests),
    );
    return true;
  }
  if (route.action === "nudge-provider" && value) {
    const settings = await nudges.loadSettings(serverId, locale, null);
    const page = findModelPage(settings.plannerModels, value);
    if (!page) {
      await deny("commands.config.panel.stale_detail");
      return true;
    }
    await dependencies.showModal(
      interaction,
      buildPlannerModelModal(locale, nonce, page.group, page.start, settings.config.llm_id),
    );
    return true;
  }
  if (route.action === "nudge-checker-provider" && value) {
    const settings = await nudges.loadSettings(serverId, locale, null);
    const kind = value.startsWith(NUDGE_DECISION_PROVIDER_PREFIX) ? "decision" : "llm";
    const page =
      kind === "decision"
        ? findModelPage(settings.checkerDecisionModels, value.slice(NUDGE_DECISION_PROVIDER_PREFIX.length))
        : findModelPage(settings.plannerModels, value);
    if (!page) {
      await deny("commands.config.panel.stale_detail");
      return true;
    }
    const current = kind === "decision" ? settings.config.checker_decision_model_id : settings.config.checker_llm_id;
    await dependencies.showModal(
      interaction,
      buildCheckerModelModal(locale, nonce, kind, page.group, page.start, current),
    );
    return true;
  }
  return false;
}

/** The provider group and page a model select value names, or null when it no longer exists. */
function findModelPage<Group extends { provider: string; models: readonly unknown[] }>(
  groups: readonly Group[],
  value: string,
): { group: Group; start: number } | null {
  const slice = decodeConfigProviderPageValue(value);
  const group = groups.find((candidate) => candidate.provider === (slice?.provider ?? value));
  const start = slice?.start ?? 0;
  if (!group || start % CONFIG_MODEL_PAGE_SIZE !== 0 || start >= group.models.length) return null;
  return { group, start };
}

function writeReceipt(locale: string, result: NudgeWriteResult): PanelReceipt {
  if (result === "stale") return staleReceipt(locale);
  if (result === "success")
    return {
      tone: "success",
      heading: localizer(locale, "commands.config.natural_nudges.saved_heading"),
      detail: localizer(locale, "commands.config.natural_nudges.saved_detail"),
    };
  return {
    tone: "error",
    heading: localizer(locale, "commands.config.panel.write_failed_heading"),
    detail: localizer(
      locale,
      result === "invalid"
        ? "commands.config.natural_nudges.invalid_detail"
        : result === "limit"
          ? "commands.config.natural_nudges.limit_detail"
          : result === "no-model"
            ? "commands.config.natural_nudges.generate_no_model_detail"
            : result === "generate-failed"
              ? "commands.config.natural_nudges.generate_failed_detail"
              : "commands.config.panel.write_failed_detail",
    ),
  };
}

export interface NudgeRouteContext {
  interaction: GlobalRoutableInteraction;
  route: ConfigPanelRoute;
  scope: ConfigScope;
  dependencies: ConfigRouteDependencies;
}

/** Deferred Natural Nudges routes: navigation repaints and writes, each repainting its own page. */
export async function handleNudgeRoutes(context: NudgeRouteContext): Promise<boolean> {
  const { interaction, route, dependencies } = context;
  if (!route.action.startsWith("nudge-")) return false;
  const locale = route.locale;
  const serverState = context.scope.personas[0];
  if (!serverState) return true;
  const serverId = serverState.server_id;
  const ops = dependencies.naturalNudges.operations;
  const values = selectedValues(interaction);
  const field = (name: string) =>
    "nonce" in route
      ? (interaction as ModalSubmitInteraction).fields.getTextInputValue(buildConfigModalFieldId(name, route.nonce))
      : "";

  const paintPersona = (personaId: number, state: NaturalNudgesPanelState = {}, receipt?: PanelReceipt) =>
    repaint(interaction, {
      locale,
      scope: context.scope,
      category: "persona",
      page: "nudges",
      selectedPersonaId: personaId,
      naturalNudges: state,
      receipt,
      dependencies,
    });
  const paintPlugins = (receipt: PanelReceipt) =>
    repaint(interaction, {
      locale,
      scope: context.scope,
      category: "plugins",
      page: "natural-nudges",
      selectedPersonaId: null,
      receipt,
      dependencies,
    });
  const write = async (operation: () => Promise<NudgeWriteResult>, action: PanelAction) => {
    const result = await operation();
    context.scope = (await dependencies.resolveScope(interaction, true)) ?? context.scope;
    if (result === "success" && context.scope.internalServerId)
      dependencies.recordAction({ action, serverId: context.scope.internalServerId, userDiscId: interaction.user.id });
    return result;
  };

  switch (route.action) {
    case "nudge-talk-select": {
      const level = parseIndex(values[0]);
      const result =
        level === null
          ? "stale"
          : await write(
              () => ops.setTalkativeness(route.personaId, level),
              "server-config.workspace.persona-nudge-talkativeness.set",
            );
      await paintPersona(route.personaId, {}, writeReceipt(locale, result));
      return true;
    }
    case "nudge-interest-add-submit": {
      const result = await write(
        () =>
          ops.addInterest(route.personaId, {
            label: field(NUDGE_INTEREST_LABEL_FIELD),
            description: field(NUDGE_INTEREST_DESCRIPTION_FIELD),
          }),
        "server-config.workspace.persona-nudge-interest.add",
      );
      await paintPersona(route.personaId, {}, writeReceipt(locale, result));
      return true;
    }
    case "nudge-interest-generate": {
      const persona = context.scope.personas.find((candidate) => candidate.persona_id === route.personaId);
      const result = persona
        ? await write(() => ops.generateInterests(persona), "server-config.workspace.persona-nudge-interest.generate")
        : "stale";
      await paintPersona(route.personaId, {}, writeReceipt(locale, result));
      return true;
    }
    case "nudge-interest-edit-submit": {
      const result = await write(
        () =>
          ops.editInterest(route.personaId, route.index, route.fp, {
            label: field(NUDGE_INTEREST_LABEL_FIELD),
            description: field(NUDGE_INTEREST_DESCRIPTION_FIELD),
          }),
        "server-config.workspace.persona-nudge-interest.edit",
      );
      await paintPersona(route.personaId, {}, writeReceipt(locale, result));
      return true;
    }
    case "nudge-interest-remove-submit": {
      const checked = dependencies.takeCheckboxValues(
        interaction.id,
        buildConfigModalFieldId(NUDGE_INTEREST_CHECKLIST_FIELD, route.nonce),
      );
      // Unchecked means remove, so a submit that carried no checkbox payload must not read as "remove all".
      const result =
        checked === undefined
          ? "stale"
          : await write(
              () =>
                ops.removeInterests(
                  route.personaId,
                  route.fp,
                  new Set(checked.flatMap((value) => parseIndex(value) ?? [])),
                ),
              "server-config.workspace.persona-nudge-interest.remove",
            );
      await paintPersona(route.personaId, {}, writeReceipt(locale, result));
      return true;
    }
    case "nudge-idle-nudges-set": {
      const result = await write(
        () => ops.setIdleNudgesEnabled(serverId, route.enabled),
        "server-config.workspace.natural-nudge-idle-nudges.set",
      );
      await paintPlugins(writeReceipt(locale, result));
      return true;
    }
    case "nudge-channels-select": {
      const result = await write(
        () => ops.setChannels(serverId, values),
        "server-config.workspace.natural-nudge-channels.set",
      );
      await paintPlugins(writeReceipt(locale, result));
      return true;
    }
    case "nudge-provider": {
      const result =
        values[0] === NUDGE_CLEAR_MODEL_VALUE
          ? await write(
              () => ops.setPlannerModel(serverState, "", null),
              "server-config.workspace.natural-nudge-model.set",
            )
          : "stale";
      await paintPlugins(writeReceipt(locale, result));
      return true;
    }
    case "nudge-model-submit": {
      const id = parseIndex(
        dependencies.takeSelectValue(interaction.id, buildConfigModalFieldId(CONFIG_MODEL_SELECT_FIELD, route.nonce)),
      );
      const result =
        id === null || id <= 0
          ? "stale"
          : await write(
              () => ops.setPlannerModel(serverState, route.provider, id),
              "server-config.workspace.natural-nudge-model.set",
            );
      await paintPlugins(writeReceipt(locale, result));
      return true;
    }
    case "nudge-checker-provider": {
      const result =
        values[0] === NUDGE_CLEAR_MODEL_VALUE
          ? await write(
              () => ops.setCheckerModel(serverState, null),
              "server-config.workspace.natural-nudge-checker.set",
            )
          : "stale";
      await paintPlugins(writeReceipt(locale, result));
      return true;
    }
    case "nudge-checker-model-submit":
    case "nudge-checker-decision-submit": {
      const id = parseIndex(
        dependencies.takeSelectValue(interaction.id, buildConfigModalFieldId(CONFIG_MODEL_SELECT_FIELD, route.nonce)),
      );
      const kind = route.action === "nudge-checker-model-submit" ? "llm" : "decision";
      const result =
        id === null || id <= 0
          ? "stale"
          : await write(
              () => ops.setCheckerModel(serverState, { kind, provider: route.provider, id }),
              "server-config.workspace.natural-nudge-checker.set",
            );
      await paintPlugins(writeReceipt(locale, result));
      return true;
    }
    case "nudge-idle-nudges-frequency-select": {
      const level = parseIndex(values[0]);
      const result =
        level === null || level > 3
          ? "stale"
          : await write(
              () => ops.setFrequency(serverId, level as IdleNudgeFrequencyLevel),
              "server-config.workspace.natural-nudge-idle-nudges-frequency.set",
            );
      await paintPlugins(writeReceipt(locale, result));
      return true;
    }
    case "nudge-active-nudges-set": {
      const result = await write(
        () => ops.setActiveNudgesEnabled(serverId, route.enabled),
        "server-config.workspace.natural-nudge-active-nudges.set",
      );
      await paintPlugins(writeReceipt(locale, result));
      return true;
    }
    case "nudge-active-nudges-frequency-select": {
      const level = parseIndex(values[0]);
      const result =
        level === null || level > 3
          ? "stale"
          : await write(
              () => ops.setActiveNudgesFrequency(serverId, level as IdleNudgeFrequencyLevel),
              "server-config.workspace.natural-nudge-active-nudges-frequency.set",
            );
      await paintPlugins(writeReceipt(locale, result));
      return true;
    }
    default:
      return false;
  }
}
