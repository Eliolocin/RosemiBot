import { beforeAll, describe, expect, it } from "bun:test";
import { ButtonStyle, ComponentType } from "discord.js";
import type { GuildMcpServerRow } from "@/types/db/schema";
import type { PanelReceipt } from "@/types/discord/panel";
import { buildAddMcpModal } from "@/utils/discord/ui/mcpsPanel";
import { CONFIG_MCP_PANEL_ROUTE_ADAPTER } from "@/utils/discord/configPanelCatalog";
import {
  DISCORD_MESSAGE_TOTAL_COMPONENTS_MAX,
  validateComponentsV2MessageLimits,
} from "@/utils/discord/ui/componentsV2Limits";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy, localizedProse } from "../../helpers/localeCases";
import { buildConfigMcpPagePayload } from "../../helpers/configMcpPage";

beforeAll(async () => initializeLocalizer());

function row(id: number, overrides: Partial<GuildMcpServerRow> = {}): GuildMcpServerRow {
  return {
    guild_mcp_id: id,
    server_id: 1,
    name: `server-${id}`,
    url: `https://user:secret@example.com:${id}/private/path?token=secret#fragment`,
    auth_token: Buffer.from("ciphertext"),
    key_version: 9,
    is_enabled: true,
    server_type: null,
    created_at: new Date(id),
    ...overrides,
  };
}

function receipt(tone: PanelReceipt["tone"]): PanelReceipt {
  return { tone, heading: `${tone} heading`, detail: `${tone} detail` };
}

describe("MCP collection panel", () => {
  it("renders the compact healthy empty hierarchy and exact count", () => {
    const payload = buildConfigMcpPagePayload({
      locale: "en-US",
      scope: "guild",
      configs: [],
      readStatus: "fresh",
      page: { kind: "collection" },
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain("Registered MCPs `(0/10)`");
    expect(serialized).toContain(localizedCopy("en-US", "commands.mcps.empty_guild"));
    expect(serialized).toContain(`"type":${ComponentType.Separator}`);
    expect(serialized).toContain(
      `"style":${ButtonStyle.Secondary},"customId":"config:v2:mcp-add-open:en-US","label":"+ Add MCP"`,
    );
    expect(serialized).not.toContain('"label":"Retry"');
    expect(serialized).not.toContain('"label":"Refresh"');
    expect(serialized.indexOf(`"type":${ComponentType.Separator}`)).toBeLessThan(
      serialized.indexOf('"label":"+ Add MCP"'),
    );
    expect(serialized.indexOf('"label":"+ Add MCP"')).toBeLessThan(serialized.indexOf("Only add MCP servers"));
  });

  it("explains a failing streak and an automatic disable", () => {
    const failingSince = new Date(1_700_000_000_000);
    const serialized = JSON.stringify(
      buildConfigMcpPagePayload({
        locale: "en-US",
        scope: "guild",
        configs: [
          row(1, { failing_since: failingSince, failure_reason: "unauthorized" }),
          row(2, { is_enabled: false, failing_since: failingSince, failure_reason: "unreachable" }),
        ],
        readStatus: "fresh",
        page: { kind: "collection" },
      }),
    );
    expect(serialized).toMatch(
      localizedProse("en-US", "commands.mcps.connection_failing_unauthorized", { since: "<t:1700000000:R>" }),
    );
    expect(serialized).toMatch(localizedProse("en-US", "commands.mcps.auto_disabled_unreachable"));
    expect(serialized).not.toMatch(localizedProse("en-US", "commands.mcps.auto_disabled_unauthorized"));
    expect(serialized).not.toMatch(localizedProse("en-US", "commands.mcps.connection_failing_unreachable"));
  });

  it("renders every supported row in deterministic order with per-entity actions", () => {
    const configs = [
      row(3, { name: "third", created_at: new Date(10), is_enabled: false, server_type: "url_fetcher" }),
      row(2, { name: "second", created_at: new Date(10), server_type: "web_search", auth_token: null }),
      row(1, { name: "first", created_at: new Date(5) }),
      row(4),
    ];
    const payload = buildConfigMcpPagePayload({
      locale: "en-US",
      scope: "dm",
      configs,
      readStatus: "fresh",
      page: { kind: "collection", selectedId: 3, rangeIndex: 8 },
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain("Registered MCPs `(4/10)`");
    expect(serialized.indexOf("first")).toBeLessThan(serialized.indexOf("second"));
    expect(serialized.indexOf("second")).toBeLessThan(serialized.indexOf("third"));
    for (const id of [1, 2, 3, 4]) {
      expect(serialized).toContain(`config:v2:mcp-remove-prompt:en-US:${id}`);
      expect(serialized).toContain(`config:v2:mcp-set-enabled:en-US:${id}:`);
    }
    expect(serialized).toContain("- third (`https://example.com:3`)\\n> Disabled URL Fetcher Tool");
    expect(serialized).toContain("- second (`https://example.com:2`)\\n> Enabled Web Search Tool");
    const japanese = JSON.stringify(
      buildConfigMcpPagePayload({
        locale: "ja",
        scope: "dm",
        configs: [configs[0] as GuildMcpServerRow],
        readStatus: "fresh",
        page: { kind: "collection" },
      }),
    );
    expect(japanese).toContain("> URL取得ツール（無効）");
    expect(serialized).not.toContain("config:v2:mcp-select");
    expect(serialized).not.toContain("config:v2:mcp-range");
    // The only select on the page is the /config page picker, not an MCP row selector.
    expect(serialized).not.toMatch(new RegExp(`"type":${ComponentType.StringSelect},"customId":"config:v2:(?!page:)`));
    const result = validateComponentsV2MessageLimits(payload);
    expect(
      result.valid,
      `Components V2 limit ${DISCORD_MESSAGE_TOTAL_COMPONENTS_MAX} violations: ${JSON.stringify(result.violations)}`,
    ).toBe(true);
  });

  it("renders the compact row with a safe endpoint and no secret or auth metadata", () => {
    const serialized = JSON.stringify(
      buildConfigMcpPagePayload({
        locale: "en-US",
        scope: "guild",
        configs: [row(8443)],
        readStatus: "fresh",
        page: { kind: "collection" },
      }),
    );
    expect(serialized).toContain("- server\\\\-8443 (`https://example.com:8443`)\\n> Enabled General Purpose Tool");
    expect(serialized).not.toContain("Authentication");
    expect(serialized).not.toContain("Configured");
    expect(serialized).not.toContain("user:secret");
    expect(serialized).not.toContain("private/path");
    expect(serialized).not.toContain("token=secret");
    expect(serialized).not.toContain("ciphertext");
    expect(serialized).not.toContain("Online");
    expect(serialized).not.toContain("Offline");
  });

  it("distinguishes unknown, known-zero, and sanitized persisted tool snapshots without connecting", () => {
    const serialized = JSON.stringify(
      buildConfigMcpPagePayload({
        locale: "en-US",
        scope: "guild",
        configs: [
          row(1, { name: "legacy", last_discovered_tool_names: null }),
          row(2, { name: "zero", last_discovered_tool_names: [] }),
          row(3, { name: "known", last_discovered_tool_names: ["read_wiki", "`open`\nrepo\u0000"] }),
        ],
        readStatus: "fresh",
        page: { kind: "collection" },
      }),
    );
    expect(serialized).toContain(localizedCopy("en-US", "commands.mcps.tools_unknown"));
    expect(serialized).toContain(localizedCopy("en-US", "commands.mcps.tools_empty"));
    expect(serialized).toContain("Tools: `read_wiki`, `'open' repo`");
    expect(serialized).not.toContain("`open`");
  });

  it("disables all writes for stale rows while exposing only read-only Retry recovery", () => {
    const serialized = JSON.stringify(
      buildConfigMcpPagePayload({
        locale: "en-US",
        scope: "guild",
        configs: [row(1)],
        readStatus: "stale",
        page: { kind: "collection" },
      }),
    );
    expect(serialized).toContain("out of date");
    expect(serialized).toContain('"customId":"config:v2:mcp-set-enabled:en-US:1:0","label":"Disable","disabled":true');
    expect(serialized).toContain('"customId":"config:v2:mcp-remove-prompt:en-US:1","label":"Remove","disabled":true');
    expect(serialized).toContain('"customId":"config:v2:mcp-add-open:en-US","label":"+ Add MCP","disabled":true');
    expect(serialized).toContain('"customId":"config:v2:mcp-retry:en-US:1","label":"Retry"');
    expect(serialized).not.toContain('"label":"Refresh"');
  });

  it("paginates defensive overflow within the 40-component budget", () => {
    const payload = buildConfigMcpPagePayload({
      locale: "en-US",
      scope: "guild",
      configs: Array.from({ length: 8 }, (_, index) => row(index + 1)),
      readStatus: "stale",
      page: { kind: "collection", rangeIndex: 99 },
      receipt: receipt("warning"),
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain("Registered MCPs `(8/10)`");
    expect(serialized).toContain("Page 2 of 2");
    expect(serialized).toContain("config:v2:mcp-remove-prompt:en-US:7");
    expect(serialized).not.toContain("config:v2:mcp-remove-prompt:en-US:4");
    expect(serialized).toContain('"customId":"config:v2:mcp-add-open:en-US","label":"+ Add MCP","disabled":true');
    const result = validateComponentsV2MessageLimits(payload);
    expect(
      result.valid,
      `Components V2 limit ${DISCORD_MESSAGE_TOTAL_COMPONENTS_MAX} violations: ${JSON.stringify(result.violations)}`,
    ).toBe(true);
  });

  it("renders receipts as non-interactive top-level containers with semantic accents", () => {
    const accents = { success: 0x57f287, warning: 0xfee75c, error: 0xed4245, info: 0x65c6c5 } as const;
    for (const [tone, accent] of Object.entries(accents) as Array<[PanelReceipt["tone"], number]>) {
      const payload = buildConfigMcpPagePayload({
        locale: "en-US",
        scope: "dm",
        configs: [row(1)],
        readStatus: "fresh",
        page: { kind: "collection" },
        receipt: receipt(tone),
      });
      expect(payload.components).toHaveLength(2);
      const serializedPanel = JSON.stringify(payload.components[0]);
      const serializedReceipt = JSON.stringify(payload.components[1]);
      expect(serializedReceipt).toContain(`"accentColor":${accent}`);
      expect(serializedReceipt).toContain(`${tone} heading`);
      expect(serializedReceipt).not.toContain('"type":2');
      expect(serializedPanel).toContain('"accentColor":6670021');
      expect(serializedPanel).toContain("config:v2:mcp-set-enabled:en-US:1:0");
    }
  });

  it("shows invalid legacy endpoints as unavailable without leaking raw text", () => {
    const serialized = JSON.stringify(
      buildConfigMcpPagePayload({
        locale: "en-US",
        scope: "dm",
        configs: [row(1, { url: "not a URL", auth_token: null })],
        readStatus: "fresh",
        page: { kind: "collection" },
      }),
    );
    expect(serialized).toContain("Unavailable");
    expect(serialized).not.toContain("not a URL");
  });

  it("disables Add at the configured limit without disabling entity actions", () => {
    const serialized = JSON.stringify(
      buildConfigMcpPagePayload({
        locale: "en-US",
        scope: "guild",
        configs: Array.from({ length: 10 }, (_, index) => row(index + 1)),
        readStatus: "fresh",
        page: { kind: "collection" },
      }),
    );
    expect(serialized).toContain('"customId":"config:v2:mcp-add-open:en-US","label":"+ Add MCP","disabled":true');
    expect(serialized).toContain('"customId":"config:v2:mcp-set-enabled:en-US:1:0","label":"Disable","disabled":false');
  });

  it("never converts an absent Remove target into confirmation for a current row", () => {
    const serialized = JSON.stringify(
      buildConfigMcpPagePayload({
        locale: "en-US",
        scope: "guild",
        configs: [row(1)],
        readStatus: "fresh",
        page: { kind: "remove", entityId: 999 },
      }),
    );
    expect(serialized).toContain("config:v2:mcp-remove-prompt:en-US:1");
    expect(serialized).not.toContain("config:v2:mcp-remove-confirm:en-US:1");
  });

  it("distinguishes unavailable reads from an authoritative empty collection", () => {
    const unavailable = JSON.stringify(
      buildConfigMcpPagePayload({
        locale: "en-US",
        scope: "dm",
        configs: [],
        readStatus: "unavailable",
        page: { kind: "collection" },
      }),
    );
    const empty = JSON.stringify(
      buildConfigMcpPagePayload({
        locale: "en-US",
        scope: "dm",
        configs: [],
        readStatus: "fresh",
        page: { kind: "collection" },
      }),
    );
    expect(unavailable).toContain(localizedCopy("en-US", "commands.mcps.unavailable"));
    expect(unavailable).toContain('"label":"Retry"');
    expect(unavailable).not.toContain('"label":"+ Add MCP"');
    expect(empty).toContain(localizedCopy("en-US", "commands.mcps.empty_dm"));
    expect(empty).toContain('"label":"+ Add MCP"');
    expect(empty).not.toContain('"label":"Retry"');
  });

  it("builds a nonce-bounded Add modal with required, defaulted server type semantics", () => {
    const serialized = JSON.stringify(buildAddMcpModal("en-US", "12345678", CONFIG_MCP_PANEL_ROUTE_ADAPTER));
    expect(serialized).toContain('"custom_id":"config:v2:mcp-add-submit:en-US:12345678"');
    expect(serialized).toContain('"custom_id":"name_12345678"');
    expect(serialized).toContain('"custom_id":"url_12345678"');
    expect(serialized).toContain('"custom_id":"auth-token_12345678"');
    expect(serialized).toContain(
      `"description":${JSON.stringify(localizedCopy("en-US", "commands.mcps.server_type_description"))},"component":{"type":21,"custom_id":"server-type_12345678","required":true`,
    );
    expect(serialized).toContain('"value":"none","label":"General Purpose"');
    expect(serialized).toContain('"default":true');
    expect(serialized).toContain(localizedCopy("en-US", "commands.mcps.type_general_description"));
    expect(serialized).toContain('"value":"web_search","label":"Web Search"');
    expect(serialized).toContain(localizedCopy("en-US", "commands.mcps.type_web_search_description"));
    expect(serialized).toContain('"value":"url_fetcher","label":"URL Fetcher"');
    expect(serialized).toContain(localizedCopy("en-US", "commands.mcps.type_url_fetcher_description"));
    expect(serialized).toContain('"value":"prose_linter"');
    expect(serialized).toContain(localizedCopy("en-US", "commands.mcps.type_prose_linter_description"));
    expect(serialized).not.toContain('"label":"Server Type (Optional)"');
    expect(JSON.stringify(buildAddMcpModal("ja", "12345678", CONFIG_MCP_PANEL_ROUTE_ADAPTER))).not.toContain(
      '"label":"サーバータイプ（任意）"',
    );
  });
});
