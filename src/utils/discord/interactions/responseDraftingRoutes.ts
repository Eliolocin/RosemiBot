import { MessageFlags, type ModalSubmitInteraction } from "discord.js";
import type { PanelAction } from "@/constants/panelActions";
import { CONFIG_MODEL_PAGE_SIZE, type ConfigPanelRoute } from "@/utils/discord/configPanelCatalog";
import {
  decodeConfigProviderPageValue,
  decodeConfigProviderRangeValue,
} from "@/utils/discord/interactions/configModelLoaders";
import { isConfigRouteAuthorized, type ConfigActor } from "@/utils/discord/interactions/configPermissionPolicy";
import { repaint, staleReceipt, type ConfigRouteDependencies } from "@/utils/discord/interactions/configRouteContext";
import type { ConfigModelRouteContext } from "@/utils/discord/interactions/configModelRoutes";
import type { GlobalRoutableInteraction } from "@/utils/discord/interactions/routeRegistry";
import { performPanelAction } from "@/utils/discord/interactions/panelController";
import {
  buildDraftPromptModal,
  buildDraftModelModal,
  DRAFT_CLEAR_VALUE,
  DRAFT_CHECKER_PAGE_SIZE,
  type DraftPicker,
} from "@/utils/discord/ui/responseDraftingPanel";
import { buildConfigModalFieldId } from "@/utils/discord/ui/configModals";
import { CONFIG_MODEL_SELECT_FIELD } from "@/utils/discord/ui/configModelModals";
import { checkerFingerprint, type DraftWriteResult } from "@/utils/discord/interactions/responseDraftingOperations";
import { localizer } from "@/utils/text/localizer";

export async function handleDraftModalOpen(
  interaction: GlobalRoutableInteraction,
  route: ConfigPanelRoute,
  dependencies: ConfigRouteDependencies,
  actor: ConfigActor,
): Promise<boolean> {
  if (route.action !== "draft-prompt-open" && route.action !== "draft-provider") return false;
  const selected = interaction.isStringSelectMenu() ? interaction.values[0] : undefined;
  if (
    route.action === "draft-provider" &&
    (selected === DRAFT_CLEAR_VALUE || (selected && decodeConfigProviderRangeValue(selected)))
  )
    return false;
  const locale = route.locale;
  const deny = async (key: string) =>
    interaction.reply({ content: localizer(locale, key), flags: MessageFlags.Ephemeral });
  if (!isConfigRouteAuthorized(route, actor)) {
    await deny("commands.config.panel.denied_detail");
    return true;
  }
  const scope = await dependencies.resolveScope(interaction, false);
  const state = scope?.personas[0];
  if (!scope || !state || scope.readStatus !== "fresh") {
    await deny("commands.config.panel.stale_detail");
    return true;
  }
  if (route.action === "draft-prompt-open") {
    await dependencies.showModal(interaction, buildDraftPromptModal(state, locale, dependencies.createNonce()));
    return true;
  }
  const slice = selected ? decodeConfigProviderPageValue(selected) : null;
  const group = (await dependencies.loadDraftModels(state.server_id, route.slot, locale)).find(
    (candidate) => candidate.provider === (slice?.provider ?? selected),
  );
  if (!group) {
    await deny("commands.config.panel.stale_detail");
    return true;
  }
  if (!slice && group.models.length > CONFIG_MODEL_PAGE_SIZE) {
    await interaction.deferUpdate();
    await repaint(interaction, {
      locale,
      scope,
      category: "plugins",
      page: "response-drafting",
      selectedPersonaId: null,
      draftPicker: { slot: route.slot, provider: group.provider, start: 0 },
      dependencies,
      receipt: {
        tone: "info",
        heading: localizer(locale, "commands.config.panel.model_provider_paged_heading"),
        detail: localizer(locale, "commands.config.panel.model_provider_paged_detail", {
          provider: group.provider,
          count: group.models.length,
        }),
      },
    });
    return true;
  }
  const start = slice?.start ?? 0;
  if (start % CONFIG_MODEL_PAGE_SIZE !== 0 || start >= group.models.length) {
    await deny("commands.config.panel.stale_detail");
    return true;
  }
  await dependencies.showModal(
    interaction,
    buildDraftModelModal(state, locale, dependencies.createNonce(), route.slot, group, start),
  );
  return true;
}

export async function handleDraftRoutes(context: ConfigModelRouteContext): Promise<boolean> {
  const { route, interaction, dependencies } = context;
  if (!route.action.startsWith("draft-")) return false;
  const state = context.scope.personas[0];
  if (!state) return true;
  const locale = route.locale;
  const paint = (picker?: DraftPicker, result?: DraftWriteResult) =>
    repaint(interaction, {
      locale,
      scope: context.scope,
      category: "plugins",
      page: "response-drafting",
      selectedPersonaId: null,
      dependencies,
      draftPicker: picker,
      receipt:
        result === undefined
          ? undefined
          : result === "stale"
            ? staleReceipt(locale)
            : {
                tone: result === "success" ? "success" : "error",
                heading: localizer(
                  locale,
                  result === "success"
                    ? "commands.config.drafting.saved_heading"
                    : "commands.config.panel.write_failed_heading",
                ),
                detail: localizer(
                  locale,
                  result === "success"
                    ? "commands.config.drafting.saved_detail"
                    : result === "invalid"
                      ? "commands.config.drafting.invalid_detail"
                      : "commands.config.panel.write_failed_detail",
                ),
              },
    });
  const write = async (operation: () => Promise<DraftWriteResult>, action: PanelAction) => {
    const result = await performPanelAction(operation, () => dependencies.resolveScope(interaction, true));
    context.scope = result.state ?? context.scope;
    if (result.result === "success" && context.scope.internalServerId)
      dependencies.recordAction({ action, serverId: context.scope.internalServerId, userDiscId: interaction.user.id });
    await paint(undefined, result.result);
  };
  if (route.action === "draft-picker") {
    await paint({ slot: route.slot, provider: route.provider === "none" ? null : route.provider, start: route.start });
  } else if (route.action === "draft-checker") {
    await paint({ slot: "checker", start: route.start });
  } else if (route.action === "draft-provider") {
    const range = context.selectedValue ? decodeConfigProviderRangeValue(context.selectedValue) : null;
    if (range) await paint({ slot: route.slot, provider: range.expandedProvider, start: range.start });
    else if (context.selectedValue === DRAFT_CLEAR_VALUE)
      await write(
        () => dependencies.draftingOperations.setModel(state, context.scope.serverDiscId, route.slot, "", null),
        route.slot === "reviewer"
          ? "server-config.workspace.response-reviewer.set"
          : "server-config.workspace.response-decision.set",
      );
    else await paint(undefined, "stale");
  } else if (route.action === "draft-set") {
    await write(
      () => dependencies.draftingOperations.setEnabled(state, context.scope.serverDiscId, route.enabled),
      "server-config.workspace.response-drafting.set",
    );
  } else if (route.action === "draft-default") {
    await write(
      () => dependencies.draftingOperations.setPrompt(state, context.scope.serverDiscId, null),
      "server-config.workspace.response-prompt.reset",
    );
  } else if (route.action === "draft-prompt-submit") {
    const prompt = (interaction as ModalSubmitInteraction).fields.getTextInputValue(
      buildConfigModalFieldId("draft_prompt", route.nonce),
    );
    await write(
      () => dependencies.draftingOperations.setPrompt(state, context.scope.serverDiscId, prompt),
      "server-config.workspace.response-prompt.set",
    );
  } else if (route.action === "draft-model-submit") {
    const value = dependencies.takeSelectValue(
      interaction.id,
      buildConfigModalFieldId(CONFIG_MODEL_SELECT_FIELD, route.nonce),
    );
    const id = value && /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(id) || id <= 0) await paint(undefined, "stale");
    else
      await write(
        () =>
          dependencies.draftingOperations.setModel(state, context.scope.serverDiscId, route.slot, route.provider, id),
        route.slot === "reviewer"
          ? "server-config.workspace.response-reviewer.set"
          : "server-config.workspace.response-decision.set",
      );
  } else if (route.action === "draft-checker-select") {
    const value = context.selectedValue;
    if (value === DRAFT_CLEAR_VALUE) {
      await write(
        () => dependencies.draftingOperations.setChecker(state, context.scope.serverDiscId, null),
        "server-config.workspace.response-checker.set",
      );
    } else if (value?.startsWith("page|")) {
      const start = Number(value.slice(5));
      if (Number.isSafeInteger(start) && start >= 0 && start % DRAFT_CHECKER_PAGE_SIZE === 0)
        await paint({ slot: "checker", start });
      else await paint(undefined, "stale");
    } else {
      const choices = await dependencies.loadDraftCheckers(state.server_id);
      const index = value && /^\d+$/.test(value) ? Number(value) : NaN;
      const choice = choices[index];
      if (
        !choice ||
        index < route.start ||
        index >= route.start + DRAFT_CHECKER_PAGE_SIZE ||
        checkerFingerprint(choices) !== route.fp
      )
        await paint(undefined, "stale");
      else
        await write(
          () => dependencies.draftingOperations.setChecker(state, context.scope.serverDiscId, choice.reference),
          "server-config.workspace.response-checker.set",
        );
    }
  }
  return true;
}
