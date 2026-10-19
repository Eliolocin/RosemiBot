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
import type { EpisodeFrequencyLevel } from "@/modules/natural-nudges/db/types";
import {
  computeInterestFingerprint,
  type NaturalNudgesPanelState,
  type NudgeWriteResult,
} from "@/modules/natural-nudges/discord/operations";
import {
  buildEpisodeModal,
  buildInterestModal,
  buildLimitsModal,
  buildPlannerModelModal,
  NUDGE_ADD_VALUE,
  NUDGE_CLEAR_MODEL_VALUE,
  NUDGE_DAILY_CAP_FIELD,
  NUDGE_EPISODE_AGENDA_FIELD,
  NUDGE_EPISODE_BRIEF_FIELD,
  NUDGE_EPISODE_CATEGORY_FIELD,
  NUDGE_EPISODE_TITLE_FIELD,
  NUDGE_INTEREST_DESCRIPTION_FIELD,
  NUDGE_INTEREST_LABEL_FIELD,
  NUDGE_NEW_TOPIC_WEIGHT_FIELD,
  NUDGE_REVIVE_WEIGHT_FIELD,
} from "@/modules/natural-nudges/discord/panel";

type ConfigAction = ConfigPanelRoute["action"];

export const NUDGE_STRING_SELECT_ACTIONS: ReadonlySet<ConfigAction> = new Set<ConfigAction>([
  "nudge-talk-select",
  "nudge-interest-select",
  "nudge-provider",
  "nudge-frequency-select",
  "nudge-episode-select",
  "nudge-episode-prereqs-select",
  "nudge-episode-tools-select",
]);

export const NUDGE_CHANNEL_SELECT_ACTIONS: ReadonlySet<ConfigAction> = new Set<ConfigAction>(["nudge-channels-select"]);

export const NUDGE_MODAL_SUBMIT_ACTIONS: ReadonlySet<ConfigAction> = new Set<ConfigAction>([
  "nudge-interest-add-submit",
  "nudge-interest-edit-submit",
  "nudge-model-submit",
  "nudge-limits-submit",
  "nudge-episode-add-submit",
  "nudge-episode-edit-submit",
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
    (route.action === "nudge-interest-select" && value === NUDGE_ADD_VALUE) ||
    route.action === "nudge-interest-edit-open" ||
    (route.action === "nudge-provider" && value !== undefined && value !== NUDGE_CLEAR_MODEL_VALUE) ||
    route.action === "nudge-limits-open" ||
    (route.action === "nudge-episode-select" && value === NUDGE_ADD_VALUE) ||
    route.action === "nudge-episode-edit-open";
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
    await dependencies.showModal(interaction, buildInterestModal(locale, nonce, { personaId: route.personaId }));
    return true;
  }
  if (route.action === "nudge-interest-edit-open") {
    const config = await nudges.loadPersonaConfig(route.personaId);
    const interest = config?.interests[route.index];
    if (!interest || computeInterestFingerprint(route.personaId, route.index, interest) !== route.fp) {
      await deny("commands.config.panel.stale_detail");
      return true;
    }
    await dependencies.showModal(
      interaction,
      buildInterestModal(locale, nonce, { personaId: route.personaId, index: route.index, fp: route.fp }, interest),
    );
    return true;
  }
  if (route.action === "nudge-provider") {
    const settings = await nudges.loadSettings(serverId, locale);
    const slice = value ? decodeConfigProviderPageValue(value) : null;
    const group = settings.plannerModels.find((candidate) => candidate.provider === (slice?.provider ?? value));
    const start = slice?.start ?? 0;
    if (!group || start % CONFIG_MODEL_PAGE_SIZE !== 0 || start >= group.models.length) {
      await deny("commands.config.panel.stale_detail");
      return true;
    }
    await dependencies.showModal(
      interaction,
      buildPlannerModelModal(locale, nonce, group, start, settings.config.llm_id),
    );
    return true;
  }
  if (route.action === "nudge-limits-open") {
    await dependencies.showModal(
      interaction,
      buildLimitsModal(locale, nonce, await nudges.loadSettings(serverId, locale)),
    );
    return true;
  }
  if (route.action === "nudge-episode-select") {
    await dependencies.showModal(interaction, buildEpisodeModal(locale, nonce, null));
    return true;
  }
  if (route.action === "nudge-episode-edit-open") {
    const view = await nudges.loadEpisodes(serverId);
    const entry = view.entries[route.index];
    if (view.fingerprint !== route.fp || !entry?.custom) {
      await deny("commands.config.panel.stale_detail");
      return true;
    }
    await dependencies.showModal(
      interaction,
      buildEpisodeModal(locale, nonce, { index: route.index, fp: route.fp }, entry),
    );
    return true;
  }
  return false;
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
  const serverId = context.scope.personas[0]?.server_id;
  if (serverId === undefined) return true;
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
  const paintPlugins = (
    page: "natural-nudges" | "nudge-episodes",
    state: NaturalNudgesPanelState = {},
    receipt?: PanelReceipt,
  ) =>
    repaint(interaction, {
      locale,
      scope: context.scope,
      category: "plugins",
      page,
      selectedPersonaId: null,
      naturalNudges: state,
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
    case "nudge-interest-select": {
      const index = parseIndex(values[0]);
      await paintPersona(route.personaId, index === null ? {} : { selectedInterestIndex: index });
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
    case "nudge-interest-edit-submit": {
      const result = await write(
        () =>
          ops.editInterest(route.personaId, route.index, route.fp, {
            label: field(NUDGE_INTEREST_LABEL_FIELD),
            description: field(NUDGE_INTEREST_DESCRIPTION_FIELD),
          }),
        "server-config.workspace.persona-nudge-interest.edit",
      );
      await paintPersona(
        route.personaId,
        result === "success" ? { selectedInterestIndex: route.index } : {},
        writeReceipt(locale, result),
      );
      return true;
    }
    case "nudge-interest-remove": {
      const result = await write(
        () => ops.editInterest(route.personaId, route.index, route.fp, null),
        "server-config.workspace.persona-nudge-interest.remove",
      );
      await paintPersona(route.personaId, {}, writeReceipt(locale, result));
      return true;
    }
    case "nudge-episodes-set": {
      const result = await write(
        () => ops.setEpisodesEnabled(serverId, route.enabled),
        "server-config.workspace.natural-nudges.set",
      );
      await paintPlugins("natural-nudges", {}, writeReceipt(locale, result));
      return true;
    }
    case "nudge-channels-select": {
      const result = await write(
        () => ops.setChannels(serverId, values),
        "server-config.workspace.natural-nudge-channels.set",
      );
      await paintPlugins("natural-nudges", {}, writeReceipt(locale, result));
      return true;
    }
    case "nudge-provider": {
      const result =
        values[0] === NUDGE_CLEAR_MODEL_VALUE
          ? await write(
              () => ops.setPlannerModel(serverId, "", null),
              "server-config.workspace.natural-nudge-model.set",
            )
          : "stale";
      await paintPlugins("natural-nudges", {}, writeReceipt(locale, result));
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
              () => ops.setPlannerModel(serverId, route.provider, id),
              "server-config.workspace.natural-nudge-model.set",
            );
      await paintPlugins("natural-nudges", {}, writeReceipt(locale, result));
      return true;
    }
    case "nudge-frequency-select": {
      const level = parseIndex(values[0]);
      const result =
        level === null || level > 3
          ? "stale"
          : await write(
              () => ops.setFrequency(serverId, level as EpisodeFrequencyLevel),
              "server-config.workspace.natural-nudge-frequency.set",
            );
      await paintPlugins("natural-nudges", {}, writeReceipt(locale, result));
      return true;
    }
    case "nudge-limits-submit": {
      const number = (name: string) => {
        const raw = field(name).trim();
        return /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
      };
      const result = await write(
        () =>
          ops.setLimits(serverId, {
            revive_weight: number(NUDGE_REVIVE_WEIGHT_FIELD),
            new_topic_weight: number(NUDGE_NEW_TOPIC_WEIGHT_FIELD),
            daily_episode_cap: number(NUDGE_DAILY_CAP_FIELD),
          }),
        "server-config.workspace.natural-nudge-limits.set",
      );
      await paintPlugins("natural-nudges", {}, writeReceipt(locale, result));
      return true;
    }
    case "nudge-episode-select": {
      const index = parseIndex(values[0]);
      const view = await dependencies.naturalNudges.loadEpisodes(serverId);
      if (index === null || view.fingerprint !== route.fp || !view.entries[index]) {
        await paintPlugins("nudge-episodes", { episodes: view, episodeStart: route.start }, staleReceipt(locale));
        return true;
      }
      await paintPlugins("nudge-episodes", { episodes: view, episodeStart: route.start, selectedEpisodeIndex: index });
      return true;
    }
    case "nudge-episode-page": {
      await paintPlugins("nudge-episodes", { episodeStart: route.start });
      return true;
    }
    case "nudge-episode-add-submit": {
      const category = dependencies.takeSelectValue(
        interaction.id,
        buildConfigModalFieldId(NUDGE_EPISODE_CATEGORY_FIELD, route.nonce),
      );
      const result = await write(
        () =>
          ops.addCustomEpisode(serverId, {
            category: category ?? "",
            title: field(NUDGE_EPISODE_TITLE_FIELD),
            brief: field(NUDGE_EPISODE_BRIEF_FIELD),
            agendaHint: field(NUDGE_EPISODE_AGENDA_FIELD),
          }),
        "server-config.workspace.nudge-episode.add",
      );
      const view = await dependencies.naturalNudges.loadEpisodes(serverId);
      const added = result === "success" ? view.entries.length - 1 : undefined;
      await paintPlugins(
        "nudge-episodes",
        { episodes: view, episodeStart: added ?? 0, selectedEpisodeIndex: added },
        writeReceipt(locale, result),
      );
      return true;
    }
    case "nudge-episode-toggle": {
      const result = await write(
        () => ops.setEpisodeEnabled(serverId, route.index, route.fp, route.enabled),
        "server-config.workspace.nudge-episode.set",
      );
      await paintPlugins(
        "nudge-episodes",
        { episodeStart: route.index, selectedEpisodeIndex: result === "stale" ? undefined : route.index },
        writeReceipt(locale, result),
      );
      return true;
    }
    case "nudge-episode-edit-submit": {
      const category = dependencies.takeSelectValue(
        interaction.id,
        buildConfigModalFieldId(NUDGE_EPISODE_CATEGORY_FIELD, route.nonce),
      );
      const result = await write(
        () =>
          ops.updateCustomEpisodeText(serverId, route.index, route.fp, {
            category: category ?? "",
            title: field(NUDGE_EPISODE_TITLE_FIELD),
            brief: field(NUDGE_EPISODE_BRIEF_FIELD),
            agendaHint: field(NUDGE_EPISODE_AGENDA_FIELD),
          }),
        "server-config.workspace.nudge-episode.edit",
      );
      await paintPlugins(
        "nudge-episodes",
        { episodeStart: route.index, selectedEpisodeIndex: result === "stale" ? undefined : route.index },
        writeReceipt(locale, result),
      );
      return true;
    }
    case "nudge-episode-prereqs-select":
    case "nudge-episode-tools-select": {
      const patch =
        route.action === "nudge-episode-prereqs-select" ? { prerequisites: values } : { recommendedTools: values };
      const result = await write(
        () => ops.setCustomEpisodeLists(serverId, route.index, route.fp, patch),
        "server-config.workspace.nudge-episode.edit",
      );
      await paintPlugins(
        "nudge-episodes",
        { episodeStart: route.index, selectedEpisodeIndex: result === "stale" ? undefined : route.index },
        writeReceipt(locale, result),
      );
      return true;
    }
    case "nudge-episode-remove-view": {
      const view = await dependencies.naturalNudges.loadEpisodes(serverId);
      const valid = view.fingerprint === route.fp && Boolean(view.entries[route.index]?.custom);
      await paintPlugins(
        "nudge-episodes",
        valid
          ? {
              episodes: view,
              episodeStart: route.index,
              selectedEpisodeIndex: route.index,
              removeConfirmNonce: dependencies.createNonce(),
            }
          : { episodes: view },
        valid ? undefined : staleReceipt(locale),
      );
      return true;
    }
    case "nudge-episode-remove-confirm": {
      const result = await write(
        () => ops.removeCustomEpisode(serverId, route.index, route.fp),
        "server-config.workspace.nudge-episode.remove",
      );
      await paintPlugins("nudge-episodes", {}, writeReceipt(locale, result));
      return true;
    }
    case "nudge-episode-remove-cancel": {
      await paintPlugins("nudge-episodes", { episodeStart: route.index, selectedEpisodeIndex: route.index });
      return true;
    }
    default:
      return false;
  }
}
