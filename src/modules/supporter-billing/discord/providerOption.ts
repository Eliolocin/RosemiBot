import {
  ButtonStyle,
  ComponentType,
  type ButtonComponentData,
  type ComponentInContainerData,
  type ActionRowData,
} from "discord.js";
import { z } from "zod";
import {
  isSupporterBillingEnabled,
  SUPPORTER_PROVIDER_VALUE,
  type SupporterCapability,
} from "@/modules/supporter-billing/config";
import {
  isSupporterEntitlementActive,
  supporterCapabilityMarkerRepository,
  supporterEntitlementRepository,
  supporterIdentityRepository,
  supporterSponsorshipRepository,
} from "@/modules/supporter-billing/db";
import {
  ensureSupporterEntry,
  getSupporterSponsorshipValidationFailureKey,
  isSupporterSponsorshipChoiceEnabled,
  parseSupporterBillingConfigForCommands,
  persistSupporterSponsorship,
  validateSupporterSponsorshipRequest,
} from "@/modules/supporter-billing/discord/sponsorship";
import { createPatreonOAuthUrlForDiscordUser } from "@/modules/supporter-billing/patreon/oauth";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import { validateSupporterModelRegistration } from "@/modules/supporter-billing/runtime/managedProvider";
import { buildSubscriptionRouteId } from "@/modules/supporter-billing/subscribe/catalog";
import {
  refreshSubscriptionMembership,
  showSubscriptionSurface,
} from "@/modules/supporter-billing/subscribe/components";
import { buildSubscriptionOnboarding, getSubscriptionTierName } from "@/modules/supporter-billing/subscribe/panel";
import { loadSubscribePanelState } from "@/modules/supporter-billing/subscribe/state";
import {
  getSubscriptionAllowanceBlockKey,
  loadSubscriptionAllowance,
} from "@/modules/supporter-billing/subscribe/usage";
import { resolveEnvironment } from "@/types/config";
import type { FallbackModelRef, SubscriptionCapability } from "@/types/db/schema";
import type { PanelReceipt } from "@/types/discord/panel";
import type { ProviderPanelCapability } from "@/types/discord/providerPanel";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCacheStore";
import { getCachedUserRow } from "@/utils/cache/userCache";
import { llmProviderRepo } from "@/utils/db/repositories";
import { setHostedSpeechSelection } from "@/utils/db/repositories/SpeechRepository";
import { parseInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import { PERSONAL_PROVIDERS_ROUTE_NAMESPACE } from "@/utils/discord/providersPanelCatalog";
import { log } from "@/utils/misc/logger";
import { getActivePersonalProviderForCapability } from "@/utils/provider/personalProviderHelpers";
import {
  registerProviderOption,
  registerProviderOptionFallbackRefOwner,
  type ProviderOptionActionContext,
  type ProviderOptionCapability,
  type ProviderOptionDefinition,
  type ProviderOptionEntryContext,
  type ProviderOptionReadiness,
  type ProviderOptionRemovalStatus,
  type ProviderOptionScope,
  type ProviderOptionSetupContext,
  type ProviderOptionStoredSelection,
} from "@/utils/provider/providerOptionRegistry";
import { escapeDiscordMarkdown } from "@/utils/text/discordMarkdown";
import { localizer } from "@/utils/text/localizer";

const supporterProviderOptionDataSchema = z.object({
  sponsorshipId: z.number().int().positive().optional(),
  sponsorDiscId: z.string().optional(),
  sponsorLabel: z.string().optional(),
});
export type SupporterProviderOptionData = z.infer<typeof supporterProviderOptionDataSchema>;

const FUNDED_MARKERS: Partial<Record<ProviderOptionCapability, SubscriptionCapability>> = {
  text: "text",
  vision: "vision",
  embedding: "embedding",
  image: "image",
  video: "video",
  reviewer: "reviewer",
  "speech-design": "speech_design",
  "speech-clone": "speech_clone",
};

// Text and speech writes store their payer in the same statement as the model, so only these need a marker write.
const SEPARATELY_MARKED = new Set<ProviderOptionCapability>(["vision", "embedding", "image", "video", "reviewer"]);

const PANEL_FUNDING_CAPABILITIES: Partial<Record<ProviderPanelCapability, SupporterCapability>> = {
  text: "text",
  image: "image",
  embedding: "embedding",
  video: "video",
  decision: "decision",
  speech: "voice",
};

function billingAvailable(): boolean {
  return isSupporterBillingEnabled(resolveEnvironment());
}

function readOptionData(value: unknown): SupporterProviderOptionData {
  const parsed = supporterProviderOptionDataSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

async function loadServerSelection(scope: ProviderOptionScope): Promise<ProviderOptionStoredSelection | null> {
  const sponsorship = await supporterSponsorshipRepository.loadActiveSponsorshipForServer(scope.ownerId);
  if (!sponsorship) return null;
  const sponsor = await supporterIdentityRepository.loadById(sponsorship.sponsor_identity_id);
  const sponsorUser = sponsor ? await getCachedUserRow(sponsor.discord_user_id) : null;
  const data: SupporterProviderOptionData = {
    sponsorshipId: sponsorship.sponsorship_id,
    sponsorDiscId: sponsor?.discord_user_id,
    sponsorLabel: sponsorUser?.user_nickname ?? undefined,
  };
  return { savedAt: sponsorship.created_at, data };
}

async function loadPersonalSelection(scope: ProviderOptionScope): Promise<ProviderOptionStoredSelection | null> {
  const saved = await llmProviderRepo.loadUserSavedProviderConfig(scope.ownerId, SUPPORTER_PROVIDER_VALUE);
  if (saved) return { savedAt: saved.updated_at ?? saved.saved_at ?? null, data: {} };
  const identity = scope.discordId
    ? await supporterIdentityRepository.loadByDiscordUserId(scope.discordId)
    : await supporterIdentityRepository.loadByUserId(scope.ownerId);
  const entitlement = identity
    ? await supporterEntitlementRepository.loadByIdentityId(identity.supporter_identity_id)
    : null;
  return entitlement && isSupporterEntitlementActive(entitlement) ? { savedAt: null, data: {} } : null;
}

async function ensureSelection(scope: ProviderOptionScope): Promise<boolean> {
  if (scope.kind === "personal") {
    return ensureSupporterEntry({
      kind: "personal",
      userId: scope.ownerId,
      serverDiscId: scope.discordId ?? "",
      state: scope.state ?? null,
    });
  }
  if (!scope.state) return false;
  return ensureSupporterEntry({
    kind: "server",
    serverId: scope.ownerId,
    serverDiscId: scope.discordId ?? "",
    state: scope.state,
  });
}

/** Personal ownership moves with each row's enabled capabilities, so only the server marker is written here. */
async function setFunded(
  scope: ProviderOptionScope,
  capability: ProviderOptionCapability,
  funded: boolean,
): Promise<boolean> {
  const marker = FUNDED_MARKERS[capability];
  if (scope.kind === "personal" || !marker || !SEPARATELY_MARKED.has(capability)) return true;
  try {
    const serverDiscId = await supporterCapabilityMarkerRepository.setServerCapabilityFunded(
      scope.ownerId,
      marker,
      funded,
    );
    if (serverDiscId === null) return false;
    invalidateTomoriStateCache(serverDiscId);
    return true;
  } catch (error) {
    await log.error("Subscription capability marker write failed", error, {
      metadata: { serverId: scope.ownerId, capability: marker, funded },
    });
    return false;
  }
}

function ownsCapability(scope: ProviderOptionScope, capability: ProviderOptionCapability): boolean {
  const marker = FUNDED_MARKERS[capability];
  return (
    scope.kind === "server" && !!marker && (scope.state?.config.subscription_capabilities.includes(marker) ?? false)
  );
}

async function removeSelection(scope: ProviderOptionScope): Promise<ProviderOptionRemovalStatus> {
  if (scope.kind === "personal") {
    const configs = await llmProviderRepo.loadUserSavedProviderConfigs(scope.ownerId);
    if (getActivePersonalProviderForCapability(configs, "text")?.provider === SUPPORTER_PROVIDER_VALUE) return "active";
    return (await llmProviderRepo.deleteUserProviderRegistration(scope.ownerId, SUPPORTER_PROVIDER_VALUE))
      ? "removed"
      : "not-found";
  }
  if (ownsCapability(scope, "text")) return "active";
  return (await llmProviderRepo.deleteServerProviderRegistration(scope.ownerId, SUPPORTER_PROVIDER_VALUE))
    ? "removed"
    : "not-found";
}

async function validateModel(input: {
  scope: ProviderOptionScope;
  capability: ProviderPanelCapability;
  modelCodename: string;
}): Promise<boolean> {
  const capability = PANEL_FUNDING_CAPABILITIES[input.capability];
  if (!capability) return false;
  try {
    await validateSupporterModelRegistration({
      scope:
        input.scope.kind === "personal"
          ? { kind: "personal", userId: input.scope.ownerId }
          : { kind: "server", serverId: input.scope.ownerId },
      capability,
      modelCodename: input.modelCodename,
    });
    return true;
  } catch (error) {
    if (error instanceof SupporterRequestDeniedError) return false;
    throw error;
  }
}

function isPersonalPanel(context: ProviderOptionActionContext): boolean {
  return (
    "customId" in context.interaction &&
    parseInteractionRoute(context.interaction.customId)?.namespace === PERSONAL_PROVIDERS_ROUTE_NAMESPACE
  );
}

async function handlePanelAction(action: "select" | "edit", context: ProviderOptionActionContext): Promise<boolean> {
  const personal = isPersonalPanel(context);
  if (action === "edit" && !billingAvailable()) return false;
  if (action === "select" && !personal && !context.interaction.guildId) return false;
  await showSubscriptionSurface(context.interaction.client, context.interaction, context.locale, {
    ...(action === "edit" ? { account: true } : {}),
    origin: personal ? "personal" : action === "edit" ? "server" : "sponsor",
  });
  return true;
}

function entryActions(context: ProviderOptionEntryContext): ActionRowData<ButtonComponentData> {
  const personal = context.scope.kind === "personal";
  const data = readOptionData(context.data);
  const viewerId = context.scope.discordId;
  const route = {
    locale: context.locale,
    owner: viewerId ?? "0",
    origin: personal ? "personal" : "server",
    selection: data.sponsorshipId ?? 0,
    page: 0,
  } as const;
  const buttons: ButtonComponentData[] = [];
  if (personal || (viewerId && data.sponsorDiscId === viewerId)) {
    buttons.push({
      type: ComponentType.Button,
      style: ButtonStyle.Secondary,
      customId: buildSubscriptionRouteId({ ...route, action: "overview" }),
      label: localizer(context.locale, "commands.providers.manage_subscription"),
      disabled: !viewerId,
    });
  }
  if (!personal) {
    buttons.push({
      type: ComponentType.Button,
      style: ButtonStyle.Danger,
      customId: buildSubscriptionRouteId({ ...route, action: "remove" }),
      label: localizer(context.locale, "commands.providers.remove_sponsorship"),
      disabled: !data.sponsorshipId || !viewerId || !(context.canManageServer || data.sponsorDiscId === viewerId),
    });
  }
  return { type: ComponentType.ActionRow, components: buttons };
}

function entryComponents(context: ProviderOptionEntryContext): ComponentInContainerData[] {
  if (context.scope.kind === "personal") return [];
  const data = readOptionData(context.data);
  const name = data.sponsorDiscId
    ? (data.sponsorLabel ?? data.sponsorDiscId)
    : localizer(context.locale, "commands.providers.unknown_sponsor");
  return [
    {
      type: ComponentType.TextDisplay,
      content: `> ${localizer(context.locale, "commands.providers.sponsorship_by", { name: escapeDiscordMarkdown(name) })}`,
    },
  ];
}

function entryOwned(context: ProviderOptionEntryContext): boolean {
  const viewerId = context.scope.discordId;
  return context.scope.kind === "server" && !!viewerId && readOptionData(context.data).sponsorDiscId === viewerId;
}

interface SetupSubscriptionView {
  ready: boolean;
  tier: string;
  model?: string;
  manageUrl: string;
  oauthUrl?: string;
  fundingServer: string;
}

// Readiness and components share one render context, so the membership and allowance reads run once per render.
const setupViews = new WeakMap<ProviderOptionSetupContext, Promise<SetupSubscriptionView | null>>();

async function loadSetupView(context: ProviderOptionSetupContext): Promise<SetupSubscriptionView | null> {
  const { draft, locale } = context;
  try {
    const config = parseSupporterBillingConfigForCommands();
    const state = await loadSubscribePanelState(draft.actorDiscId);
    const tier = state.kind === "active" ? config.tiers[state.entitlement.tier_key] : undefined;
    const allowance =
      state.kind === "active" ? await loadSubscriptionAllowance(state.identity, state.entitlement) : null;
    const ready = !!tier && !!allowance?.remaining;
    return {
      ready,
      tier: tier ? getSubscriptionTierName(locale, tier) : "",
      model: tier?.defaultModelByCapability.text,
      manageUrl: config.patreon.manageUrl,
      oauthUrl: ready ? undefined : await createPatreonOAuthUrlForDiscordUser(draft.actorDiscId, { config, locale }),
      fundingServer: context.interaction?.guild?.name ?? draft.workspaceKey,
    };
  } catch (error) {
    log.warn("Subscription setup onboarding could not be loaded", error);
    return null;
  }
}

function setupView(context: ProviderOptionSetupContext): Promise<SetupSubscriptionView | null> {
  let view = setupViews.get(context);
  if (!view) {
    view = loadSetupView(context);
    setupViews.set(context, view);
  }
  return view;
}

async function revalidateSetupFunding(context: ProviderOptionSetupContext): Promise<ProviderOptionReadiness> {
  const validation = await validateSupporterSponsorshipRequest({
    discordUserId: context.draft.actorDiscId,
    serverId: null,
    serverDiscId: context.draft.workspaceKey,
  });
  if (!validation.ok)
    return { ready: false, reasonKey: getSupporterSponsorshipValidationFailureKey(validation.reason) };
  const allowance = await loadSubscriptionAllowance(validation.identity, validation.entitlement).catch(
    (error: unknown) => {
      log.warn("[Setup] Subscription allowance unavailable at finish", error);
      return null;
    },
  );
  const blockKey = getSubscriptionAllowanceBlockKey(allowance);
  return blockKey ? { ready: false, reasonKey: blockKey } : { ready: true };
}

async function setupComponents(context: ProviderOptionSetupContext): Promise<ComponentInContainerData[]> {
  const view = await setupView(context);
  if (!view || !context.actionRouteId) {
    return [
      { type: ComponentType.TextDisplay, content: localizer(context.locale, "commands.subscription.unavailable") },
    ];
  }
  return buildSubscriptionOnboarding({ ...view, locale: context.locale, continueId: context.actionRouteId });
}

async function refreshSetupMembership(context: ProviderOptionSetupContext): Promise<PanelReceipt | undefined> {
  try {
    return await refreshSubscriptionMembership(context.draft.actorDiscId, context.locale);
  } catch {
    return {
      tone: "error",
      heading: localizer(context.locale, "commands.subscription.name"),
      detail: localizer(context.locale, "commands.subscription.action_failed"),
    };
  }
}

export const supporterProviderOption: ProviderOptionDefinition = {
  value: SUPPORTER_PROVIDER_VALUE,
  catalogProvider: "openrouter",
  capabilities: [
    "text",
    "vision",
    "embedding",
    "image",
    "video",
    "decision",
    "reviewer",
    "speech-design",
    "speech-clone",
  ],
  copy: {
    labelKey: "commands.providers.subscription_label",
    entryDescriptionKeys: {
      server: "commands.providers.subscription_server_description",
      personal: "commands.providers.subscription_personal_description",
      owned: "commands.providers.subscription_owned_description",
    },
    addActionLabelKey: "commands.providers.subscribe",
    addActionDescriptionKeys: {
      server: "commands.providers.sponsor_server_description",
      personal: "commands.providers.subscribe_personal_description",
    },
    removeImpactKey: "commands.providers.remove_impact_subscription",
    modelDescriptionKey: "commands.providers.subscription_model_description",
  },
  availability: () =>
    billingAvailable() ? { eligible: true } : { eligible: false, reasonKey: "commands.providers.unavailable" },
  selection: {
    load: (scope) => (scope.kind === "personal" ? loadPersonalSelection(scope) : loadServerSelection(scope)),
    ensure: ensureSelection,
    claim: (scope, capability) => setFunded(scope, capability, true),
    release: (scope, capability) => setFunded(scope, capability, false),
    setSpeech: (input) =>
      setHostedSpeechSelection(
        { kind: input.scope.kind, ownerId: input.scope.ownerId },
        input.modelId,
        input.mode,
        input.register ?? false,
        input.replacedModelId,
        SUPPORTER_PROVIDER_VALUE,
      ),
    remove: removeSelection,
    owns: ownsCapability,
    validateModel,
  },
  panel: {
    entryComponents,
    entryActions,
    entryOwned,
    handleAction: handlePanelAction,
  },
  setup: {
    optionLabelKey: "commands.setup.wizard.provider_option_supporter",
    optionDescriptionKey: "commands.setup.wizard.provider_option_supporter_description",
    summaryKey: "commands.setup.wizard.provider_supporter_summary",
    receiptDescriptionKey: "commands.setup.wizard.receipt_desc_supporter",
    available: ({ context }) => isSupporterSponsorshipChoiceEnabled({ isGuildContext: context === "guild" }),
    ready: async (context) =>
      context.interaction ? { ready: (await setupView(context))?.ready ?? false } : revalidateSetupFunding(context),
    components: setupComponents,
    committed: async ({ draft, serverId, workspaceKey }) => {
      const validation = await validateSupporterSponsorshipRequest({
        discordUserId: draft.actorDiscId,
        serverId: null,
        serverDiscId: workspaceKey,
      });
      if (!validation.ok) throw new Error(`Subscription setup funding became unavailable: ${validation.reason}`);
      await persistSupporterSponsorship({
        serverId,
        serverDiscId: workspaceKey,
        sponsorIdentityId: validation.identity.supporter_identity_id,
        createdByDiscId: draft.actorDiscId,
      });
    },
    handleAction: refreshSetupMembership,
  },
};

function supporterFallbackRefOwner(ref: FallbackModelRef): string | null {
  return ref.type === "llm" && ref.credentialProvider === SUPPORTER_PROVIDER_VALUE ? SUPPORTER_PROVIDER_VALUE : null;
}

export function registerSupporterProviderOption(): () => void {
  const disposeOption = registerProviderOption(supporterProviderOption);
  const disposeFallbackOwner = registerProviderOptionFallbackRefOwner(supporterFallbackRefOwner);
  return () => {
    disposeFallbackOwner();
    disposeOption();
  };
}
