import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type ButtonComponentData,
  type ComponentInContainerData,
  type InteractionEditReplyOptions,
} from "discord.js";
import type {
  SupporterBillingConfig,
  SupporterBillingTierConfig,
  SupporterCapability,
} from "@/modules/supporter-billing/config";
import type { SupporterUsageAggregate } from "@/modules/supporter-billing/db/repositories";
import type { SubscribePanelState } from "@/modules/supporter-billing/subscribe/types";
import type { SubscriptionAllowance } from "@/modules/supporter-billing/subscribe/usage";
import {
  buildSubscriptionRouteId,
  type SubscriptionAction,
  type SubscriptionRoute,
} from "@/modules/supporter-billing/subscribe/catalog";
import type { PanelReceipt } from "@/types/discord/panel";
import { resolveRangeSelection } from "@/utils/discord/interactions/panelController";
import {
  buildCategoryButtonRow,
  buildOptionalThumbnailSection,
  buildPaginationRow,
  buildPanelContainer,
  buildPanelReceiptContainer,
  withLinePrefix,
} from "@/utils/discord/ui/panel";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import { escapeDiscordMarkdown } from "@/utils/text/discordMarkdown";
import { localizer } from "@/utils/text/localizer";

const MODEL_USAGE_PAGE_SIZE = 5;
const CAPABILITY_LABEL_KEYS: Record<SupporterCapability, string> = {
  text: "commands.providers.capabilities.text",
  vision: "commands.personal.config.routing_vision",
  image: "commands.providers.capabilities.image",
  video: "commands.providers.capabilities.video",
  voice: "commands.providers.capabilities.speech",
  decision: "commands.config.panel.capability_decision",
  embedding: "commands.providers.capabilities.embedding",
};

export interface SubscriptionPanelInput {
  route: SubscriptionRoute;
  state: SubscribePanelState;
  config: SupporterBillingConfig;
  avatarUrl?: string | null;
  allowance?: SubscriptionAllowance | null;
  aggregates?: SupporterUsageAggregate[];
  oauthUrl?: string;
  receipt?: PanelReceipt;
  resolveServerLabel?: (id: string) => string | undefined;
  removal?: { serverLabel: string; ownedByViewer: boolean };
}

function text(content: string): ComponentInContainerData {
  return { type: ComponentType.TextDisplay, content };
}

function button(
  input: SubscriptionPanelInput,
  action: SubscriptionAction,
  key: string,
  values: Partial<SubscriptionRoute> = {},
  danger = false,
): ButtonComponentData {
  return {
    type: ComponentType.Button,
    style: danger ? ButtonStyle.Danger : ButtonStyle.Secondary,
    customId: buildSubscriptionRouteId({ ...input.route, action, ...values }),
    label: localizer(input.route.locale, key),
  };
}

function actions(...buttons: ButtonComponentData[]): ComponentInContainerData {
  return { type: ComponentType.ActionRow, components: buttons };
}

function external(locale: string, key: string, url: string): ButtonComponentData {
  return { type: ComponentType.Button, style: ButtonStyle.Link, label: localizer(locale, key), url };
}

export function getSubscriptionTierName(locale: string, tier?: SupporterBillingTierConfig): string {
  return tier?.displayName ?? localizer(locale, tier?.displayNameKey ?? "commands.subscribe.tiers.unknown");
}

function tierName(input: SubscriptionPanelInput): string {
  const {
    state,
    config,
    route: { locale },
  } = input;
  const tier =
    state.kind === "active" || state.kind === "inactive" ? config.tiers[state.entitlement.tier_key] : undefined;
  return getSubscriptionTierName(locale, tier);
}

export function buildSubscriptionOnboarding(input: {
  locale: string;
  ready: boolean;
  tier?: string;
  model?: string;
  manageUrl: string;
  oauthUrl?: string;
  linkId?: string;
  continueId: string;
  fundingServer?: string;
}): ComponentInContainerData[] {
  const { locale } = input;
  if (input.ready) {
    return [
      text(
        [
          `### ${localizer(locale, "commands.subscription.ready_title")}`,
          `> ${localizer(locale, "commands.subscription.membership", { tier: escapeDiscordMarkdown(input.tier ?? "") })}`,
          input.model
            ? `> ${localizer(locale, "commands.subscription.reply_model", { model: escapeDiscordMarkdown(input.model) })}`
            : "",
          input.fundingServer
            ? localizer(locale, "commands.subscription.setup_funding", {
                server: escapeDiscordMarkdown(input.fundingServer),
              })
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    ];
  }
  return [
    text(
      `### ${localizer(locale, "commands.subscription.name")}\n${localizer(locale, "commands.subscription.onboarding")}\n\n${localizer(locale, "commands.subscription.onboarding_steps")}\n1. **${localizer(locale, "commands.subscription.choose_membership")}**`,
    ),
    actions(external(locale, "commands.subscription.subscribe_patreon", input.manageUrl)),
    text(`2. **${localizer(locale, "commands.subscription.link_discord")}**`),
    ...(input.oauthUrl
      ? [actions(external(locale, "commands.subscription.link", input.oauthUrl))]
      : input.linkId
        ? [
            actions({
              type: ComponentType.Button,
              style: ButtonStyle.Secondary,
              customId: input.linkId,
              label: localizer(locale, "commands.subscription.link"),
            }),
          ]
        : []),
    text(`3. **${localizer(locale, "commands.subscription.continue")}**`),
    actions({
      type: ComponentType.Button,
      style: ButtonStyle.Secondary,
      customId: input.continueId,
      label: localizer(locale, "commands.subscription.continue"),
    }),
  ];
}

function onboarding(input: SubscriptionPanelInput): ComponentInContainerData[] {
  const { route, state, config } = input;
  if (state.kind === "error")
    return [
      text(localizer(route.locale, "commands.subscription.unavailable")),
      actions(button(input, "onboard", "commands.subscription.retry")),
    ];
  const tier = state.kind === "active" ? config.tiers[state.entitlement.tier_key] : undefined;
  const ready = state.kind === "active" && !!tier;
  const components = buildSubscriptionOnboarding({
    locale: route.locale,
    ready,
    tier: tierName(input),
    model: tier?.defaultModelByCapability.text,
    manageUrl: config.patreon.manageUrl,
    oauthUrl: input.oauthUrl,
    linkId: buildSubscriptionRouteId({ ...route, action: "link" }),
    continueId: buildSubscriptionRouteId({ ...route, action: "continue" }),
  });
  if (ready) {
    const upgrade = external(route.locale, "commands.subscription.upgrade", config.patreon.manageUrl);
    if (route.origin === "sponsor") {
      components.push(
        text(localizer(route.locale, "commands.subscription.activate_description")),
        actions(
          button(input, "activate", "commands.subscription.activate"),
          button(input, "overview", "commands.subscription.view"),
          upgrade,
        ),
      );
    } else if (route.origin === "setup") {
      components.push(
        actions(
          button(input, "setup", "commands.subscription.continue_setup"),
          button(input, "overview", "commands.subscription.view"),
          upgrade,
        ),
      );
    } else {
      components.push(actions(button(input, "overview", "commands.subscription.view"), upgrade));
    }
  }
  return components;
}

function percent(amount: number, allowance: number): string {
  return `${((amount / allowance) * 100).toFixed(2)}%`;
}

function allowanceBar(amount: number, allowance: number): string {
  const filled = Math.floor(Math.max(0, Math.min(1, amount / allowance)) * 20);
  return `\`\`\`\n${"█".repeat(filled)}${"░".repeat(20 - filled)} ${percent(amount, allowance)}\n\`\`\``;
}

function overview(input: SubscriptionPanelInput): ComponentInContainerData[] {
  const {
    route: { locale },
    state,
    allowance,
  } = input;
  const description =
    state.kind === "unlinked"
      ? "commands.subscription.unlinked"
      : state.kind === "inactive"
        ? "commands.subscription.inactive"
        : state.kind === "error"
          ? state.reason === "inconsistent"
            ? "commands.subscription.incomplete"
            : "commands.subscription.unavailable"
          : "commands.subscription.overview_description";
  const body = [`## ${localizer(locale, "commands.subscription.overview_title")}`, localizer(locale, description)];
  if (state.kind === "active" || state.kind === "inactive") {
    body.push(
      `> ${localizer(locale, "commands.subscription.membership", { tier: escapeDiscordMarkdown(tierName(input)) })}`,
      `> ${localizer(locale, "commands.subscription.sponsored_count", { count: state.sponsoredServers.length })}`,
    );
  }
  const components = [
    buildOptionalThumbnailSection({ type: ComponentType.TextDisplay, content: body.join("\n") }, input.avatarUrl),
  ];
  if (state.kind === "active") {
    if (allowance) {
      const renewal = `<t:${Math.floor(allowance.end.getTime() / 1000)}:R> (<t:${Math.floor(allowance.end.getTime() / 1000)}:D>)`;
      components.push(
        text(
          `### ${localizer(locale, "commands.subscription.remaining")}\n${allowanceBar(allowance.remaining, allowance.allowance)}\n${localizer(locale, state.entitlement.cancel_at_period_end ? "commands.subscription.access_ends" : "commands.subscription.renews", { time: renewal })}\n-# ${localizer(locale, "commands.subscription.shared_allowance")}`,
        ),
      );
      if (allowance.remaining <= 0)
        components.push(
          text(
            localizer(
              locale,
              state.entitlement.cancel_at_period_end
                ? "commands.subscription.exhausted_ending"
                : "commands.subscription.exhausted",
              { time: renewal },
            ),
          ),
        );
    } else components.push(text(localizer(locale, "commands.subscription.incomplete")));
  }
  if (state.kind === "unlinked")
    components.push(actions(button(input, "onboard", "commands.subscription.subscribe_using")));
  else if (state.kind !== "error")
    components.push(
      actions(
        button(input, "refresh", "commands.subscription.check_patreon"),
        external(locale, "commands.subscription.manage_patreon", input.config.patreon.manageUrl),
      ),
    );
  return components;
}

function servers(input: SubscriptionPanelInput): ComponentInContainerData[] {
  const { route, state } = input;
  const locale = route.locale;
  if (state.kind === "error" || state.kind === "unlinked") return overview(input);
  if (state.sponsoredServers.length === 0)
    return [
      text(
        `### ${localizer(locale, "commands.subscription.servers")}\n${localizer(locale, "commands.subscription.no_servers")}`,
      ),
    ];
  const selected =
    state.sponsoredServers.find((server) => server.sponsorshipId === route.selection) ?? state.sponsoredServers[0];
  const selection = resolveRangeSelection(state.sponsoredServers, route.page, 25);
  const components: ComponentInContainerData[] = [
    text(
      `### ${localizer(locale, "commands.subscription.servers")}\n${localizer(locale, "commands.subscription.servers_description")}`,
    ),
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          customId: buildSubscriptionRouteId({ ...route, action: "server-select" }),
          placeholder: localizer(locale, "commands.subscription.server_placeholder"),
          options: selection.visibleItems.map((server) => ({
            label: safeSelectOptionText(server.label, 100),
            value: String(server.sponsorshipId),
            default: server.sponsorshipId === selected?.sponsorshipId,
          })),
        },
      ],
    },
  ];
  const pagination = buildPaginationRow({
    locale,
    rangeIndex: selection.rangeIndex,
    rangeCount: selection.rangeCount,
    namespace: "subscription",
    version: "v1",
    buildSegments: {
      page: (page) => [
        "servers-page",
        locale,
        route.owner,
        route.origin,
        String(selected?.sponsorshipId ?? 0),
        String(page),
      ],
    },
  });
  if (pagination) components.push(pagination);
  if (selected) {
    const serverCost = input.aggregates?.reduce(
      (sum, row) =>
        sum + (row.funding_scope === "server" && row.server_disc_id === selected.serverDiscId ? row.cost_usd : 0),
      0,
    );
    const usageLine =
      input.allowance && serverCost !== undefined
        ? `\n> ${localizer(locale, "commands.subscription.server_usage", { percent: percent(serverCost, input.allowance.allowance) })}`
        : "";
    components.push(
      buildOptionalThumbnailSection(
        {
          type: ComponentType.TextDisplay,
          content: `> ${localizer(locale, "commands.subscription.server", { server: escapeDiscordMarkdown(selected.label) })}\n> ${localizer(locale, "commands.subscription.server_access")}${usageLine}`,
        },
        selected.iconUrl,
      ),
      text(localizer(locale, "commands.subscription.server_impact")),
      actions(button(input, "remove", "commands.subscription.stop", { selection: selected.sponsorshipId }, true)),
      text(`-# ${localizer(locale, "commands.subscription.sponsor_another")}`),
    );
  }
  return components;
}

function usage(input: SubscriptionPanelInput): ComponentInContainerData[] {
  const { allowance, route, aggregates = [] } = input;
  const locale = route.locale;
  if (!allowance) return [text(localizer(locale, "commands.subscription.unavailable"))];
  const modelView = route.action === "models";
  const grouped = new Map<
    string,
    {
      model: string;
      capability: SupporterCapability;
      cost: number;
      count: number;
      input: number | null;
      output: number | null;
    }
  >();
  for (const row of aggregates) {
    const id = modelView
      ? `${row.capability}:${row.model_codename}`
      : row.funding_scope === "personal"
        ? "personal"
        : `server:${row.server_disc_id ?? "unknown"}`;
    const current = grouped.get(id) ?? {
      model: row.model_codename,
      capability: row.capability,
      cost: 0,
      count: 0,
      input: null,
      output: null,
    };
    current.cost += row.cost_usd;
    current.count += row.generations;
    if (row.input_tokens !== null) current.input = (current.input ?? 0) + row.input_tokens;
    if (row.output_tokens !== null) current.output = (current.output ?? 0) + row.output_tokens;
    grouped.set(id, current);
  }
  const rows = [...grouped].sort(([a, left], [b, right]) =>
    !modelView && (a === "personal" || b === "personal") ? (a === "personal" ? -1 : 1) : right.cost - left.cost,
  );
  const logged = aggregates.reduce((sum, row) => sum + row.cost_usd, 0);
  const other = Math.max(0, allowance.used - logged);
  const selection = resolveRangeSelection(rows, route.page, modelView ? MODEL_USAGE_PAGE_SIZE : 8);
  const components: ComponentInContainerData[] = [
    text(
      `### ${localizer(locale, "commands.subscription.usage")}\n${localizer(locale, "commands.subscription.period", { start: `<t:${Math.floor(allowance.start.getTime() / 1000)}:D>`, end: `<t:${Math.floor(allowance.end.getTime() / 1000)}:D>` })}\n${localizer(locale, "commands.subscription.remaining")}\n${allowanceBar(allowance.remaining, allowance.allowance)}\n> ${localizer(locale, "commands.subscription.generations", { count: `\`${aggregates.reduce((sum, row) => sum + row.generations, 0)}\`` })}`,
    ),
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          customId: buildSubscriptionRouteId({ ...route, action: "breakdown", page: 0 }),
          placeholder: localizer(locale, "commands.subscription.breakdown"),
          options: [
            { label: localizer(locale, "commands.subscription.scopes"), value: "usage", default: !modelView },
            { label: localizer(locale, "commands.subscription.models"), value: "models", default: modelView },
          ],
        },
      ],
    },
  ];
  const lines = selection.visibleItems.map(([id, row], index) => {
    const label = modelView
      ? `\`${safeSelectOptionText(row.model, 100).replaceAll("`", "ˋ")}\` (${localizer(locale, CAPABILITY_LABEL_KEYS[row.capability])})`
      : id === "personal"
        ? escapeDiscordMarkdown(localizer(locale, "commands.subscription.personal"))
        : escapeDiscordMarkdown(
            safeSelectOptionText(
              input.resolveServerLabel?.(id.slice(7)) ??
                localizer(locale, "commands.subscription.unknown_server", { id: id.slice(7) }),
              100,
            ),
          );
    const line = `${modelView ? `${index + 1}. ` : "> "}${label}: \`${percent(row.cost, allowance.allowance)}\``;
    return modelView
      ? `${line}\n${withLinePrefix("> ", localizer(locale, "commands.subscription.model_counts", { count: `\`${row.count}\``, input: row.input === null ? localizer(locale, "commands.subscription.unknown") : `\`${row.input}\``, output: row.output === null ? localizer(locale, "commands.subscription.unknown") : `\`${row.output}\`` }))}`
      : line;
  });
  if (other > 0)
    lines.push(
      `${modelView ? `${lines.length + 1}. ` : "> "}${localizer(locale, "commands.subscription.other")}: \`${percent(other, allowance.allowance)}\``,
    );
  components.push(text(lines.length > 0 ? lines.join("\n") : localizer(locale, "commands.subscription.no_usage")));
  const pagination = buildPaginationRow({
    locale,
    rangeIndex: selection.rangeIndex,
    rangeCount: selection.rangeCount,
    namespace: "subscription",
    version: "v1",
    buildSegments: {
      page: (page) => [`${modelView ? "models" : "usage"}-page`, locale, route.owner, route.origin, "0", String(page)],
    },
  });
  if (pagination) components.push(pagination);
  components.push(text(`-# ${localizer(locale, "commands.subscription.percent_note")}`));
  return components;
}

function returnsToProviders(route: SubscriptionRoute): boolean {
  return route.origin === "sponsor" || route.origin === "personal";
}

export function buildSubscribePanel(input: SubscriptionPanelInput): InteractionEditReplyOptions {
  const { route, state } = input;
  const onboardingPage = ["onboard", "link", "continue", "activate", "setup"].includes(route.action);
  const components: ComponentInContainerData[] = [];
  if (!onboardingPage && route.action !== "remove" && route.action !== "confirm") {
    components.push(
      buildCategoryButtonRow(
        [
          {
            id: "overview",
            label: localizer(route.locale, "commands.subscription.overview"),
            customId: buildSubscriptionRouteId({ ...route, action: "overview", selection: 0, page: 0 }),
          },
          {
            id: "usage",
            label: localizer(route.locale, "commands.subscription.usage"),
            customId: buildSubscriptionRouteId({ ...route, action: "usage", selection: 0, page: 0 }),
          },
          {
            id: "servers",
            label: localizer(route.locale, "commands.subscription.servers"),
            customId: buildSubscriptionRouteId({ ...route, action: "servers", selection: 0, page: 0 }),
          },
        ],
        route.action === "models" ? "usage" : route.action,
      ),
      { type: ComponentType.Separator, divider: true, spacing: 1 },
    );
  }
  if (onboardingPage) components.push(...onboarding(input));
  else if (route.action === "remove" || route.action === "confirm") {
    const server =
      state.kind === "active" || state.kind === "inactive"
        ? state.sponsoredServers.find((server) => server.sponsorshipId === route.selection)
        : undefined;
    const label =
      input.removal?.serverLabel ?? server?.label ?? localizer(route.locale, "commands.subscription.selected_server");
    const managerRemoval = input.removal?.ownedByViewer === false;
    components.push(
      text(
        `### ${localizer(route.locale, managerRemoval ? "commands.subscription.remove_title" : "commands.subscription.stop_title", { server: escapeDiscordMarkdown(label) })}\n${localizer(route.locale, managerRemoval ? "commands.subscription.remove_impact" : "commands.subscription.stop_impact")}`,
      ),
      actions(
        button(
          input,
          "confirm",
          managerRemoval ? "commands.providers.remove_sponsorship" : "commands.subscription.confirm_stop",
          {},
          true,
        ),
        button(
          input,
          returnsToProviders(route) || route.origin === "server" ? "back" : "servers",
          "commands.subscription.cancel",
        ),
      ),
    );
  } else if (route.action === "servers") components.push(...servers(input));
  else if (route.action === "usage" || route.action === "models") components.push(...usage(input));
  else components.push(...overview(input));
  if (returnsToProviders(route) && route.action !== "remove" && route.action !== "confirm")
    components.push(
      { type: ComponentType.Separator, divider: true, spacing: 1 },
      actions(
        button(
          input,
          "back",
          route.origin === "personal" ? "commands.subscription.back_personal" : "commands.subscription.back_providers",
        ),
      ),
    );
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [
      buildPanelContainer(components),
      ...(input.receipt ? [buildPanelReceiptContainer(input.receipt)] : []),
    ],
    attachments: [],
  };
}
