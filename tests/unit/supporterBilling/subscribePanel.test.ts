import { beforeAll, describe, expect, it, spyOn } from "bun:test";
import { ButtonStyle, ComponentType, type Client } from "discord.js";
import {
  SponsorshipConflictError,
  supporterIdentityRepository,
  supporterEntitlementRepository,
  supporterSponsorshipRepository,
  type SupporterIdentityRow,
  type SupporterEntitlementRow,
  type SupporterServerSponsorshipRow,
} from "@/modules/supporter-billing/db";
import type { SupporterBillingConfig } from "@/modules/supporter-billing/config";
import type { PanelReceipt } from "@/types/discord/panel";
import { buildSubscribePanel, type SubscriptionPanelInput } from "@/modules/supporter-billing/subscribe/panel";
import { loadSubscribePanelState } from "@/modules/supporter-billing/subscribe/state";
import type { SubscribePanelDependencies } from "@/modules/supporter-billing/subscribe/types";
import {
  buildSubscriptionRouteId,
  parseSubscriptionRoute,
  type SubscriptionRoute,
} from "@/modules/supporter-billing/subscribe/catalog";
import {
  refreshSubscriptionMembership,
  createSubscriptionInteractionRoute,
  showSubscriptionSurface,
  SubscriptionActivationError,
  type SubscriptionRouteDependencies,
} from "@/modules/supporter-billing/subscribe/components";
import { parseInteractionRoute, type GlobalRoutableInteraction } from "@/utils/discord/interactions/routeRegistry";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createRouteInteraction } from "../../helpers/routeInteraction";
import { collectTextDisplays, expectSafePanelPayload } from "../../helpers/panelLimits";
import { expectForEveryLocale, localizedCopy, localizedProse, RUNTIME_LOCALES } from "../../helpers/localeCases";
import type { ComponentsV2MessagePayload } from "@/utils/discord/ui/componentsV2Limits";
import { createPatreonOAuthUrlForDiscordUser } from "@/modules/supporter-billing/patreon/oauth";
import { escapeDiscordMarkdown } from "@/utils/text/discordMarkdown";
import * as userCache from "@/utils/cache/userCache";
import * as tomoriStateCache from "@/utils/cache/tomoriStateCache";
import * as patreonReconcile from "@/modules/supporter-billing/patreon/reconcile";
import * as sponsorship from "@/modules/supporter-billing/discord/sponsorship";
import { createUserRow } from "../../helpers/fixtures";
import { useEnvSandbox } from "../../helpers/env";

useEnvSandbox(["TOMORI_SUPPORTER_CONFIG_JSON"]);

const OWNER = "123456789012345678";
const config: SupporterBillingConfig = {
  patreon: {
    campaignId: "campaign_local",
    oauthClientIdEnv: "CLIENT_ID",
    oauthClientSecretEnv: "CLIENT_SECRET",
    webhookSecretEnv: "WEBHOOK_SECRET",
    creatorRefreshTokenEnv: "REFRESH_TOKEN",
    manageUrl: "https://www.patreon.com/example",
  },
  jobs: { reconcileIntervalSeconds: 300, manualRefreshCooldownSeconds: 30 },
  tiers: {
    local_tier: {
      displayNameKey: "commands.subscribe.tiers.mochi",
      patreonTierIds: ["patreon_tier_local"],
      monthlyBudgetMicros: 1000000,
      defaultModelByCapability: { text: "example/model" },
    },
  },
};
function makeIdentity(overrides: Partial<SupporterIdentityRow> = {}): SupporterIdentityRow {
  return {
    supporter_identity_id: 10,
    discord_user_id: "discord_user_1",
    patreon_user_id: "patreon_user_local",
    patreon_member_id: "patreon_member_local",
    patreon_campaign_id: "campaign_local",
    linked_at: new Date("2026-01-01T00:00:00.000Z"),
    last_oauth_at: new Date("2026-01-01T00:00:00.000Z"),
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeEntitlement(overrides: Partial<SupporterEntitlementRow> = {}): SupporterEntitlementRow {
  return {
    supporter_entitlement_id: 20,
    supporter_identity_id: 10,
    tier_key: "local_tier",
    patreon_tier_id: "patreon_tier_local",
    patron_status: "active_patron",
    is_active: true,
    cancel_at_period_end: false,
    period_start: new Date("2026-01-01T00:00:00.000Z"),
    period_end: new Date("2026-02-01T00:00:00.000Z"),
    last_verified_at: new Date("2026-01-10T00:00:00.000Z"),
    last_successful_charge_at: null,
    next_charge_at: null,
    source: "manual_admin",
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-10T00:00:00.000Z"),
    ...overrides,
  };
}

function makeSponsorship(overrides: Partial<SupporterServerSponsorshipRow> = {}): SupporterServerSponsorshipRow {
  return {
    sponsorship_id: 40,
    server_id: 50,
    server_disc_id: "guild_1",
    sponsor_identity_id: 10,
    status: "active",
    created_by_disc_id: "discord_user_1",
    created_at: new Date("2026-01-05T00:00:00.000Z"),
    revoked_at: null,
    updated_at: new Date("2026-01-05T00:00:00.000Z"),
    ...overrides,
  };
}

function makeDependencies(params: {
  identity?: SupporterIdentityRow | null;
  entitlement?: SupporterEntitlementRow | null;
  sponsorships?: SupporterServerSponsorshipRow[];
  throwIdentity?: boolean;
}): SubscribePanelDependencies {
  return {
    identityRepository: {
      loadByDiscordUserId: async () => {
        if (params.throwIdentity) {
          throw new Error("db unavailable");
        }
        return params.identity ?? null;
      },
    },
    entitlementRepository: {
      loadByIdentityId: async () => params.entitlement ?? null,
    },
    sponsorshipRepository: {
      loadActiveSponsorshipsForSponsorIdentity: async () => params.sponsorships ?? [],
    },
    resolveServerLabel: (serverDiscId) => (serverDiscId === "guild_1" ? "Guild One" : serverDiscId),
  };
}

function input(action: SubscriptionRoute["action"] = "overview", count = 2): SubscriptionPanelInput {
  return {
    route: { action, locale: "en-US", owner: OWNER, origin: "account", selection: 40, page: 0 },
    config,
    state: {
      kind: "active",
      identity: makeIdentity({ discord_user_id: OWNER }),
      entitlement: makeEntitlement(),
      sponsoredServers: Array.from({ length: count }, (_, i) => ({
        sponsorshipId: i + 40,
        serverId: i + 50,
        serverDiscId: String(i + 100),
        label: `Workshop ${i}`,
        iconUrl: "https://cdn.discordapp.com/icons/example.png",
      })),
    },
    avatarUrl: "https://cdn.discordapp.com/avatars/example.png",
    allowance: {
      allowance: 1,
      used: 0.32,
      remaining: 0.68,
      start: new Date("2026-01-01"),
      end: new Date("2026-02-01"),
    },
    aggregates: [
      {
        funding_scope: "personal",
        server_disc_id: "100",
        model_codename: "example/first",
        capability: "text",
        cost_usd: 0.08,
        generations: 2,
        input_tokens: 10,
        output_tokens: 20,
      },
      {
        funding_scope: "server",
        server_disc_id: "100",
        model_codename: "example/second",
        capability: "text",
        cost_usd: 0.16,
        generations: 3,
        input_tokens: null,
        output_tokens: null,
      },
    ],
    resolveServerLabel: (id) => `Workshop ${id}`,
  };
}

function flatten(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (!value || typeof value !== "object") return [];
  return [value as Record<string, unknown>, ...Object.values(value).flatMap(flatten)];
}

async function dispatch(
  route: SubscriptionRoute,
  overrides: Partial<SubscriptionRouteDependencies> = {},
  options: { actor?: string; values?: string[] } = {},
) {
  const fake = createRouteInteraction({
    customId: buildSubscriptionRouteId(route),
    kind: options.values ? "string-select" : "button",
    values: options.values,
    overrides: { user: { id: options.actor ?? OWNER, username: "mirri", displayName: "Mirri", globalName: "Mirri" } },
  });
  Object.assign(fake.client, { guilds: { cache: new Map() } });
  const handler = createSubscriptionInteractionRoute({
    enabled: () => true,
    load: async (_interaction, route) => ({ ...input(route.action), route }),
    activatePersonal: async () => {},
    ...overrides,
  });
  const parsed = parseInteractionRoute(fake.customId);
  if (!parsed) throw new Error("Subscription route did not parse");
  await handler.execute({} as Client, fake as unknown as GlobalRoutableInteraction, parsed);
  return fake;
}

beforeAll(initializeLocalizer);

describe("subscription panels", () => {
  it("shows the paid-through date instead of renewal after cancellation in every locale", () => {
    expectForEveryLocale((locale) => {
      for (const remaining of [0.68, 0]) {
        const fixture = input();
        fixture.route.locale = locale;
        if (fixture.state.kind !== "active" || !fixture.allowance) throw new Error("Expected active subscription");
        fixture.state.entitlement.cancel_at_period_end = true;
        fixture.allowance.remaining = remaining;
        const body = collectTextDisplays(buildSubscribePanel(fixture)).join("\n");
        const relative = `<t:${Math.floor(fixture.allowance.end.getTime() / 1000)}:R>`;
        const date = `<t:${Math.floor(fixture.allowance.end.getTime() / 1000)}:D>`;
        const time = `${relative} (${date})`;
        const prose = body.replace(/(?:^|\n)(?:#{1,3}|-#|>) /gu, "").replace(/\s/gu, "");
        expect(body).toContain(relative);
        expect(body).toContain(date);
        expect(prose).toContain(
          localizedCopy(locale, "commands.subscription.access_ends", { time }).replace(/\s/gu, ""),
        );
        expect(prose).not.toContain(
          localizedCopy(locale, "commands.subscription.renews", { time }).replace(/\s/gu, ""),
        );
        if (remaining === 0) {
          expect(prose).toContain(localizedCopy(locale, "commands.subscription.exhausted_ending").replace(/\s/gu, ""));
        }
        expectSafePanelPayload(buildSubscribePanel(fixture) as ComponentsV2MessagePayload, locale);
      }
    });
  });

  it("shows only subscription viewing after verification in a configured server and renders its tier label", () => {
    expectForEveryLocale((locale) => {
      const fixture = input("continue");
      fixture.route = { ...fixture.route, locale, origin: "server" };
      const { displayNameKey: _key, ...tier } = fixture.config.tiers.local_tier;
      const displayName = "Workshop ($3/month)";
      fixture.config = { ...fixture.config, tiers: { local_tier: { ...tier, displayName } } };
      const payload = buildSubscribePanel(fixture);
      const actions = flatten(payload)
        .flatMap((part) => (typeof part.customId === "string" ? [parseInteractionRoute(part.customId)] : []))
        .flatMap((parsed) => (parsed ? [parseSubscriptionRoute(parsed)?.action] : []));
      expect(actions).toEqual(["overview"]);
      expect(collectTextDisplays(payload).join("\n")).toMatch(
        localizedProse(locale, "commands.subscription.membership", { tier: escapeDiscordMarkdown(displayName) }),
      );
      expectSafePanelPayload(payload as ComponentsV2MessagePayload, locale);
    });
  });

  it("opens onboarding with a direct authorization link before any link-button interaction", async () => {
    const oauthUrl = "https://www.patreon.com/oauth2/authorize?state=example";
    for (const origin of ["account", "sponsor", "personal", "setup"] as const) {
      const interaction = createRouteInteraction({
        kind: "button",
        overrides: { user: { id: OWNER, username: "mirri", displayName: "Mirri", globalName: "Mirri" } },
      });
      let links = 0;
      await showSubscriptionSurface({} as Client, interaction as unknown as GlobalRoutableInteraction, "en-US", {
        origin,
        dependencies: {
          enabled: () => true,
          load: async (_interaction, route) => ({ ...input(), route, state: { kind: "unlinked" } }),
          link: async (owner, locale) => {
            expect(interaction.calls[0]?.method).toBe("deferUpdate");
            expect(owner).toBe(OWNER);
            expect(locale).toBe("en-US");
            links++;
            return oauthUrl;
          },
        },
      });
      expect(links).toBe(1);
      const link = flatten(interaction.edits).find((component) => component.url === oauthUrl);
      expect(link?.style).toBe(ButtonStyle.Link);
      expect(link?.customId).toBeUndefined();
    }
    const navigated = await dispatch(input("onboard").route, {
      load: async (_interaction, route) => ({ ...input(), route, state: { kind: "unlinked" } }),
      link: async () => oauthUrl,
    });
    expect(flatten(navigated.edits).some((component) => component.url === oauthUrl)).toBe(true);
  });

  it("keeps generated Patreon authorization links usable within Discord limits across locales", async () => {
    const generated = new Map<string, string>();
    for (const locale of RUNTIME_LOCALES) {
      generated.set(
        locale,
        await createPatreonOAuthUrlForDiscordUser(OWNER, {
          config,
          locale,
          env: {
            CLIENT_ID: "a".repeat(64),
            CLIENT_SECRET: "synthetic-client-secret",
            TOMORI_PUBLIC_BASE_URL: "https://membership-validation-through-a-local-tunnel.example.test",
          },
          stateRepository: {
            recordStateNonce: async () => undefined,
            consumeStateNonce: async () => null,
          },
        }),
      );
    }
    expectForEveryLocale((locale) => {
      const fixture = input("link");
      fixture.route.locale = locale;
      fixture.state = { kind: "unlinked" };
      fixture.oauthUrl = generated.get(locale);
      const payload = buildSubscribePanel(fixture);
      expectSafePanelPayload(payload as ComponentsV2MessagePayload, locale);
      expect(flatten(payload).some((part) => part.url === fixture.oauthUrl)).toBe(true);
    });
  });

  it("loads unlinked, inactive, incomplete, unavailable, and active local membership states", async () => {
    const at = new Date("2026-01-10");
    for (const [dependencies, expected] of [
      [makeDependencies({}), "unlinked"],
      [makeDependencies({ identity: makeIdentity() }), "error"],
      [makeDependencies({ identity: makeIdentity(), entitlement: makeEntitlement({ is_active: false }) }), "inactive"],
      [makeDependencies({ throwIdentity: true }), "error"],
      [
        makeDependencies({
          identity: makeIdentity(),
          entitlement: makeEntitlement(),
          sponsorships: [makeSponsorship()],
        }),
        "active",
      ],
    ] as const)
      expect((await loadSubscribePanelState(OWNER, dependencies, at)).kind).toBe(expected);
  });

  it("renders every page within Discord limits across locales and paginated data", () => {
    expectForEveryLocale((locale) => {
      for (const action of ["overview", "onboard", "servers", "usage", "models", "remove", "confirm"] as const) {
        for (const count of [0, 2, 25, 26, 60]) {
          for (const origin of ["account", "server", "setup", "sponsor"] as const) {
            for (const page of [0, 1]) {
              for (const available of [true, false]) {
                const fixture = input(action, count);
                fixture.route = { ...fixture.route, locale, origin, page };
                fixture.aggregates = Array.from({ length: count }, (_, i) => ({
                  funding_scope: "server" as const,
                  server_disc_id: String(i + 100),
                  model_codename: `example/model-${i}`,
                  capability: "text" as const,
                  cost_usd: 0.01,
                  generations: 1,
                  input_tokens: 5,
                  output_tokens: 5,
                }));
                if (!available) {
                  fixture.allowance = null;
                  fixture.state = { kind: "error", reason: "unavailable" };
                }
                const payload = buildSubscribePanel(fixture);
                expectSafePanelPayload(
                  payload as ComponentsV2MessagePayload,
                  `${locale}/${action}/${count}/${origin}/${page}/${available}`,
                );
                const membershipLinks = flatten(payload).filter(
                  (component) => component.type === ComponentType.Button && component.url === config.patreon.manageUrl,
                );
                if (available && (action === "overview" || action === "onboard")) {
                  expect(membershipLinks).toHaveLength(1);
                  expect(membershipLinks[0]?.style).toBe(ButtonStyle.Link);
                  expect(membershipLinks[0]?.label).toBe(
                    localizedCopy(
                      locale,
                      `commands.subscription.${action === "overview" ? "manage_patreon" : "upgrade"}`,
                    ),
                  );
                  expect(membershipLinks[0]?.customId).toBeUndefined();
                } else expect(membershipLinks).toHaveLength(0);
              }
            }
          }
        }
      }
    });
  });

  it("shows the same remaining-allowance bar on Overview and both usage views", () => {
    const fixture = input();
    const payload = buildSubscribePanel(fixture);
    const displays = collectTextDisplays(payload).join("\n");
    expect(displays).toContain("█████████████░░░░░░░ 68.00%");
    expect(flatten(payload).some((part) => part.type === ComponentType.Thumbnail)).toBe(true);
    for (const action of ["usage", "models"] as const) {
      const body = collectTextDisplays(buildSubscribePanel({ ...fixture, route: { ...fixture.route, action } })).join(
        "\n",
      );
      expect(body).toContain(localizedCopy("en-US", "commands.subscription.remaining"));
      expect(body).toContain("\n```\n█████████████░░░░░░░ 68.00%\n```\n> ");
    }
    fixture.allowance = {
      allowance: 1,
      used: 1.5,
      remaining: 0,
      start: new Date("2026-01-01"),
      end: new Date("2026-02-01"),
    };
    for (const action of ["usage", "models"] as const) {
      const body = collectTextDisplays(buildSubscribePanel({ ...fixture, route: { ...fixture.route, action } })).join(
        "\n",
      );
      expect(body).toContain(`${"░".repeat(20)} 0.00%`);
    }
  });

  it("keeps funding scopes disjoint, includes Other, and preserves unknown model token totals", () => {
    const fixture = input("usage");
    const body = collectTextDisplays(buildSubscribePanel(fixture)).join("\n");
    expect(body).toMatch(localizedProse("en-US", "commands.subscription.personal"));
    expect(body).toContain("`8.00%`");
    expect(body).toContain("`16.00%`");
    expect(body).toMatch(localizedProse("en-US", "commands.subscription.generations", { count: "`5`" }));
    expect(body).toMatch(localizedProse("en-US", "commands.subscription.other"));
    const modelBody = collectTextDisplays(
      buildSubscribePanel({ ...fixture, route: { ...fixture.route, action: "models" } }),
    ).join("\n");
    expect(modelBody).toMatch(localizedProse("en-US", "commands.subscription.unknown"));
    expect(modelBody).not.toContain(OWNER);
  });

  it("numbers models and Other and quotes their count details in every locale", () => {
    expectForEveryLocale((locale) => {
      const fixture = input("models");
      fixture.route.locale = locale;
      const body = collectTextDisplays(buildSubscribePanel(fixture)).join("\n");
      const details = localizedCopy(locale, "commands.subscription.model_counts", {
        count: "`2`",
        input: "`10`",
        output: "`20`",
      }).split("\n");
      expect(details).toHaveLength(3);
      for (const detail of details) expect(body).toContain(`> ${detail}`);
      const type = localizedCopy(locale, "commands.providers.capabilities.text");
      const unwrappedBody = body.replace(/\s+/g, " ");
      expect(unwrappedBody).toContain(`1. \`example/second\` (${type}): \`16.00%\``);
      expect(unwrappedBody).toContain(`2. \`example/first\` (${type}): \`8.00%\``);
      expect(body).toContain(`3. ${localizedCopy(locale, "commands.subscription.other")}: \`8.00%\``);
    });
  });

  it("sums available model token counts across scopes and preserves reported zeros", () => {
    for (const counts of [
      { personalInput: 10, personalOutput: null, serverInput: null, serverOutput: 20, input: 10, output: 20 },
      { personalInput: 0, personalOutput: null, serverInput: null, serverOutput: 0, input: 0, output: 0 },
      { personalInput: null, personalOutput: null, serverInput: null, serverOutput: null, input: null, output: null },
    ]) {
      const fixture = input("models");
      const [personal, server] = fixture.aggregates ?? [];
      if (!personal || !server) throw new Error("Expected both funding scopes");
      fixture.aggregates = [
        {
          ...personal,
          model_codename: "example/shared",
          input_tokens: counts.personalInput,
          output_tokens: counts.personalOutput,
        },
        {
          ...server,
          model_codename: "example/shared",
          input_tokens: counts.serverInput,
          output_tokens: counts.serverOutput,
        },
      ];
      const body = collectTextDisplays(buildSubscribePanel(fixture)).join("\n");
      expect(body).toMatch(
        localizedProse("en-US", "commands.subscription.model_counts", {
          count: `\`${personal.generations + server.generations}\``,
          input:
            counts.input === null ? localizedCopy("en-US", "commands.subscription.unknown") : `\`${counts.input}\``,
          output:
            counts.output === null ? localizedCopy("en-US", "commands.subscription.unknown") : `\`${counts.output}\``,
        }),
      );
    }
  });

  it("keeps different capability costs separate when one model handles text and vision", () => {
    const fixture = input("models");
    const [personal, server] = fixture.aggregates ?? [];
    if (!personal || !server) throw new Error("Expected both funding scopes");
    fixture.aggregates = [
      { ...personal, model_codename: "example/shared", capability: "text" },
      { ...server, model_codename: "example/shared", capability: "vision" },
    ];
    const body = collectTextDisplays(buildSubscribePanel(fixture)).join("\n");
    expect(body).toContain(
      `\`example/shared\` (${localizedCopy("en-US", "commands.providers.capabilities.text")}): \`8.00%\``,
    );
    expect(body).toContain(
      `\`example/shared\` (${localizedCopy("en-US", "commands.personal.config.routing_vision")}): \`16.00%\``,
    );
  });

  it("shows the five highest-spending model entries and keeps the remaining entries on the next page", () => {
    const fixture = input("models");
    const template = fixture.aggregates?.[0];
    if (!template) throw new Error("Expected a usage row");
    fixture.aggregates = Array.from({ length: 6 }, (_, index) => ({
      ...template,
      model_codename: `example/model-${index}`,
      cost_usd: (index + 1) / 100,
      generations: 1,
    }));
    const first = buildSubscribePanel(fixture);
    const firstBody = collectTextDisplays(first).join("\n");
    const modelLines = firstBody.split("\n").filter((line) => /^\d+\. `example\//.test(line));
    expect(modelLines).toHaveLength(5);
    expect(modelLines.map((line) => line.match(/`([^`]+)`/)?.[1])).toEqual([
      "example/model-5",
      "example/model-4",
      "example/model-3",
      "example/model-2",
      "example/model-1",
    ]);
    fixture.route.page = 1;
    const secondBody = collectTextDisplays(buildSubscribePanel(fixture)).join("\n");
    expect(secondBody).toContain("`example/model-0`");
    expect(secondBody).not.toContain("`example/model-5`");
    for (const body of [firstBody, secondBody]) {
      expect(body).toMatch(localizedProse("en-US", "commands.subscription.generations", { count: "`6`" }));
      expect(body).toContain(`${localizedCopy("en-US", "commands.subscription.other")}: \`11.00%\``);
    }
    expect(
      flatten(first).some((part) => typeof part.customId === "string" && part.customId.includes("models-page")),
    ).toBe(true);
  });

  it("paginates only long server lists and binds removal to a stable sponsorship ID", () => {
    for (const count of [2, 26]) {
      const fixture = input("servers", count);
      const payload = buildSubscribePanel(fixture);
      const ids = flatten(payload).flatMap((part) => (typeof part.customId === "string" ? [part.customId] : []));
      expect(ids.some((id) => id.startsWith("pagination-indicator-"))).toBe(count > 25);
      expect(
        ids
          .map(parseInteractionRoute)
          .filter(Boolean)
          .some((parsed) => parsed && parseSubscriptionRoute(parsed)?.selection === 40),
      ).toBe(true);
    }
  });

  it("shows the selected server's icon and recorded share of the full monthly allowance", () => {
    const fixture = input("servers");
    const [personal, server] = fixture.aggregates ?? [];
    if (!personal || !server || fixture.state.kind !== "active") throw new Error("Expected active usage fixture");
    fixture.aggregates = [
      { ...personal, server_disc_id: null },
      server,
      { ...server, capability: "vision", cost_usd: 0.04 },
      { ...server, server_disc_id: "101", cost_usd: 0.25 },
      { ...server, server_disc_id: null, cost_usd: 0.1 },
    ];
    const first = buildSubscribePanel(fixture);
    expect(collectTextDisplays(first).join("\n")).toMatch(
      localizedProse("en-US", "commands.subscription.server_usage", { percent: "20.00%" }),
    );
    expect(flatten(first)).toContainEqual(
      expect.objectContaining({
        type: ComponentType.Thumbnail,
        media: { url: fixture.state.sponsoredServers[0]?.iconUrl },
      }),
    );
    fixture.route.selection = 41;
    const secondServer = fixture.state.sponsoredServers[1];
    if (!secondServer) throw new Error("Expected a second sponsored server");
    secondServer.iconUrl = null;
    const second = buildSubscribePanel(fixture);
    expect(collectTextDisplays(second).join("\n")).toMatch(
      localizedProse("en-US", "commands.subscription.server_usage", { percent: "25.00%" }),
    );
    expect(flatten(second).some((part) => part.type === ComponentType.Thumbnail)).toBe(false);
    fixture.aggregates = [];
    expect(collectTextDisplays(buildSubscribePanel(fixture)).join("\n")).toMatch(
      localizedProse("en-US", "commands.subscription.server_usage", { percent: "0.00%" }),
    );
    fixture.aggregates = undefined;
    expect(collectTextDisplays(buildSubscribePanel(fixture)).join("\n")).not.toMatch(
      localizedProse("en-US", "commands.subscription.server_usage"),
    );
  });

  it("acknowledges before loading and denies another user's private panel", async () => {
    let reads = 0;
    const interaction = await dispatch(
      input().route,
      {
        load: async () => {
          reads++;
          return input();
        },
      },
      { actor: "223456789012345678" },
    );
    expect(interaction.calls[0]?.method).toBe("deferUpdate");
    expect(reads).toBe(0);
    expect(interaction.replies).toHaveLength(1);
  });

  it("navigation does not refresh membership or mutate sponsorship", async () => {
    let writes = 0;
    const interaction = await dispatch(input("servers").route, {
      refresh: async () => {
        writes++;
        return undefined;
      },
      revoke: async () => {
        writes++;
        return null;
      },
    });
    expect(writes).toBe(0);
    expect(interaction.edits).toHaveLength(1);
  });

  it("initializes personal defaults when verification runs without server setup", async () => {
    const user = createUserRow({ user_id: 42, user_disc_id: OWNER });
    const userSpy = spyOn(userCache, "getCachedUserRow").mockResolvedValue(user);
    const stateSpy = spyOn(tomoriStateCache, "getCachedTomoriState").mockResolvedValue(null);
    const initializeSpy = spyOn(sponsorship, "ensurePersonalSupporterDefaults").mockResolvedValue(undefined);
    try {
      const route = input("refresh").route;
      const customId = buildSubscriptionRouteId(route);
      const interaction = createRouteInteraction({
        customId,
        guildId: "223456789012345678",
        overrides: { user: { id: OWNER, username: "Mirri", displayName: "Mirri", globalName: "Mirri" } },
      });
      const handler = createSubscriptionInteractionRoute({
        enabled: () => true,
        load: async (_interaction, nextRoute) => ({ ...input("refresh"), route: nextRoute }),
        refresh: async () => undefined,
      });
      const parsed = parseInteractionRoute(customId);
      if (!parsed) throw new Error("Expected the subscription route");
      await handler.execute({} as Client, interaction as never, parsed);
      expect(interaction.deferred).toBe(true);
      expect(initializeSpy).toHaveBeenCalledWith({
        kind: "personal",
        userId: user.user_id,
        serverDiscId: interaction.guildId,
        state: null,
      });
    } finally {
      userSpy.mockRestore();
      stateSpy.mockRestore();
      initializeSpy.mockRestore();
    }
  });

  it("initializes personal defaults after successful verification without implicitly sponsoring a server", async () => {
    for (const action of ["continue", "refresh"] as const) {
      for (const kind of ["active", "unlinked"] as const) {
        for (const failed of [true, false]) {
          let personal = 0;
          let sponsored = 0;
          await dispatch(
            { ...input(action).route, origin: "account" },
            {
              load: async (_interaction, route) => ({
                ...input(action),
                route,
                state: kind === "active" ? input().state : { kind: "unlinked" },
              }),
              refresh: async () =>
                failed
                  ? {
                      tone: "error",
                      heading: localizedCopy("en-US", "commands.subscription.name"),
                      detail: localizedCopy("en-US", "commands.subscription.refresh_failed"),
                    }
                  : undefined,
              link: async () => "https://www.patreon.com/oauth2/authorize?state=example",
              activatePersonal: async () => {
                personal++;
              },
              activateServer: async () => {
                sponsored++;
              },
            },
          );
          expect(personal).toBe(kind === "active" && !failed ? 1 : 0);
          expect(sponsored).toBe(0);
        }
      }
    }
  });

  it("preserves a sponsor intent through linking and verification, while account linking does not sponsor", async () => {
    let activations = 0;
    let returns = 0;
    const dependencies: Partial<SubscriptionRouteDependencies> = {
      link: async () => "https://www.patreon.com/oauth2/authorize?state=example",
      refresh: async () => undefined,
      activateServer: async () => {
        activations++;
      },
      back: async () => {
        returns++;
      },
    };
    const route = { ...input("link").route, origin: "sponsor" as const };
    await dispatch(route, dependencies);
    expect(activations).toBe(0);
    await dispatch({ ...route, action: "continue" }, dependencies);
    expect(activations).toBe(1);
    expect(returns).toBe(1);
    await dispatch({ ...route, action: "continue", origin: "account" }, dependencies);
    expect(activations).toBe(1);
  });

  it("explains a refused activation instead of reporting a generic failure", async () => {
    let returns = 0;
    const interaction = await dispatch(
      { ...input("activate").route, origin: "sponsor" },
      {
        activateServer: async () => {
          throw new SubscriptionActivationError("commands.subscribe.sponsorship.errors.exhausted");
        },
        back: async () => {
          returns++;
        },
      },
    );
    expect(returns).toBe(0);
    const body = collectTextDisplays(interaction.edits).join("\n");
    expect(body).toMatch(localizedProse("en-US", "commands.subscribe.sponsorship.errors.exhausted"));
    expect(body).not.toMatch(localizedProse("en-US", "commands.subscription.action_failed"));
  });

  it("explains a refused activation from a provider selector without leaving the panel", async () => {
    let returns = 0;
    const fake = createRouteInteraction({ kind: "string-select", values: ["action:subscribe"] });
    await showSubscriptionSurface({} as Client, fake as unknown as GlobalRoutableInteraction, "en-US", {
      origin: "sponsor",
      dependencies: {
        enabled: () => true,
        load: async (_interaction, route) => ({ ...input(), route }),
        activateServer: async () => {
          throw new SponsorshipConflictError();
        },
        back: async () => {
          returns++;
        },
      },
    });
    expect(returns).toBe(0);
    expect(fake.calls.filter((call) => call.method === "deferUpdate")).toHaveLength(1);
    expect(collectTextDisplays(fake.edits).join("\n")).toMatch(
      localizedProse("en-US", "commands.subscription.sponsor_conflict"),
    );
  });

  it("uses server removal copy for managers and returns cancellation to the provider panel", async () => {
    expectForEveryLocale((locale) => {
      const fixture = input("remove");
      fixture.route = { ...fixture.route, locale, origin: "server" };
      fixture.state = { kind: "unlinked" };
      fixture.removal = { serverLabel: "Mirri's Workshop", ownedByViewer: false };
      const panel = buildSubscribePanel(fixture);
      expectSafePanelPayload(panel as ComponentsV2MessagePayload, `manager removal ${locale}`);
      const body = collectTextDisplays(panel).join("\n");
      const prose = body.replace(/(?:^|\n)(?:#{1,3}|-#|>) /gu, "").replace(/\s/gu, "");
      expect(prose).toContain(
        localizedCopy(locale, "commands.subscription.remove_title", {
          server: escapeDiscordMarkdown("Mirri's Workshop"),
        }).replace(/\s/gu, ""),
      );
      expect(prose).toContain(localizedCopy(locale, "commands.subscription.remove_impact").replace(/\s/gu, ""));
      expect(prose).not.toContain(localizedCopy(locale, "commands.subscription.stop_impact").replace(/\s/gu, ""));
      const buttons = flatten(panel).filter((component) => component.type === ComponentType.Button);
      const cancel = buttons.find(
        (component) => component.label === localizedCopy(locale, "commands.subscription.cancel"),
      );
      const parsed = typeof cancel?.customId === "string" && parseInteractionRoute(cancel.customId);
      expect(parsed && parseSubscriptionRoute(parsed)?.action).toBe("back");
      expect(
        buttons.some((component) => component.label === localizedCopy(locale, "commands.providers.remove_sponsorship")),
      ).toBe(true);
    });
    let returned = false;
    await dispatch(
      { ...input("back").route, origin: "server" },
      {
        back: async (_interaction, _locale, personal) => {
          returned = !personal;
        },
      },
    );
    expect(returned).toBe(true);
  });

  it("loads the selected server for a non-sponsor manager without reading another account's subscription", async () => {
    process.env.TOMORI_SUPPORTER_CONFIG_JSON = JSON.stringify(config);
    const identitySpy = spyOn(supporterIdentityRepository, "loadByDiscordUserId").mockResolvedValue(null);
    const sponsorshipSpy = spyOn(supporterSponsorshipRepository, "loadActiveSponsorshipById").mockResolvedValue(
      makeSponsorship({ server_disc_id: "guild-1" }),
    );
    try {
      for (const [guildId, isManager, admitted] of [
        ["guild-1", true, true],
        ["guild-2", true, false],
        ["guild-1", false, false],
      ] as const) {
        const route = { ...input("remove").route, origin: "server" as const };
        const fake = createRouteInteraction({
          customId: buildSubscriptionRouteId(route),
          guildId,
          isManager,
          overrides: {
            user: {
              id: OWNER,
              username: "mirri",
              displayName: "Mirri",
              globalName: "Mirri",
              displayAvatarURL: () => "https://example.com/avatar.png",
            },
          },
        });
        Object.assign(fake.client, {
          guilds: { cache: new Map([["guild-1", { name: "Workshop", iconURL: () => null }]]) },
        });
        const parsed = parseInteractionRoute(fake.customId);
        if (!parsed) throw new Error("Expected subscription route");
        await createSubscriptionInteractionRoute({ enabled: () => true }).execute(
          {} as Client,
          fake as unknown as GlobalRoutableInteraction,
          parsed,
        );
        const body = collectTextDisplays(fake.edits).join("\n");
        expect(body.includes("Workshop")).toBe(admitted);
        if (admitted) expect(body).toMatch(localizedProse("en-US", "commands.subscription.remove_impact"));
      }
      expect(identitySpy.mock.calls.every(([discordId]) => discordId === OWNER)).toBe(true);
    } finally {
      identitySpy.mockRestore();
      sponsorshipSpy.mockRestore();
    }
  });

  it("returns sponsor and manager removals to the provider panel with the matching receipt", async () => {
    for (const ownedByViewer of [true, false]) {
      const receipts: (PanelReceipt | undefined)[] = [];
      await dispatch(
        { ...input("confirm").route, origin: "server" },
        {
          load: async (_interaction, route) => ({
            ...input(route.action),
            route,
            removal: { serverLabel: "Workshop", ownedByViewer },
          }),
          revoke: async () => makeSponsorship({ status: "revoked" }),
          back: async (_interaction, _locale, _personal, actionReceipt) => {
            receipts.push(actionReceipt);
          },
        },
      );
      expect(receipts).toHaveLength(1);
      expect(receipts[0]?.tone).toBe("info");
      expect(receipts[0]?.detail).toMatch(
        localizedProse("en-US", ownedByViewer ? "commands.subscription.stopped" : "commands.subscription.removed"),
      );
    }
  });

  it("confirms one sponsorship and repaints on a stale confirmation or failed write", async () => {
    const received: number[] = [];
    const fixture = input("confirm");
    const stale = await dispatch(fixture.route, {
      revoke: async (_interaction, id) => {
        received.push(id);
        return null;
      },
    });
    expect(received).toEqual([40]);
    expect(collectTextDisplays(stale.edits).join("\n")).toMatch(
      localizedProse("en-US", "commands.subscription.changed"),
    );
    const failed = await dispatch(fixture.route, {
      revoke: async () => {
        throw new Error("storage unavailable");
      },
    });
    expect(collectTextDisplays(failed.edits).join("\n")).toMatch(
      localizedProse("en-US", "commands.subscription.action_failed"),
    );
  });
});

describe("subscription membership refresh admission", () => {
  it("gates concurrent and failed attempts through the whole request and cooldown", async () => {
    process.env.TOMORI_SUPPORTER_CONFIG_JSON = JSON.stringify(config);
    let currentTime = new Date("2026-01-15T00:00:00Z").getTime();
    const clock = spyOn(Date, "now").mockImplementation(() => currentTime);
    const identity = spyOn(supporterIdentityRepository, "loadByDiscordUserId").mockResolvedValue(makeIdentity());
    const entitlement = spyOn(supporterEntitlementRepository, "loadByIdentityId").mockResolvedValue(makeEntitlement());
    const gate = Promise.withResolvers<void>();
    const refresh = spyOn(patreonReconcile, "refreshPatreonEntitlementForIdentity").mockImplementation(async () => {
      await gate.promise;
      throw new Error("synthetic-patreon-outage");
    });
    const user = "123456789012345671";
    try {
      const first = refreshSubscriptionMembership(user, "en-US");
      for (let count = 0; count < 5; count++) await Promise.resolve();
      expect(refresh).toHaveBeenCalledTimes(1);
      currentTime += 31_000;
      expect((await refreshSubscriptionMembership(user, "en-US"))?.detail).toContain("<t:");
      expect(refresh).toHaveBeenCalledTimes(1);
      gate.resolve();
      expect((await first)?.detail).toBe(localizedCopy("en-US", "commands.subscription.refresh_failed"));
      await refreshSubscriptionMembership(user, "en-US");
      expect(refresh).toHaveBeenCalledTimes(1);
      currentTime += 30_000;
      await refreshSubscriptionMembership(user, "en-US");
      expect(refresh).toHaveBeenCalledTimes(2);
    } finally {
      gate.resolve();
      clock.mockRestore();
      identity.mockRestore();
      entitlement.mockRestore();
      refresh.mockRestore();
    }
  });

  it("keeps the existing successful-verification retry time and performs no remote work for missing linkage", async () => {
    process.env.TOMORI_SUPPORTER_CONFIG_JSON = JSON.stringify(config);
    let currentTime = new Date("2026-01-15T00:00:00Z").getTime();
    const clock = spyOn(Date, "now").mockImplementation(() => currentTime);
    const identity = spyOn(supporterIdentityRepository, "loadByDiscordUserId").mockResolvedValue(makeIdentity());
    const entitlement = spyOn(supporterEntitlementRepository, "loadByIdentityId").mockResolvedValue(
      makeEntitlement({
        last_verified_at: new Date(currentTime - 25_000),
      }),
    );
    const refresh = spyOn(patreonReconcile, "refreshPatreonEntitlementForIdentity").mockRejectedValue(
      new Error("synthetic-outage"),
    );
    const user = "123456789012345672";
    try {
      const result = await refreshSubscriptionMembership(user, "en-US");
      expect(result?.detail).toBe(
        localizedCopy("en-US", "commands.subscription.cooldown", {
          time: `<t:${Math.floor((currentTime + 5000) / 1000)}:R>`,
        }),
      );
      expect(refresh).not.toHaveBeenCalled();
      currentTime += 5000;
      await refreshSubscriptionMembership(user, "en-US");
      expect(refresh).toHaveBeenCalledTimes(1);
      identity.mockResolvedValue(null);
      expect(await refreshSubscriptionMembership("123456789012345673", "en-US")).toBeUndefined();
      identity.mockResolvedValue(makeIdentity());
      entitlement.mockResolvedValue(null);
      expect(await refreshSubscriptionMembership("123456789012345674", "en-US")).toBeUndefined();
      expect(refresh).toHaveBeenCalledTimes(1);
      identity.mockRejectedValue(new Error("synthetic-database-outage"));
      expect((await refreshSubscriptionMembership("123456789012345675", "en-US"))?.detail).toBe(
        localizedCopy("en-US", "commands.subscription.refresh_failed"),
      );
      currentTime += 30_000;
      identity.mockResolvedValue(makeIdentity());
      entitlement.mockResolvedValue(makeEntitlement());
      await refreshSubscriptionMembership("123456789012345675", "en-US");
      expect(refresh).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
      identity.mockRestore();
      entitlement.mockRestore();
      refresh.mockRestore();
    }
  });
});
