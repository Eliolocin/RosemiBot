import { ComponentType, MessageFlags, type ChatInputCommandInteraction, type Client } from "discord.js";
import { isSupporterBillingEnabled } from "@/modules/supporter-billing/config";
import {
  parseSupporterBillingConfigForCommands,
  ensurePersonalSupporterDefaults,
  getSupporterSponsorshipValidationFailureKey,
  persistSupporterSponsorship,
  validateSupporterSponsorshipRequest,
} from "@/modules/supporter-billing/discord/sponsorship";
import {
  supporterIdentityRepository,
  supporterEntitlementRepository,
  supporterSponsorshipRepository,
  supporterUsageStatisticsRepository,
  SponsorshipConflictError,
} from "@/modules/supporter-billing/db";
import { createPatreonOAuthUrlForDiscordUser } from "@/modules/supporter-billing/patreon/oauth";
import { refreshPatreonEntitlementForIdentity } from "@/modules/supporter-billing/patreon/reconcile";
import { loadSubscribePanelState } from "@/modules/supporter-billing/subscribe/state";
import {
  getSubscriptionAllowanceBlockKey,
  loadSubscriptionAllowance,
} from "@/modules/supporter-billing/subscribe/usage";
import { buildSubscribePanel, type SubscriptionPanelInput } from "@/modules/supporter-billing/subscribe/panel";
import {
  SUBSCRIPTION_NAMESPACE,
  SUBSCRIPTION_VERSION,
  parseSubscriptionRoute,
  type SubscriptionRoute,
  type SubscriptionOrigin,
} from "@/modules/supporter-billing/subscribe/catalog";
import { resolveEnvironment } from "@/types/config";
import type { PanelReceipt } from "@/types/discord/panel";
import type { GlobalInteractionRoute, GlobalRoutableInteraction } from "@/utils/discord/interactions/routeRegistry";
import { beginPanelInteraction, deliverGuardedPanel } from "@/utils/discord/interactions/panelController";
import { buildPanelContainer } from "@/utils/discord/ui/panel";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { getCachedUserRow } from "@/utils/cache/userCache";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCacheStore";
import { invalidateAllChannelLlmCacheForServer } from "@/utils/cache/channelLlmCacheStore";
import { localizer } from "@/utils/text/localizer";
import { log } from "@/utils/misc/logger";

export type SubscriptionInteraction = GlobalRoutableInteraction | ChatInputCommandInteraction;

function managesServer(interaction: SubscriptionInteraction): boolean {
  return !!interaction.guildId && (interaction.memberPermissions?.has("ManageGuild") ?? false);
}

async function loadSubscriptionPanelInput(
  interaction: SubscriptionInteraction,
  route: SubscriptionRoute,
): Promise<SubscriptionPanelInput> {
  const config = parseSupporterBillingConfigForCommands();
  const state = await loadSubscribePanelState(interaction.user.id, {
    resolveServerLabel: (id) =>
      interaction.client.guilds.cache.get(id)?.name ??
      localizer(route.locale, "commands.subscription.unknown_server", { id }),
    resolveServerIcon: (id) => interaction.client.guilds.cache.get(id)?.iconURL() ?? null,
  });
  const input: SubscriptionPanelInput = {
    route,
    state,
    config,
    avatarUrl: interaction.user.displayAvatarURL(),
    resolveServerLabel: (id) => interaction.client.guilds.cache.get(id)?.name,
  };
  if (route.action === "remove" || route.action === "confirm") {
    const sponsorship = await supporterSponsorshipRepository.loadActiveSponsorshipById(route.selection);
    if (sponsorship) {
      const ownedByViewer =
        (state.kind === "active" || state.kind === "inactive") &&
        state.identity.supporter_identity_id === sponsorship.sponsor_identity_id;
      if (ownedByViewer || (managesServer(interaction) && interaction.guildId === sponsorship.server_disc_id))
        input.removal = {
          serverLabel:
            input.resolveServerLabel?.(sponsorship.server_disc_id) ??
            localizer(route.locale, "commands.subscription.unknown_server", { id: sponsorship.server_disc_id }),
          ownedByViewer,
        };
    }
  }
  if (state.kind === "active" && ["overview", "usage", "models", "servers", "refresh"].includes(route.action)) {
    try {
      input.allowance = await loadSubscriptionAllowance(state.identity, state.entitlement);
      if (input.allowance && ["usage", "models", "servers"].includes(route.action))
        input.aggregates = await supporterUsageStatisticsRepository.aggregatePeriod(
          state.identity.supporter_identity_id,
          input.allowance.start,
          input.allowance.end,
        );
    } catch {
      input.allowance = null;
      input.receipt = receipt(route.locale, "commands.subscription.unavailable", true);
    }
  }
  return input;
}

function receipt(
  locale: string,
  detailKey: string,
  failure = false,
  vars?: Record<string, string | number>,
): PanelReceipt {
  return {
    tone: failure ? "error" : "info",
    heading: localizer(locale, "commands.subscription.name"),
    detail: localizer(locale, detailKey, vars),
  };
}

const refreshAttempts = new Map<string, { expiresAt: number; inFlight: boolean }>();
const MAX_REFRESH_ATTEMPTS = 10_000;

export async function refreshSubscriptionMembership(
  discordUserId: string,
  locale: string,
): Promise<PanelReceipt | undefined> {
  const config = parseSupporterBillingConfigForCommands();
  const now = Date.now();
  for (const [id, attempt] of refreshAttempts)
    if (!attempt.inFlight && attempt.expiresAt <= now) refreshAttempts.delete(id);
  const cooldownMs = config.jobs.manualRefreshCooldownSeconds * 1000;
  const attempt = refreshAttempts.get(discordUserId);
  const cooldownReceipt = (expires: number) =>
    receipt(locale, "commands.subscription.cooldown", false, {
      time: `<t:${Math.floor(expires / 1000)}:R>`,
    });
  if (attempt) return cooldownReceipt(Math.max(attempt.expiresAt, now + (attempt.inFlight ? cooldownMs : 0)));
  if (refreshAttempts.size >= MAX_REFRESH_ATTEMPTS) return cooldownReceipt(now + cooldownMs);
  const currentAttempt = { expiresAt: now + cooldownMs, inFlight: true };
  refreshAttempts.set(discordUserId, currentAttempt);
  let attemptedRemote = false;
  try {
    const identity = await supporterIdentityRepository.loadByDiscordUserId(discordUserId);
    if (!identity) {
      refreshAttempts.delete(discordUserId);
      return undefined;
    }
    const entitlement = await supporterEntitlementRepository.loadByIdentityId(identity.supporter_identity_id);
    if (!entitlement) {
      refreshAttempts.delete(discordUserId);
      return undefined;
    }
    const next = entitlement.last_verified_at.getTime() + cooldownMs;
    if (next > now) {
      currentAttempt.expiresAt = next;
      return cooldownReceipt(next);
    }
    attemptedRemote = true;
    await refreshPatreonEntitlementForIdentity({ config, identity, env: process.env, now: new Date() });
    return receipt(locale, "commands.subscription.checked");
  } catch {
    log.warn("Subscription membership refresh failed");
    return receipt(locale, "commands.subscription.refresh_failed", true);
  } finally {
    currentAttempt.inFlight = false;
    if (attemptedRemote) currentAttempt.expiresAt = Date.now() + cooldownMs;
  }
}

export class SubscriptionActivationError extends Error {
  constructor(readonly detailKey: string) {
    super("Subscription activation was refused");
    this.name = "SubscriptionActivationError";
  }
}

async function activateServerSubscription(interaction: SubscriptionInteraction): Promise<void> {
  if (!managesServer(interaction) || !interaction.guildId) throw new Error("Server-management permission required");
  const state = await getCachedTomoriState(interaction.guildId);
  if (!state) throw new Error("Server setup required");
  const validation = await validateSupporterSponsorshipRequest({
    discordUserId: interaction.user.id,
    serverId: state.server_id,
    serverDiscId: interaction.guildId,
  });
  if (!validation.ok)
    throw new SubscriptionActivationError(getSupporterSponsorshipValidationFailureKey(validation.reason));
  const blockKey = getSubscriptionAllowanceBlockKey(
    await loadSubscriptionAllowance(validation.identity, validation.entitlement),
  );
  if (blockKey) throw new SubscriptionActivationError(blockKey);
  if (!managesServer(interaction)) throw new Error("Server-management permission required");
  await persistSupporterSponsorship({
    serverId: state.server_id,
    serverDiscId: interaction.guildId,
    sponsorIdentityId: validation.identity.supporter_identity_id,
    createdByDiscId: interaction.user.id,
  });
}

async function activatePersonalSubscription(interaction: SubscriptionInteraction): Promise<void> {
  const [user, state] = await Promise.all([
    getCachedUserRow(interaction.user.id),
    getCachedTomoriState(interaction.guildId ?? interaction.user.id),
  ]);
  if (!user?.user_id) throw new Error("Personal workspace required");
  await ensurePersonalSupporterDefaults({
    kind: "personal",
    userId: user.user_id,
    serverDiscId: interaction.guildId ?? interaction.user.id,
    state,
  });
}

async function revokeSubscriptionSponsorship(interaction: SubscriptionInteraction, sponsorshipId: number) {
  const active = await supporterSponsorshipRepository.loadActiveSponsorshipById(sponsorshipId);
  if (!active) return null;
  const identity = await supporterIdentityRepository.loadByDiscordUserId(interaction.user.id);
  const owns = identity?.supporter_identity_id === active.sponsor_identity_id;
  if (!owns && !(managesServer(interaction) && interaction.guildId === active.server_disc_id)) return null;
  const revoked = owns
    ? await supporterSponsorshipRepository.revokeActiveSponsorshipForSponsor({
        sponsorshipId,
        sponsorIdentityId: active.sponsor_identity_id,
      })
    : await supporterSponsorshipRepository.revokeActiveSponsorship({ sponsorshipId });
  if (revoked) {
    invalidateTomoriStateCache(revoked.server_disc_id);
    invalidateAllChannelLlmCacheForServer(revoked.server_id);
  }
  return revoked;
}

async function returnToProviders(
  interaction: SubscriptionInteraction,
  locale: string,
  personal: boolean,
  actionReceipt?: PanelReceipt,
): Promise<void> {
  const { buildInitialProvidersPanel, buildInitialPersonalProvidersPanel } = await import(
    "@/utils/discord/interactions/providersRoutes"
  );
  const payload = await (personal ? buildInitialPersonalProvidersPanel : buildInitialProvidersPanel)(
    interaction,
    locale,
    { receipt: actionReceipt },
  );
  await deliverGuardedPanel(interaction, payload, { locale, method: "editReply", receipt: actionReceipt });
}

function actionFailureReceipt(locale: string, error: unknown): PanelReceipt {
  return receipt(
    locale,
    error instanceof SponsorshipConflictError
      ? "commands.subscription.sponsor_conflict"
      : error instanceof SubscriptionActivationError
        ? error.detailKey
        : "commands.subscription.action_failed",
    true,
  );
}

async function openSetup(interaction: SubscriptionInteraction, locale: string): Promise<void> {
  if (!interaction.isButton() && !interaction.isChatInputCommand())
    throw new Error("Setup requires a button or command");
  const { startSetupWizard } = await import("@/utils/discord/interactions/setupRoutes");
  await startSetupWizard(interaction, { locale });
}

export interface SubscriptionRouteDependencies {
  enabled(): boolean;
  load(interaction: SubscriptionInteraction, route: SubscriptionRoute): Promise<SubscriptionPanelInput>;
  refresh(discordUserId: string, locale: string): Promise<PanelReceipt | undefined>;
  link(discordUserId: string, locale: string): Promise<string>;
  activateServer(interaction: SubscriptionInteraction): Promise<void>;
  activatePersonal(interaction: SubscriptionInteraction): Promise<void>;
  revoke: typeof revokeSubscriptionSponsorship;
  back: typeof returnToProviders;
  setup: typeof openSetup;
}

const defaultDependencies: SubscriptionRouteDependencies = {
  enabled: () => isSupporterBillingEnabled(resolveEnvironment()),
  load: loadSubscriptionPanelInput,
  refresh: refreshSubscriptionMembership,
  link: (id, locale) =>
    createPatreonOAuthUrlForDiscordUser(id, { config: parseSupporterBillingConfigForCommands(), locale }),
  activateServer: activateServerSubscription,
  activatePersonal: activatePersonalSubscription,
  revoke: revokeSubscriptionSponsorship,
  back: returnToProviders,
  setup: openSetup,
};

const PAGE_VIEWS = { "servers-page": "servers", "usage-page": "usage", "models-page": "models" } as const;

async function withPatreonAuthorizationLink(
  input: SubscriptionPanelInput,
  dependencies: SubscriptionRouteDependencies,
): Promise<SubscriptionPanelInput> {
  if (
    input.oauthUrl ||
    input.state.kind === "active" ||
    input.state.kind === "error" ||
    !["onboard", "continue", "activate", "setup"].includes(input.route.action)
  )
    return input;
  try {
    return { ...input, oauthUrl: await dependencies.link(input.route.owner, input.route.locale) };
  } catch (error) {
    log.warn("Subscription authorization link creation failed");
    return { ...input, receipt: actionFailureReceipt(input.route.locale, error) };
  }
}

/** Maps select and pagination controls onto the view they open, so each control keeps a unique custom ID. */
function resolveRequestedView(route: SubscriptionRoute, interaction: GlobalRoutableInteraction): SubscriptionRoute {
  if (interaction.isStringSelectMenu()) {
    const [value] = interaction.values;
    if (route.action === "server-select") {
      const selection = Number(value);
      if (!Number.isSafeInteger(selection) || selection <= 0) throw new Error("Invalid sponsorship selection");
      return { ...route, action: "servers", selection };
    }
    if (route.action === "breakdown" && (value === "usage" || value === "models"))
      return { ...route, action: value, page: 0 };
    throw new Error("Unexpected subscription selection");
  }
  if (!interaction.isButton() || route.action === "server-select" || route.action === "breakdown")
    throw new Error("Unexpected subscription interaction type");
  if (route.action === "servers-page" || route.action === "usage-page" || route.action === "models-page")
    return { ...route, action: PAGE_VIEWS[route.action] };
  return route;
}

export function createSubscriptionInteractionRoute(
  overrides: Partial<SubscriptionRouteDependencies> = {},
): GlobalInteractionRoute {
  const dependencies = { ...defaultDependencies, ...overrides };
  return {
    namespace: SUBSCRIPTION_NAMESPACE,
    version: SUBSCRIPTION_VERSION,
    async execute(_client, interaction, parsed) {
      const parsedRoute = parseSubscriptionRoute(parsed);
      if (!parsedRoute) throw new Error("Malformed subscription panel route");
      const route = resolveRequestedView(parsedRoute, interaction);
      const allowed = route.owner === interaction.user.id && dependencies.enabled();
      const input = await beginPanelInteraction(interaction, {
        authorize: () => allowed,
        onDenied: () =>
          interaction.followUp({
            content: localizer(route.locale, "general.errors.permission_denied_description"),
            flags: MessageFlags.Ephemeral,
          }),
        load: () => dependencies.load(interaction, route),
        onMissing: async () => {},
      });
      if (!input) return;
      let actionReceipt: PanelReceipt | undefined;
      let oauthUrl: string | undefined;
      try {
        if (route.action === "back") {
          await dependencies.back(interaction, route.locale, route.origin === "personal");
          return;
        }
        if (route.action === "setup") {
          await dependencies.setup(interaction, route.locale);
          return;
        }
        if (route.action === "link") oauthUrl = await dependencies.link(interaction.user.id, route.locale);
        if (route.action === "refresh" || route.action === "continue")
          actionReceipt = await dependencies.refresh(interaction.user.id, route.locale);
        const verifying = route.action === "refresh" || route.action === "continue";
        const refreshed = verifying ? await dependencies.load(interaction, route) : input;
        if (verifying && refreshed.state.kind === "active" && actionReceipt?.tone !== "error")
          await dependencies.activatePersonal(interaction);
        if (
          route.action === "activate" ||
          (route.action === "continue" && route.origin === "sponsor" && refreshed.state.kind === "active")
        ) {
          await dependencies.activateServer(interaction);
          await dependencies.back(interaction, route.locale, false);
          return;
        }
        if (route.action === "continue" && route.origin === "personal" && refreshed.state.kind === "active") {
          await dependencies.back(interaction, route.locale, true);
          return;
        }
        if (route.action === "confirm") {
          const revoked = await dependencies.revoke(interaction, route.selection);
          actionReceipt = receipt(
            route.locale,
            revoked
              ? input.removal?.ownedByViewer === false
                ? "commands.subscription.removed"
                : "commands.subscription.stopped"
              : "commands.subscription.changed",
            !revoked,
            revoked
              ? {
                  server:
                    interaction.client.guilds.cache.get(revoked.server_disc_id)?.name ??
                    localizer(route.locale, "commands.subscription.unknown_server", { id: revoked.server_disc_id }),
                }
              : undefined,
          );
          if (revoked && (route.origin === "server" || route.origin === "sponsor")) {
            await dependencies.back(interaction, route.locale, false, actionReceipt);
            return;
          }
          route.action = "servers";
        }
      } catch (error) {
        actionReceipt = actionFailureReceipt(route.locale, error);
        log.warn("Subscription panel action failed", { metadata: { action: route.action } });
      }
      if (route.action === "refresh") route.action = "overview";
      const next = await dependencies.load(interaction, route);
      const prepared = await withPatreonAuthorizationLink(
        { ...next, route, oauthUrl, receipt: actionReceipt ?? next.receipt },
        dependencies,
      );
      await deliverGuardedPanel(interaction, buildSubscribePanel(prepared), {
        locale: route.locale,
        method: "editReply",
        receipt: prepared.receipt,
      });
    },
  };
}

export const subscriptionInteractionRoute = createSubscriptionInteractionRoute();

export async function showSubscriptionSurface(
  _client: Client,
  interaction: SubscriptionInteraction,
  locale: string,
  options: {
    account?: boolean;
    origin?: SubscriptionOrigin;
    dependencies?: Partial<SubscriptionRouteDependencies>;
  } = {},
): Promise<void> {
  const dependencies = { ...defaultDependencies, ...options.dependencies };
  if (!interaction.deferred && !interaction.replied) {
    if (interaction.isChatInputCommand()) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    else await interaction.deferUpdate();
  }
  if (!dependencies.enabled()) {
    await deliverGuardedPanel(
      interaction,
      {
        flags: MessageFlags.IsComponentsV2,
        components: [
          buildPanelContainer([
            { type: ComponentType.TextDisplay, content: localizer(locale, "commands.subscription.unavailable") },
          ]),
        ],
      },
      { locale, method: "editReply" },
    );
    return;
  }
  let origin = options.origin ?? "account";
  if (!options.account && !options.origin && interaction.guildId && managesServer(interaction))
    origin = (await getCachedTomoriState(interaction.guildId)) ? "server" : "setup";
  const route: SubscriptionRoute = {
    action: options.account ? "overview" : "onboard",
    locale,
    owner: interaction.user.id,
    origin,
    selection: 0,
    page: 0,
  };
  const input = await dependencies.load(interaction, route);
  if (input.state.kind === "active" && (origin === "sponsor" || (origin === "personal" && !options.account))) {
    try {
      if (origin === "sponsor") await dependencies.activateServer(interaction);
      else await dependencies.activatePersonal(interaction);
    } catch (error) {
      log.warn("Subscription activation failed", { metadata: { origin } });
      const actionReceipt = actionFailureReceipt(locale, error);
      await deliverGuardedPanel(interaction, buildSubscribePanel({ ...input, route, receipt: actionReceipt }), {
        locale,
        method: "editReply",
        receipt: actionReceipt,
      });
      return;
    }
    await dependencies.back(interaction, locale, origin === "personal");
    return;
  }
  if (input.state.kind === "active" && origin === "account" && !options.account) route.action = "overview";
  const finalInput = route.action === input.route.action ? input : await dependencies.load(interaction, route);
  const prepared = await withPatreonAuthorizationLink({ ...finalInput, route }, dependencies);
  await deliverGuardedPanel(interaction, buildSubscribePanel(prepared), {
    locale,
    method: "editReply",
    receipt: prepared.receipt,
  });
}
