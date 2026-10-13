import { MessageFlags, type ChatInputCommandInteraction, type InteractionEditReplyOptions } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { getCachedAllPersonas, getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { userRepository } from "@/utils/db/repositories";
import type { GlobalInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import { beginPanelInteraction } from "@/utils/discord/interactions/panelController";
import {
  getMemoryCount,
  getStmCount,
  loadAvailableModelsForCapability,
  loadPersonalModelDisplayInfo,
  loadPersonaNamingPreference,
  loadUserSavedProviders,
  resolveScope,
  resolveIdentityConfigScope,
} from "@/utils/discord/interactions/personalConfigLoaders";
import { personalConfigOperations } from "@/utils/discord/interactions/personalConfigOperations";
import { createNonce } from "@/utils/discord/panelRouteTokens";
import {
  PERSONAL_CONFIG_ROUTE_NAMESPACE,
  PERSONAL_CONFIG_ROUTE_VERSION,
  parsePersonalConfigPanelRoute,
} from "@/utils/discord/personalConfigPanelCatalog";
import {
  buildAboutModal,
  buildAppearanceModal,
  buildCharacterReferenceModal,
  buildFallbacksModal,
  buildImpersonationModal,
  buildLanguageModal,
  buildModelSelectModal,
  buildNamingModal,
  buildParameters1Modal,
  buildParameters2Modal,
  buildPersonaNamingModal,
  buildPrivacyLevelModal,
  buildQuickToggleModal,
  buildSpotlightAutoTriggerModal,
  buildSpotlightRemoveModal,
  buildSpotlightSetModal,
  buildSpotlightStep1Modal,
  buildTimezoneModal,
} from "@/utils/discord/ui/personalConfigModals";
import type { buildPersonalConfigPanelPayload } from "@/utils/discord/ui/personalConfigPanel";
import {
  IDENTITY_CONFIG_VERSION,
  parseManagedIdentityRoute,
  rewriteManagedIdentityRouteIds,
} from "@/utils/discord/interactions/managedIdentityPanelRoutes";
import { showRoutedRawModal } from "@/utils/discord/ui/modals";
import { recordPanelActionStat } from "@/utils/stats/panelActionMetrics";
import {
  resolveInvokerAvatarUrl,
  resolvePersonaPanelAvatar,
  withPersonaPanelAvatar,
} from "@/utils/discord/personaPanelAvatar";
import {
  terminalPayload,
  buildScopedPersonalConfigPanelPayload,
  type PersonalConfigPostDeferContext,
  type PersonalConfigRouteDependencies,
} from "@/utils/discord/interactions/personalConfigRouteContext";
import { handlePersonalConfigModalOpen } from "@/utils/discord/interactions/personalConfigModalOpenRoutes";
import { handlePersonalConfigNavigation } from "@/utils/discord/interactions/personalConfigNavigationRoutes";
import { handlePersonalConfigProfileWrites } from "@/utils/discord/interactions/personalConfigProfileRoutes";
import { handlePersonalConfigModelRoutes } from "@/utils/discord/interactions/personalConfigModelRoutes";
import { handlePersonalConfigResponseRoutes } from "@/utils/discord/interactions/personalConfigResponseRoutes";
import { handlePersonalConfigSpotlightRoutes } from "@/utils/discord/interactions/personalConfigSpotlightRoutes";

const defaultDependencies: PersonalConfigRouteDependencies = {
  resolveScope,
  loadPersonaNamingPreference,
  getPersonaAvatarData: resolvePersonaPanelAvatar,
  getMemoryCount,
  getStmCount,
  loadUserSavedProviders,
  loadPersonalModelDisplayInfo,
  loadAvailableModelsForCapability,
  loadActiveSpotlights: (serverId, userId) => userRepository.getActivePersonalSpotlightsForUser(serverId, userId),
  loadGuildPersonas: async (guildId) => {
    const allPersonas: TomoriState[] = await getCachedAllPersonas(guildId);
    return (
      allPersonas
        .filter((p): p is TomoriState & { persona_id: number } => typeof p.persona_id === "number")
        // Spotlight selection travels as a positional bitmask over this list, so the order must not
        // depend on cache population order between the modal and its confirmation.
        .sort((left, right) => left.persona_id - right.persona_id)
        .map((p) => ({
          id: p.persona_id,
          name: p.persona_nickname,
          isAlter: Boolean(p.is_alter),
        }))
    );
  },
  loadTomoriState: async (guildId) => getCachedTomoriState(guildId),
  loadServerTriggerBehavior: async (guildId) => {
    try {
      const tomoriState = await getCachedTomoriState(guildId);
      if (!tomoriState?.config) return null;
      return {
        deliberate_trigger_mode: Boolean(tomoriState.config.deliberate_trigger_mode),
        deliberate_tool_mode: Boolean(tomoriState.config.deliberate_tool_mode),
      };
    } catch {
      return null;
    }
  },
  operations: personalConfigOperations,
  recordAction: (input) => {
    void recordPanelActionStat(input);
  },
  createNonce,
  showLanguageModal: (interaction, locale, nonce, currentLanguage) =>
    showRoutedRawModal(interaction, buildLanguageModal(locale, nonce, currentLanguage)),
  showTimezoneModal: (interaction, locale, nonce, currentOffset) =>
    showRoutedRawModal(interaction, buildTimezoneModal(locale, nonce, currentOffset)),
  showNamingModal: (interaction, locale, nonce, current) =>
    showRoutedRawModal(interaction, buildNamingModal(locale, nonce, current)),
  showPersonaNamingModal: (interaction, locale, lineageId, nonce, current) =>
    showRoutedRawModal(interaction, buildPersonaNamingModal(locale, lineageId, nonce, current)),
  showAboutModal: (interaction, locale, nonce, current) =>
    showRoutedRawModal(interaction, buildAboutModal(locale, nonce, current)),
  showAppearanceModal: (interaction, locale, nonce, currentTags) =>
    showRoutedRawModal(interaction, buildAppearanceModal(locale, nonce, currentTags)),
  showCharacterReferenceModal: (interaction, locale, nonce) =>
    showRoutedRawModal(interaction, buildCharacterReferenceModal(locale, nonce)),
  showPrivacyLevelModal: (interaction, locale, nonce, currentLevel) =>
    showRoutedRawModal(interaction, buildPrivacyLevelModal(locale, nonce, currentLevel)),
  showQuickToggleModal: (interaction, locale, nonce, savedProviders) =>
    showRoutedRawModal(interaction, buildQuickToggleModal(locale, nonce, savedProviders)),
  showModelSelectModal: (interaction, locale, nonce, capability, provider, availableModels, currentModelId) =>
    showRoutedRawModal(
      interaction,
      buildModelSelectModal(locale, nonce, capability, provider, availableModels, currentModelId),
    ),
  showParameters1Modal: (interaction, locale, nonce, provider, currentConfig) =>
    showRoutedRawModal(interaction, buildParameters1Modal(locale, nonce, provider, currentConfig)),
  showParameters2Modal: (interaction, locale, nonce, provider, currentConfig) =>
    showRoutedRawModal(interaction, buildParameters2Modal(locale, nonce, provider, currentConfig)),
  showFallbacksModal: (interaction, locale, nonce, provider, availableOptions, currentRefs) =>
    showRoutedRawModal(interaction, buildFallbacksModal(locale, nonce, provider, availableOptions, currentRefs)),
  showImpersonationModal: (interaction, locale, nonce, currentPrompt) =>
    showRoutedRawModal(interaction, buildImpersonationModal(locale, nonce, currentPrompt)),
  showSpotlightStep1Modal: (interaction, locale, nonce) =>
    showRoutedRawModal(interaction, buildSpotlightStep1Modal(locale, nonce)),
  showSpotlightSetModal: (interaction, locale, nonce, channelId, hours, blockIdx, fp, personas) =>
    showRoutedRawModal(interaction, buildSpotlightSetModal(locale, nonce, channelId, hours, blockIdx, fp, personas)),
  showSpotlightAutoTriggerModal: (interaction, locale, nonce, channelId, hours, blockIdx, mask, fp, selectedPersonas) =>
    showRoutedRawModal(
      interaction,
      buildSpotlightAutoTriggerModal(locale, nonce, channelId, hours, blockIdx, mask, fp, selectedPersonas),
    ),
  showSpotlightRemoveModal: (interaction, locale, nonce, start, fp, activeSpotlights, personas, guildChannels) =>
    showRoutedRawModal(
      interaction,
      buildSpotlightRemoveModal(locale, nonce, start, fp, activeSpotlights, personas, guildChannels),
    ),
};

export function createPersonalConfigInteractionRoute(
  overrides: Partial<PersonalConfigRouteDependencies> = {},
): GlobalInteractionRoute {
  const dependencies: PersonalConfigRouteDependencies = {
    ...defaultDependencies,
    ...overrides,
  };

  return {
    namespace: PERSONAL_CONFIG_ROUTE_NAMESPACE,
    version: PERSONAL_CONFIG_ROUTE_VERSION,
    async execute(_client, interaction, parsed): Promise<void> {
      const route = parsePersonalConfigPanelRoute(parsed);
      if (!route) throw new Error(`Malformed personal config panel route: ${interaction.customId}`);

      const handled = await handlePersonalConfigModalOpen({
        interaction,
        route,
        dependencies,
      });
      if (handled === "handled") return;

      const initialScope = await beginPanelInteraction(interaction, {
        authorize: () => true,
        onDenied: () => Promise.resolve(),
        load: () => dependencies.resolveScope(interaction, route.action === "retry" || route.action === "refresh"),
        onMissing: () => interaction.editReply(terminalPayload(route.locale, "commands.personal.config.unavailable")),
      });
      if (!initialScope) return;
      let scope = initialScope;

      const postDeferContext: PersonalConfigPostDeferContext = {
        interaction,
        route,
        dependencies,
        get scope() {
          return scope;
        },
        set scope(next) {
          scope = next;
        },
      };

      if (await handlePersonalConfigNavigation(postDeferContext)) {
        return;
      }

      if (await handlePersonalConfigProfileWrites(postDeferContext)) {
        return;
      }

      if (await handlePersonalConfigModelRoutes(postDeferContext)) {
        return;
      }

      if (await handlePersonalConfigResponseRoutes(postDeferContext)) {
        return;
      }

      if (await handlePersonalConfigSpotlightRoutes(postDeferContext)) {
        return;
      }
    },
  };
}

export const personalConfigInteractionRoute = createPersonalConfigInteractionRoute();

const IDENTITY_CONFIG_ACTIONS = new Set([
  "page",
  "persona-select",
  "retry",
  "refresh",
  "naming-open",
  "naming-submit",
  "about-open",
  "about-submit",
  "persona-naming-open",
  "persona-naming-submit",
  "appearance-open",
  "appearance-submit",
  "character-reference-open",
  "character-reference-submit",
  "character-reference-clear",
]);

export const identityConfigInteractionRoute: GlobalInteractionRoute = {
  namespace: PERSONAL_CONFIG_ROUTE_NAMESPACE,
  version: IDENTITY_CONFIG_VERSION,
  async execute(client, interaction, parsed) {
    const managedRoute = parseManagedIdentityRoute(parsed, PERSONAL_CONFIG_ROUTE_VERSION);
    const route = managedRoute && parsePersonalConfigPanelRoute(managedRoute.original);
    if (
      !managedRoute ||
      !route ||
      !IDENTITY_CONFIG_ACTIONS.has(route.action) ||
      ("category" in route && route.category !== "profile") ||
      ("page" in route && !["general", "persona", "appearance"].includes(route.page)) ||
      (route.action === "page" &&
        (!interaction.isStringSelectMenu() ||
          !["general", "persona", "appearance"].includes(interaction.values[0] ?? "")))
    ) {
      await interaction.reply({
        content: localizer(interaction.locale, "commands.personal.config.unavailable"),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const identityId = managedRoute.identityId;
    const modal = <T extends { custom_id: string }>(value: T): T => {
      rewriteManagedIdentityRouteIds(
        value,
        PERSONAL_CONFIG_ROUTE_NAMESPACE,
        PERSONAL_CONFIG_ROUTE_VERSION,
        IDENTITY_CONFIG_VERSION,
        identityId,
      );
      return value;
    };
    const identityRoute = createPersonalConfigInteractionRoute({
      resolveScope: (target) => resolveIdentityConfigScope(target, identityId),
      showNamingModal: (target, locale, nonce, current) =>
        showRoutedRawModal(target, modal(buildNamingModal(locale, nonce, current))),
      showPersonaNamingModal: (target, locale, lineageId, nonce, current) =>
        showRoutedRawModal(target, modal(buildPersonaNamingModal(locale, lineageId, nonce, current))),
      showAboutModal: (target, locale, nonce, current) =>
        showRoutedRawModal(target, modal(buildAboutModal(locale, nonce, current))),
      showAppearanceModal: (target, locale, nonce, tags) =>
        showRoutedRawModal(target, modal(buildAppearanceModal(locale, nonce, tags))),
      showCharacterReferenceModal: (target, locale, nonce) =>
        showRoutedRawModal(target, modal(buildCharacterReferenceModal(locale, nonce))),
    });
    await identityRoute.execute(client, interaction, managedRoute.original);
  },
};

export type PersonalConfigPanelPayloadOrTerminal =
  | ReturnType<typeof buildPersonalConfigPanelPayload>
  | InteractionEditReplyOptions;

export async function buildInitialPersonalConfigPanel(
  interaction: ChatInputCommandInteraction,
  locale: string,
  dependenciesOverride?: Partial<PersonalConfigRouteDependencies>,
  identityId?: number,
): Promise<PersonalConfigPanelPayloadOrTerminal> {
  const dependencies: PersonalConfigRouteDependencies = {
    ...defaultDependencies,
    ...dependenciesOverride,
  };
  const scope = identityId
    ? await resolveIdentityConfigScope(interaction, identityId)
    : await dependencies.resolveScope(interaction);
  if (!scope) {
    return terminalPayload(locale, "commands.personal.config.unavailable") as PersonalConfigPanelPayloadOrTerminal;
  }
  return withPersonaPanelAvatar(
    buildScopedPersonalConfigPanelPayload(
      {
        locale,
        identityMode: Boolean(scope.identityId),
        identityLabel: scope.identityLabel,
        category: "profile",
        page: "general",
        user: scope.user,
        resolvedNickname: scope.resolvedNickname,
        personas: scope.personas,
        guildId: scope.guildId,
        userAvatarUrl: scope.identityId ? scope.identityAvatarUrl : resolveInvokerAvatarUrl(interaction),
        // Only the privacy page renders these, and the panel always opens on profile, so the counts are
        // never read here. Changing the opening category means fetching them, as `repaint` does.
        memoryCount: 0,
        stmCount: 0,
        readStatus: scope.readStatus,
      },
      scope,
    ),
  );
}
