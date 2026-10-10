import {
  ButtonStyle,
  ChannelType,
  ComponentType,
  MessageFlags,
  TextInputStyle,
  type ActionRowData,
  type ButtonComponentData,
  type ComponentInContainerData,
  type StringSelectMenuComponentData,
  type TopLevelComponentData,
} from "discord.js";
import { CooldownType } from "@/types/db/schema";
import type { PanelReceipt } from "@/types/discord/panel";
import type { RawDiscordComponent } from "@/types/discord/rawApiTypes";
import { MODERATION_PANEL_RANGE_SIZE, resolveRangeSelection } from "@/utils/discord/interactions/panelController";
import {
  buildMemberAccessModalFieldId,
  buildModerationRemoveModalFieldId,
  buildModerationRouteId,
  buildModerationRouteSegments,
  buildPersonaChannelAddModalFieldId,
  buildQuotaModalFieldId,
  buildUserBlacklistAddModalFieldId,
  buildWhitelistChannelAddModalFieldId,
  buildWhitelistRoleAddModalFieldId,
  MODERATION_REMOVAL_MODAL_CAPACITY,
  MODERATION_ROUTE_NAMESPACE,
  MODERATION_ROUTE_VERSION,
  type ModerationCategory,
  type ModerationRemovalList,
  type QuotaType,
  type UserBlacklistRemovalTarget,
  type WhitelistPage,
} from "@/utils/discord/moderationPanelCatalog";
import {
  SERVER_MEMBER_PERMISSION_DEFINITIONS,
  type ServerMemberPermissionsCommandConfigState,
} from "@/utils/discord/memberPermissionsConfigMapping";
import { safeModalLocalizer, safeSelectOptionText } from "@/utils/discord/ui/modals";
import {
  buildCategoryButtonRow,
  buildPaginationRow,
  buildPanelContainer,
  buildPanelReceiptContainer,
  buildStateControlRow,
  withLinePrefix,
} from "@/utils/discord/ui/panel";
import type {
  ModerationMemberAccessData,
  ModerationScopeData,
  QuotaConfigState,
} from "@/utils/moderation/moderationOperations";
import { escapeDiscordMarkdown } from "@/utils/text/discordMarkdown";
import { buildTextPreview, textPreviewFooterKey, textPreviewFooterVars } from "@/utils/text/textPreview";
import { localizer } from "@/utils/text/localizer";

export interface ModerationPanelRenderInput {
  locale: string;
  category: ModerationCategory;
  whitelistPage: WhitelistPage;
  rangeIndex: number;
  data: ModerationScopeData;
  receipt?: PanelReceipt;
  removeTarget?: UserBlacklistRemovalTarget;
  channelRemoveTarget?: string;
  roleRemoveTarget?: string;
}

export interface ModerationPanelPayload {
  components: TopLevelComponentData[];
  flags: MessageFlags.IsComponentsV2;
}

function getCooldownTypeSuffix(cooldownType: CooldownType): string {
  switch (cooldownType) {
    case CooldownType.OFF:
      return "off";
    case CooldownType.PER_USER:
      return "per_user";
    case CooldownType.PER_CHANNEL:
      return "per_channel";
    case CooldownType.SERVER_WIDE:
      return "server_wide";
    case CooldownType.STRICT_SERVER_WIDE:
      return "strict_server_wide";
    default:
      return "off";
  }
}

function formatChannelCooldown(
  locale: string,
  cooldownType: CooldownType | null,
  cooldownLength: number | null,
): string {
  if (cooldownType === null || cooldownLength === null) {
    return localizer(locale, "commands.moderation.cooldown_inherited");
  }
  const typeKey = `commands.config.cooldown.type.choice_${getCooldownTypeSuffix(cooldownType)}`;
  const typeName = localizer(locale, typeKey);
  if (cooldownLength === 0) {
    return localizer(locale, "commands.moderation.cooldown_instant", { type: typeName });
  }
  return localizer(locale, "commands.moderation.cooldown_custom", {
    type: typeName,
    length: cooldownLength.toString(),
  });
}

function buildRetryButtonRow(
  locale: string,
  category: ModerationCategory,
  whitelistPage: WhitelistPage,
): ActionRowData<ButtonComponentData> {
  return {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        customId: buildModerationRouteId({
          action: "retry",
          locale,
          category,
          page: category === "whitelist" ? whitelistPage : "none",
        }),
        label: localizer(locale, "commands.moderation.retry"),
      },
    ],
  };
}

/**
 * Per-row preview budget for persona names displayed in moderation panels.
 *
 * In the persona-channels whitelist view, up to MODERATION_PANEL_RANGE_SIZE (10) rows are joined
 * into a single TextDisplay component. Each line also includes markdown prefix, channel mentions,
 * and a truncation notice when truncated (~80 codepoints). A budget of 200 ensures 10 lines
 * (10 * (200 + 80) = 2800) easily fit within Discord's 4000-codepoint TextDisplay limit.
 */
const MODERATION_NAME_PREVIEW_BUDGET = 200;

function renderModerationName(locale: string, value: string): string {
  const preview = buildTextPreview(value, MODERATION_NAME_PREVIEW_BUDGET);
  const rendered = escapeDiscordMarkdown(preview.text);
  const footerKey = textPreviewFooterKey(preview);
  if (!footerKey) return rendered;
  return `${rendered}\n-# ${localizer(locale, footerKey, textPreviewFooterVars(preview, locale))}`;
}

export const MODERATION_CATEGORY_LOCALE_KEYS: Record<ModerationCategory, string> = {
  "member-access": "commands.moderation.category_member_access",
  "user-blacklist": "commands.moderation.category_user_blacklist",
  whitelist: "commands.moderation.category_whitelist",
  quotas: "commands.moderation.category_quotas",
};

/** Every current entry of a removal list, encoded as the checkbox values its modal presents. */
export function listModerationRemovalValues(data: ModerationScopeData, list: ModerationRemovalList): string[] {
  switch (list) {
    case "user-blacklist":
      return [
        ...data.userBlacklist.personalizationUserIds.map((id) => `u:${id}`),
        ...data.userBlacklist.personaBlocks.map((block) => `b:${block.persona_id}:${block.user_disc_id}`),
      ];
    case "whitelist-channel":
      return data.whitelist.channels.map((row) => `c:${row.channel_disc_id}`);
    case "whitelist-role":
      return data.whitelist.roles.map((row) => `r:${row.role_disc_id}`);
    case "persona-channel":
      return data.whitelist.personaChannels.map((row) => `p:${row.persona_id}:${row.channel_disc_id}`);
  }
}

interface PersonaChannelGroup {
  personaId: number;
  channelIds: string[];
}

/**
 * Pages the persona-channel whitelist by persona, closing a page at ten personas or at one removal
 * modal of channel rows, so Remove can always present the page it sits on. A persona with more
 * channels than one modal holds is the only one split, across consecutive pages.
 */
export function pagePersonaChannels(
  rows: ModerationScopeData["whitelist"]["personaChannels"],
): PersonaChannelGroup[][] {
  const grouped = new Map<number, string[]>();
  for (const row of rows) {
    const channelIds = grouped.get(row.persona_id) ?? [];
    channelIds.push(row.channel_disc_id);
    grouped.set(row.persona_id, channelIds);
  }

  const pages: PersonaChannelGroup[][] = [];
  let page: PersonaChannelGroup[] = [];
  let pageRows = 0;
  for (const [personaId, channelIds] of grouped) {
    for (let offset = 0; offset < channelIds.length; offset += MODERATION_REMOVAL_MODAL_CAPACITY) {
      const chunk = channelIds.slice(offset, offset + MODERATION_REMOVAL_MODAL_CAPACITY);
      if (page.length === MODERATION_PANEL_RANGE_SIZE || pageRows + chunk.length > MODERATION_REMOVAL_MODAL_CAPACITY) {
        pages.push(page);
        page = [];
        pageRows = 0;
      }
      page.push({ personaId, channelIds: chunk });
      pageRows += chunk.length;
    }
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

/**
 * The removal values on one panel page, clamped the way the panel clamps its page. Remove presents
 * exactly these, so the modal always matches what the page shows.
 */
export function listModerationRemovalPage(
  data: ModerationScopeData,
  list: ModerationRemovalList,
  rangeIndex: number,
): string[] {
  if (list === "persona-channel") {
    const pages = pagePersonaChannels(data.whitelist.personaChannels);
    const page = pages[Math.min(Math.max(rangeIndex, 0), pages.length - 1)] ?? [];
    return page.flatMap((group) => group.channelIds.map((channelId) => `p:${group.personaId}:${channelId}`));
  }
  return resolveRangeSelection(listModerationRemovalValues(data, list), rangeIndex).visibleItems;
}

const REMOVAL_OPEN_ACTIONS = {
  "user-blacklist": "user-blacklist-remove-open",
  "whitelist-channel": "whitelist-channel-remove-open",
  "whitelist-role": "whitelist-role-remove-open",
  "persona-channel": "persona-channel-remove-open",
} as const satisfies Record<ModerationRemovalList, string>;

function buildRemoveButton(
  locale: string,
  list: ModerationRemovalList,
  rangeIndex: number,
  data: ModerationScopeData,
  labelKey: string,
): ButtonComponentData {
  return {
    type: ComponentType.Button,
    style: ButtonStyle.Danger,
    customId: buildModerationRouteId({ action: REMOVAL_OPEN_ACTIONS[list], locale, rangeIndex }),
    label: localizer(locale, labelKey),
    disabled: data.readStatus !== "fresh" || listModerationRemovalValues(data, list).length === 0,
  };
}

export function buildModerationPanelPayload(input: ModerationPanelRenderInput): ModerationPanelPayload {
  const { locale, category, whitelistPage, rangeIndex, data, receipt } = input;

  const categoryButtons = buildCategoryButtonRow(
    [
      {
        id: "member-access",
        label: localizer(locale, MODERATION_CATEGORY_LOCALE_KEYS["member-access"]),
        customId: buildModerationRouteId({ action: "category", locale, category: "member-access" }),
      },
      {
        id: "user-blacklist",
        label: localizer(locale, MODERATION_CATEGORY_LOCALE_KEYS["user-blacklist"]),
        customId: buildModerationRouteId({ action: "category", locale, category: "user-blacklist" }),
      },
      {
        id: "whitelist",
        label: localizer(locale, MODERATION_CATEGORY_LOCALE_KEYS.whitelist),
        customId: buildModerationRouteId({ action: "category", locale, category: "whitelist" }),
      },
      {
        id: "quotas",
        label: localizer(locale, MODERATION_CATEGORY_LOCALE_KEYS.quotas),
        customId: buildModerationRouteId({ action: "category", locale, category: "quotas" }),
      },
    ],
    category,
  );

  const components: ComponentInContainerData[] = [
    categoryButtons,
    { type: ComponentType.Separator, divider: true, spacing: 1 },
    {
      type: ComponentType.TextDisplay,
      content: `## ${localizer(locale, "commands.moderation.title")}`,
    },
  ];

  if (data.readStatus === "unavailable") {
    components.push(
      {
        type: ComponentType.TextDisplay,
        content: `### ${localizer(locale, "commands.moderation.unavailable")}`,
      },
      {
        ...buildRetryButtonRow(locale, category, whitelistPage),
      },
    );

    return {
      components: [buildPanelContainer(components), ...(receipt ? [buildPanelReceiptContainer(receipt)] : [])],
      flags: MessageFlags.IsComponentsV2,
    };
  }

  if (category === "member-access") {
    const memteaching = data.memberAccess.serverMemteachingEnabled
      ? localizer(locale, "commands.moderation.member_access_servermemories_enabled")
      : localizer(locale, "commands.moderation.member_access_servermemories_disabled");
    const attributes = data.memberAccess.attributeMemteachingEnabled
      ? localizer(locale, "commands.moderation.member_access_attributelist_enabled")
      : localizer(locale, "commands.moderation.member_access_attributelist_disabled");
    const dialogues = data.memberAccess.sampledialogueMemteachingEnabled
      ? localizer(locale, "commands.moderation.member_access_sampledialogues_enabled")
      : localizer(locale, "commands.moderation.member_access_sampledialogues_disabled");
    const snapshots = data.memberAccess.promptSnapshotEnabled
      ? localizer(locale, "commands.moderation.member_access_promptsnapshot_enabled")
      : localizer(locale, "commands.moderation.member_access_promptsnapshot_disabled");

    components.push(
      {
        type: ComponentType.TextDisplay,
        content: `### ${localizer(locale, "commands.moderation.member_access_title")}\n${localizer(locale, "commands.moderation.member_access_description")}`,
      },
      {
        type: ComponentType.TextDisplay,
        content: [memteaching, attributes, dialogues, snapshots].map((line) => `> ${line}`).join("\n"),
      },
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            style: ButtonStyle.Secondary,
            customId: buildModerationRouteId({ action: "member-access-open", locale }),
            label: localizer(locale, "commands.moderation.edit_permissions"),
            disabled: data.readStatus !== "fresh",
          },
        ],
      },
      {
        type: ComponentType.TextDisplay,
        content: `**${localizer(locale, "commands.moderation.model_access_title")}**\n${localizer(locale, "commands.moderation.model_access_description")}`,
      },
      buildStateControlRow(
        [
          {
            value: false,
            label: localizer(locale, "commands.moderation.model_access_personal_required_label"),
            customId: buildModerationRouteId({
              action: "model-access-set",
              locale,
              allowServerModels: false,
            }),
          },
          {
            value: true,
            label: localizer(locale, "commands.moderation.model_access_allowed_label"),
            customId: buildModerationRouteId({
              action: "model-access-set",
              locale,
              allowServerModels: true,
            }),
          },
        ],
        data.serverModelAccess.allowServerModels,
        data.readStatus !== "fresh",
      ),
      {
        type: ComponentType.TextDisplay,
        content: `> ${localizer(
          locale,
          data.serverModelAccess.allowServerModels
            ? "commands.moderation.model_access_allowed"
            : "commands.moderation.model_access_personal_required",
        )}`,
      },
    );
  } else if (category === "user-blacklist") {
    if (input.removeTarget) {
      const target = input.removeTarget;
      if (target.source === "personalization") {
        const isPresent = data.userBlacklist.personalizationUserIds.includes(target.userId);
        if (isPresent) {
          components.push(
            {
              type: ComponentType.TextDisplay,
              content: `### ${localizer(locale, "commands.moderation.user_blacklist_remove_title")}\n${localizer(
                locale,
                "commands.moderation.user_blacklist_remove_personalization_description",
                { user: `<@${target.userId}>` },
              )}`,
            },
            {
              type: ComponentType.ActionRow,
              components: [
                {
                  type: ComponentType.Button,
                  style: ButtonStyle.Danger,
                  customId: buildModerationRouteId({
                    action: "user-blacklist-remove-confirm",
                    locale,
                    target: { source: "personalization", userId: target.userId },
                  }),
                  label: localizer(locale, "commands.moderation.remove_confirm"),
                  disabled: data.readStatus !== "fresh",
                },
                {
                  type: ComponentType.Button,
                  style: ButtonStyle.Secondary,
                  customId: buildModerationRouteId({ action: "user-blacklist-remove-cancel", locale }),
                  label: localizer(locale, "commands.moderation.cancel"),
                },
              ],
            },
          );
          if (data.readStatus === "stale") {
            components.push(
              buildRetryButtonRow(locale, category, whitelistPage),
              { type: ComponentType.Separator, divider: true, spacing: 1 },
              {
                type: ComponentType.TextDisplay,
                content: withLinePrefix("-# ", localizer(locale, "commands.moderation.stale_warning")),
              },
            );
          }
          return {
            components: [buildPanelContainer(components), ...(receipt ? [buildPanelReceiptContainer(receipt)] : [])],
            flags: MessageFlags.IsComponentsV2,
          };
        }
      } else if (target.source === "persona-block") {
        const block = data.userBlacklist.personaBlocks.find(
          (b) => b.persona_id === target.personaId && b.user_disc_id === target.userId,
        );
        if (block) {
          const blockTypeLabel = localizer(locale, `tools.user_block.type_${block.block_type}`);
          components.push(
            {
              type: ComponentType.TextDisplay,
              content: `### ${localizer(locale, "commands.moderation.user_blacklist_remove_title")}\n${localizer(
                locale,
                "commands.moderation.user_blacklist_remove_persona_block_description",
                {
                  user: `<@${target.userId}>`,
                  persona: renderModerationName(locale, block.persona_name),
                  type: blockTypeLabel,
                },
              )}`,
            },
            {
              type: ComponentType.ActionRow,
              components: [
                {
                  type: ComponentType.Button,
                  style: ButtonStyle.Danger,
                  customId: buildModerationRouteId({
                    action: "user-blacklist-remove-confirm",
                    locale,
                    target: {
                      source: "persona-block",
                      personaId: target.personaId,
                      userId: target.userId,
                    },
                  }),
                  label: localizer(locale, "commands.moderation.remove_confirm"),
                  disabled: data.readStatus !== "fresh",
                },
                {
                  type: ComponentType.Button,
                  style: ButtonStyle.Secondary,
                  customId: buildModerationRouteId({ action: "user-blacklist-remove-cancel", locale }),
                  label: localizer(locale, "commands.moderation.cancel"),
                },
              ],
            },
          );
          if (data.readStatus === "stale") {
            components.push(
              buildRetryButtonRow(locale, category, whitelistPage),
              { type: ComponentType.Separator, divider: true, spacing: 1 },
              {
                type: ComponentType.TextDisplay,
                content: withLinePrefix("-# ", localizer(locale, "commands.moderation.stale_warning")),
              },
            );
          }
          return {
            components: [buildPanelContainer(components), ...(receipt ? [buildPanelReceiptContainer(receipt)] : [])],
            flags: MessageFlags.IsComponentsV2,
          };
        }
      }
    }

    const pCount = data.userBlacklist.personalizationUserIds.length;
    const bCount = data.userBlacklist.personaBlocks.length;
    const totalCount = pCount + bCount;

    const rangeCount = Math.max(1, Math.ceil(totalCount / MODERATION_PANEL_RANGE_SIZE));
    const clampedRangeIndex = Math.min(Math.max(rangeIndex, 0), rangeCount - 1);
    const start = clampedRangeIndex * MODERATION_PANEL_RANGE_SIZE;
    const end = start + MODERATION_PANEL_RANGE_SIZE;

    const pStart = Math.min(start, pCount);
    const pEnd = Math.min(end, pCount);
    const visiblePersonalization = pStart < pEnd ? data.userBlacklist.personalizationUserIds.slice(pStart, pEnd) : [];

    const bStart = Math.max(0, Math.min(start - pCount, bCount));
    const bEnd = Math.max(0, Math.min(end - pCount, bCount));
    const visiblePersonaBlocks = bStart < bEnd ? data.userBlacklist.personaBlocks.slice(bStart, bEnd) : [];

    components.push({
      type: ComponentType.TextDisplay,
      content: `### ${localizer(locale, "commands.moderation.user_blacklist_count", {
        count: totalCount,
      })}`,
    });

    components.push({
      type: ComponentType.TextDisplay,
      content: `**${localizer(locale, "commands.moderation.personalization_blacklist_section")}**`,
    });
    if (pCount === 0) {
      components.push({
        type: ComponentType.TextDisplay,
        content: localizer(locale, "commands.moderation.personalization_blacklist_empty"),
      });
    } else {
      components.push({
        type: ComponentType.TextDisplay,
        content: localizer(locale, "commands.moderation.personalization_blacklist_description"),
      });
      if (visiblePersonalization.length > 0) {
        components.push({
          type: ComponentType.TextDisplay,
          content: visiblePersonalization.map((userId) => `> <@${userId}>`).join("\n"),
        });
      }
    }

    components.push({
      type: ComponentType.TextDisplay,
      content: `**${localizer(locale, "commands.moderation.persona_blocks_section")}**`,
    });
    if (bCount === 0) {
      components.push({
        type: ComponentType.TextDisplay,
        content: localizer(locale, "commands.moderation.persona_blocks_empty"),
      });
    } else {
      components.push({
        type: ComponentType.TextDisplay,
        content: localizer(locale, "commands.moderation.persona_blocks_description"),
      });
      if (visiblePersonaBlocks.length > 0) {
        const lines = visiblePersonaBlocks.map((block) => {
          const blockTypeKey = `tools.user_block.type_${block.block_type}`;
          const typeLabel = localizer(locale, blockTypeKey);
          return `> <@${block.user_disc_id}> for **${renderModerationName(locale, block.persona_name)}** (${typeLabel})`;
        });
        components.push({
          type: ComponentType.TextDisplay,
          content: lines.join("\n"),
        });
      }
    }

    const paginationRow = buildPaginationRow({
      locale,
      rangeIndex: clampedRangeIndex,
      rangeCount,
      namespace: MODERATION_ROUTE_NAMESPACE,
      version: MODERATION_ROUTE_VERSION,
      buildSegments: {
        page: (targetRangeIndex) =>
          buildModerationRouteSegments({
            action: "range",
            locale,
            category: "user-blacklist",
            page: "none",
            rangeIndex: targetRangeIndex,
          }),
      },
    });
    if (paginationRow) components.push(paginationRow);

    components.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          customId: buildModerationRouteId({ action: "user-blacklist-add-open", locale }),
          label: localizer(locale, "commands.moderation.add_blacklist"),
          disabled: data.readStatus !== "fresh",
        },
        buildRemoveButton(locale, "user-blacklist", clampedRangeIndex, data, "commands.moderation.remove_blacklist"),
      ],
    });
  } else if (category === "whitelist") {
    const pageSelectMenu: ActionRowData<StringSelectMenuComponentData> = {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          customId: buildModerationRouteId({ action: "select-page", locale }),
          placeholder: localizer(locale, "commands.moderation.select_page_placeholder"),
          options: [
            {
              label: localizer(locale, "commands.moderation.page_channels"),
              value: "channels",
              description: localizer(locale, "commands.moderation.page_channels_description"),
              default: whitelistPage === "channels",
            },
            {
              label: localizer(locale, "commands.moderation.page_personas"),
              value: "persona-channels",
              description: localizer(locale, "commands.moderation.page_persona_channels_description"),
              default: whitelistPage === "persona-channels",
            },
            {
              label: localizer(locale, "commands.moderation.page_roles"),
              value: "roles",
              description: localizer(locale, "commands.moderation.page_roles_description"),
              default: whitelistPage === "roles",
            },
          ],
        },
      ],
    };

    components.push(pageSelectMenu);

    if (whitelistPage === "channels") {
      if (
        input.channelRemoveTarget &&
        data.whitelist.channels.some((c) => c.channel_disc_id === input.channelRemoveTarget)
      ) {
        components.push(
          {
            type: ComponentType.TextDisplay,
            content: `### ${localizer(locale, "commands.moderation.whitelist_channel_remove_title")}\n${localizer(
              locale,
              "commands.moderation.whitelist_channel_remove_description",
              { channel: `<#${input.channelRemoveTarget}>` },
            )}`,
          },
          {
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.Button,
                style: ButtonStyle.Danger,
                customId: buildModerationRouteId({
                  action: "whitelist-channel-remove-confirm",
                  locale,
                  channelId: input.channelRemoveTarget,
                }),
                label: localizer(locale, "commands.moderation.remove_confirm"),
                disabled: data.readStatus !== "fresh",
              },
              {
                type: ComponentType.Button,
                style: ButtonStyle.Secondary,
                customId: buildModerationRouteId({ action: "whitelist-channel-remove-cancel", locale }),
                label: localizer(locale, "commands.moderation.cancel"),
              },
            ],
          },
        );
      } else {
        const channels = data.whitelist.channels;

        components.push({
          type: ComponentType.TextDisplay,
          content: `### ${localizer(locale, "commands.moderation.whitelist_channels_count", {
            count: channels.length,
          })}`,
        });

        if (channels.length === 0) {
          components.push({
            type: ComponentType.TextDisplay,
            content: localizer(locale, "commands.moderation.whitelist_channels_empty"),
          });
        } else {
          components.push({
            type: ComponentType.TextDisplay,
            content: localizer(locale, "commands.moderation.whitelist_channels_description"),
          });

          const selection = resolveRangeSelection(channels, rangeIndex, MODERATION_PANEL_RANGE_SIZE);

          if (selection.visibleItems.length > 0) {
            const lines = selection.visibleItems.map((channel) => {
              const cooldown = formatChannelCooldown(locale, channel.cooldown_type, channel.cooldown_length);
              return `> <#${channel.channel_disc_id}>\n> ${cooldown}`;
            });
            components.push({
              type: ComponentType.TextDisplay,
              content: lines.join("\n"),
            });
          }

          const paginationRow = buildPaginationRow({
            locale,
            rangeIndex: selection.rangeIndex,
            rangeCount: selection.rangeCount,
            namespace: MODERATION_ROUTE_NAMESPACE,
            version: MODERATION_ROUTE_VERSION,
            buildSegments: {
              page: (targetRangeIndex) =>
                buildModerationRouteSegments({
                  action: "range",
                  locale,
                  category: "whitelist",
                  page: "channels",
                  rangeIndex: targetRangeIndex,
                }),
            },
          });
          if (paginationRow) components.push(paginationRow);
        }

        components.push({
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.Button,
              style: ButtonStyle.Secondary,
              customId: buildModerationRouteId({ action: "whitelist-channel-add-open", locale }),
              label: localizer(locale, "commands.moderation.add_or_edit_channel"),
              disabled: data.readStatus !== "fresh",
            },
            buildRemoveButton(locale, "whitelist-channel", rangeIndex, data, "commands.moderation.remove_channel"),
          ],
        });
      }
    } else if (whitelistPage === "persona-channels") {
      const pages = pagePersonaChannels(data.whitelist.personaChannels);
      const pageIndex = Math.min(Math.max(rangeIndex, 0), Math.max(0, pages.length - 1));

      components.push({
        type: ComponentType.TextDisplay,
        content: `### ${localizer(locale, "commands.moderation.whitelist_persona_channels_count", {
          count: new Set(data.whitelist.personaChannels.map((row) => row.persona_id)).size,
        })}`,
      });

      if (pages.length === 0) {
        components.push({
          type: ComponentType.TextDisplay,
          content: localizer(locale, "commands.moderation.whitelist_persona_channels_empty"),
        });
      } else {
        components.push({
          type: ComponentType.TextDisplay,
          content: localizer(locale, "commands.moderation.whitelist_persona_channels_description"),
        });

        const lines = (pages[pageIndex] ?? []).map((group) => {
          const channelMentions = group.channelIds.map((id) => `<#${id}>`).join(", ");
          const personaName = data.whitelist.personaNames.get(group.personaId) ?? `Persona ${group.personaId}`;
          return `> ${localizer(locale, "commands.moderation.persona_channels_restriction", {
            persona: renderModerationName(locale, personaName),
            channels: channelMentions,
          })}`;
        });

        components.push({
          type: ComponentType.TextDisplay,
          content: lines.join("\n"),
        });

        const paginationRow = buildPaginationRow({
          locale,
          rangeIndex: pageIndex,
          rangeCount: pages.length,
          namespace: MODERATION_ROUTE_NAMESPACE,
          version: MODERATION_ROUTE_VERSION,
          buildSegments: {
            page: (targetRangeIndex) =>
              buildModerationRouteSegments({
                action: "range",
                locale,
                category: "whitelist",
                page: "persona-channels",
                rangeIndex: targetRangeIndex,
              }),
          },
        });
        if (paginationRow) components.push(paginationRow);
      }

      components.push({
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            style: ButtonStyle.Secondary,
            customId: buildModerationRouteId({ action: "persona-channel-add-open", locale }),
            label: localizer(locale, "commands.moderation.add_persona"),
            disabled: data.readStatus !== "fresh",
          },
          buildRemoveButton(locale, "persona-channel", pageIndex, data, "commands.moderation.remove_persona"),
        ],
      });
    } else if (whitelistPage === "roles") {
      if (input.roleRemoveTarget && data.whitelist.roles.some((role) => role.role_disc_id === input.roleRemoveTarget)) {
        components.push(
          {
            type: ComponentType.TextDisplay,
            content: `### ${localizer(locale, "commands.moderation.whitelist_role_remove_title")}\n${localizer(
              locale,
              "commands.moderation.whitelist_role_remove_description",
              { role: `<@&${input.roleRemoveTarget}>` },
            )}`,
          },
          {
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.Button,
                style: ButtonStyle.Danger,
                customId: buildModerationRouteId({
                  action: "whitelist-role-remove-confirm",
                  locale,
                  roleId: input.roleRemoveTarget,
                }),
                label: localizer(locale, "commands.moderation.remove_confirm"),
                disabled: data.readStatus !== "fresh",
              },
              {
                type: ComponentType.Button,
                style: ButtonStyle.Secondary,
                customId: buildModerationRouteId({ action: "whitelist-role-remove-cancel", locale }),
                label: localizer(locale, "commands.moderation.cancel"),
              },
            ],
          },
        );
      } else {
        const roles = data.whitelist.roles;

        components.push({
          type: ComponentType.TextDisplay,
          content: `### ${localizer(locale, "commands.moderation.whitelist_roles_count", {
            count: roles.length,
          })}`,
        });

        if (roles.length === 0) {
          components.push({
            type: ComponentType.TextDisplay,
            content: localizer(locale, "commands.moderation.whitelist_roles_empty"),
          });
        } else {
          components.push({
            type: ComponentType.TextDisplay,
            content: localizer(locale, "commands.moderation.whitelist_roles_description"),
          });

          const selection = resolveRangeSelection(roles, rangeIndex, MODERATION_PANEL_RANGE_SIZE);
          if (selection.visibleItems.length > 0) {
            components.push({
              type: ComponentType.TextDisplay,
              content: selection.visibleItems.map((role) => `> <@&${role.role_disc_id}>`).join("\n"),
            });
          }

          const paginationRow = buildPaginationRow({
            locale,
            rangeIndex: selection.rangeIndex,
            rangeCount: selection.rangeCount,
            namespace: MODERATION_ROUTE_NAMESPACE,
            version: MODERATION_ROUTE_VERSION,
            buildSegments: {
              page: (targetRangeIndex) =>
                buildModerationRouteSegments({
                  action: "range",
                  locale,
                  category: "whitelist",
                  page: "roles",
                  rangeIndex: targetRangeIndex,
                }),
            },
          });
          if (paginationRow) components.push(paginationRow);
        }

        components.push({
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.Button,
              style: ButtonStyle.Secondary,
              customId: buildModerationRouteId({ action: "whitelist-role-add-open", locale }),
              label: localizer(locale, "commands.moderation.add_role"),
              disabled: data.readStatus !== "fresh",
            },
            buildRemoveButton(locale, "whitelist-role", rangeIndex, data, "commands.moderation.remove_role"),
          ],
        });
      }
    }
  } else if (category === "quotas") {
    const formatLimit = (limit: number) =>
      limit === 0 ? localizer(locale, "commands.moderation.quota_unlimited") : `\`${limit}\``;

    const quotaSections: ReadonlyArray<{ type: QuotaType; labelKey: string; buttonKey: string }> = [
      {
        type: "text",
        labelKey: "commands.moderation.quotas_text_generation",
        buttonKey: "commands.moderation.edit_text_quotas",
      },
      {
        type: "image",
        labelKey: "commands.moderation.quotas_image_generation",
        buttonKey: "commands.moderation.edit_image_quotas",
      },
      {
        type: "video",
        labelKey: "commands.moderation.quotas_video_generation",
        buttonKey: "commands.moderation.edit_video_quotas",
      },
    ];

    components.push({
      type: ComponentType.TextDisplay,
      content: `### ${localizer(locale, "commands.moderation.quotas_title")}\n${localizer(locale, "commands.moderation.quotas_description")}`,
    });

    for (const section of quotaSections) {
      const config = data.quotas[section.type];
      components.push(
        {
          type: ComponentType.TextDisplay,
          content: `**${localizer(locale, section.labelKey)}**`,
        },
        {
          type: ComponentType.TextDisplay,
          content: [
            `> ${localizer(locale, "commands.moderation.quota_daily_user_limit", { limit: formatLimit(config.daily_user_quota) })}`,
            `> ${localizer(locale, "commands.moderation.quota_serverwide_limit", { limit: formatLimit(config.serverwide_quota) })}`,
            `> ${localizer(locale, "commands.moderation.quota_reset_period", { days: `\`${config.serverwide_quota_resets_in}\`` })}`,
          ].join("\n"),
        },
      );
    }

    components.push({
      type: ComponentType.ActionRow,
      components: quotaSections.map(
        (section): ButtonComponentData => ({
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          customId: buildModerationRouteId({ action: "quota-edit-open", locale, quotaType: section.type }),
          label: localizer(locale, section.buttonKey),
          disabled: data.readStatus !== "fresh",
        }),
      ),
    });
  }
  if (data.readStatus === "stale") {
    components.push(
      buildRetryButtonRow(locale, category, whitelistPage),
      { type: ComponentType.Separator, divider: true, spacing: 1 },
      {
        type: ComponentType.TextDisplay,
        content: withLinePrefix("-# ", localizer(locale, "commands.moderation.stale_warning")),
      },
    );
  }

  return {
    components: [buildPanelContainer(components), ...(receipt ? [buildPanelReceiptContainer(receipt)] : [])],
    flags: MessageFlags.IsComponentsV2,
  };
}

export function buildMemberAccessModal(
  locale: string,
  state: ModerationMemberAccessData | ServerMemberPermissionsCommandConfigState,
  nonce: string,
): {
  custom_id: string;
  title: string;
  components: RawDiscordComponent[];
} {
  const configState: ServerMemberPermissionsCommandConfigState =
    "server_memteaching_enabled" in state
      ? state
      : {
          server_memteaching_enabled: state.serverMemteachingEnabled,
          attribute_memteaching_enabled: state.attributeMemteachingEnabled,
          sampledialogue_memteaching_enabled: state.sampledialogueMemteachingEnabled,
          prompt_snapshot_enabled: state.promptSnapshotEnabled,
        };

  const fieldId = buildMemberAccessModalFieldId(nonce);
  const options = SERVER_MEMBER_PERMISSION_DEFINITIONS.map((def) => ({
    value: def.value,
    label: safeSelectOptionText(localizer(locale, def.labelKey), 100),
    description: safeSelectOptionText(localizer(locale, def.descKey), 100),
    default: def.getState(configState),
  }));

  return {
    custom_id: buildModerationRouteId({ action: "member-access-submit", locale, nonce }),
    title: safeSelectOptionText(localizer(locale, "commands.server.member-permissions.select_embed_title"), 45),
    components: [
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.server.member-permissions.select_placeholder"), 45),
        description: safeModalLocalizer(locale, "commands.server.member-permissions.select_embed_description"),
        component: {
          type: 22,
          custom_id: fieldId,
          min_values: 0,
          max_values: 4,
          required: false,
          options,
        },
      },
    ],
  };
}

export function buildUserBlacklistAddModal(
  locale: string,
  nonce: string,
): {
  custom_id: string;
  title: string;
  components: RawDiscordComponent[];
} {
  const fieldId = buildUserBlacklistAddModalFieldId(nonce);
  return {
    custom_id: buildModerationRouteId({ action: "user-blacklist-add-submit", locale, nonce }),
    title: safeSelectOptionText(localizer(locale, "commands.moderation.user_blacklist_add_title"), 45),
    components: [
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.moderation.user_blacklist_add_label"), 45),
        description: safeModalLocalizer(locale, "commands.moderation.user_blacklist_add_description"),
        component: {
          type: 5,
          custom_id: fieldId,
          min_values: 1,
          max_values: 1,
          required: true,
        },
      },
    ],
  };
}

export function buildWhitelistChannelAddModal(
  locale: string,
  nonce: string,
): {
  custom_id: string;
  title: string;
  components: RawDiscordComponent[];
} {
  return {
    custom_id: buildModerationRouteId({ action: "whitelist-channel-add-submit", locale, nonce }),
    title: safeSelectOptionText(localizer(locale, "commands.moderation.whitelist_channel_add_title"), 45),
    components: [
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.moderation.whitelist_channel_add_channel_label"), 45),
        description: safeModalLocalizer(locale, "commands.moderation.whitelist_channel_add_channel_description"),
        component: {
          type: 8,
          custom_id: buildWhitelistChannelAddModalFieldId(nonce, "channel"),
          channel_types: [ChannelType.GuildText],
          min_values: 1,
          max_values: 1,
          required: true,
        },
      },
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.moderation.whitelist_channel_add_type_label"), 45),
        description: safeModalLocalizer(locale, "commands.moderation.whitelist_channel_add_type_description"),
        component: {
          type: 3,
          custom_id: buildWhitelistChannelAddModalFieldId(nonce, "type"),
          placeholder: safeSelectOptionText(
            localizer(locale, "commands.moderation.whitelist_channel_add_type_placeholder"),
            150,
          ),
          required: false,
          options: [
            {
              label: safeSelectOptionText(localizer(locale, "commands.config.cooldown.type.choice_off"), 100),
              value: "0",
            },
            {
              label: safeSelectOptionText(localizer(locale, "commands.config.cooldown.type.choice_per_user"), 100),
              value: "1",
            },
            {
              label: safeSelectOptionText(localizer(locale, "commands.config.cooldown.type.choice_per_channel"), 100),
              value: "2",
            },
            {
              label: safeSelectOptionText(localizer(locale, "commands.config.cooldown.type.choice_server_wide"), 100),
              value: "3",
            },
          ],
        },
      },
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.moderation.whitelist_channel_add_length_label"), 45),
        description: safeModalLocalizer(locale, "commands.moderation.whitelist_channel_add_length_description"),
        component: {
          type: 4,
          custom_id: buildWhitelistChannelAddModalFieldId(nonce, "length"),
          style: TextInputStyle.Short,
          placeholder: safeSelectOptionText(
            localizer(locale, "commands.moderation.whitelist_channel_add_length_placeholder"),
            100,
          ),
          required: false,
          max_length: 5,
        },
      },
    ],
  };
}

export function buildWhitelistRoleAddModal(
  locale: string,
  nonce: string,
): { custom_id: string; title: string; components: RawDiscordComponent[] } {
  return {
    custom_id: buildModerationRouteId({ action: "whitelist-role-add-submit", locale, nonce }),
    title: safeSelectOptionText(localizer(locale, "commands.moderation.whitelist_role_add_title"), 45),
    components: [
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.moderation.whitelist_role_add_label"), 45),
        description: safeModalLocalizer(locale, "commands.moderation.whitelist_role_add_description"),
        component: {
          type: 6,
          custom_id: buildWhitelistRoleAddModalFieldId(nonce),
          min_values: 1,
          max_values: 1,
          required: true,
        },
      },
    ],
  };
}

export interface ModerationRemovalOption {
  value: string;
  label: string;
  description?: string;
}

export function buildModerationRemovalModal(
  locale: string,
  nonce: string,
  action: ModerationRemovalList,
  options: readonly ModerationRemovalOption[],
): { custom_id: string; title: string; components: RawDiscordComponent[] } {
  const removalSubmitActionMap = {
    "user-blacklist": "user-blacklist-remove-submit",
    "whitelist-channel": "whitelist-channel-remove-submit",
    "whitelist-role": "whitelist-role-remove-submit",
    "persona-channel": "persona-channel-remove-submit",
  } as const;
  const submitAction = removalSubmitActionMap[action];

  const titleKeys = {
    "user-blacklist": "commands.moderation.user_blacklist_bulk_remove_title",
    "whitelist-channel": "commands.moderation.whitelist_channel_bulk_remove_title",
    "whitelist-role": "commands.moderation.whitelist_role_bulk_remove_title",
    "persona-channel": "commands.moderation.persona_channel_remove_title",
  } as const;
  const groupTitleKeys = {
    "user-blacklist": "commands.moderation.remove_user_blacklist_group_title",
    "whitelist-channel": "commands.moderation.remove_whitelist_channel_group_title",
    "whitelist-role": "commands.moderation.remove_whitelist_role_group_title",
    "persona-channel": "commands.moderation.remove_persona_channel_group_title",
  } as const;
  const groupDescriptionKey =
    action === "user-blacklist"
      ? "commands.moderation.remove_blacklist_group_description"
      : "commands.moderation.remove_whitelist_group_description";
  const groups: RawDiscordComponent[] = [];
  for (let index = 0; index < options.length; index += 10) {
    const groupIndex = Math.floor(index / 10);
    const groupOptions = options.slice(index, index + 10);
    groups.push({
      type: 18,
      label: safeSelectOptionText(
        groupIndex === 0
          ? localizer(locale, groupTitleKeys[action])
          : localizer(locale, "commands.moderation.remove_group_continuation", { index: groupIndex }),
        45,
      ),
      ...(groupIndex === 0 ? { description: safeModalLocalizer(locale, groupDescriptionKey) } : {}),
      component: {
        type: 22,
        custom_id: buildModerationRemoveModalFieldId(nonce, groupIndex),
        min_values: 0,
        max_values: groupOptions.length,
        required: false,
        options: groupOptions.map((option) => ({
          value: option.value,
          label: safeSelectOptionText(option.label, 100),
          ...(option.description ? { description: safeSelectOptionText(option.description, 100) } : {}),
          default: true,
        })),
      },
    });
  }
  return {
    custom_id: buildModerationRouteId({ action: submitAction, locale, nonce }),
    title: safeSelectOptionText(localizer(locale, titleKeys[action]), 45),
    components: groups,
  };
}

export function buildPersonaChannelAddModal(
  locale: string,
  nonce: string,
  personas: ReadonlyMap<number, string>,
): { custom_id: string; title: string; components: RawDiscordComponent[] } {
  return {
    custom_id: buildModerationRouteId({ action: "persona-channel-add-submit", locale, nonce }),
    title: safeSelectOptionText(localizer(locale, "commands.moderation.persona_channel_add_title"), 45),
    components: [
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.moderation.persona_channel_add_persona_label"), 45),
        description: safeModalLocalizer(locale, "commands.moderation.persona_channel_add_persona_description"),
        component: {
          type: 3,
          custom_id: buildPersonaChannelAddModalFieldId(nonce, "persona"),
          min_values: 1,
          max_values: 1,
          required: true,
          options: [...personas.entries()].map(([personaId, name]) => ({
            label: safeSelectOptionText(name, 100),
            value: String(personaId),
          })),
        },
      },
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.moderation.persona_channel_add_channel_label"), 45),
        description: safeModalLocalizer(locale, "commands.moderation.persona_channel_add_channel_description"),
        component: {
          type: 8,
          custom_id: buildPersonaChannelAddModalFieldId(nonce, "channel"),
          channel_types: [ChannelType.GuildText],
          min_values: 1,
          max_values: 1,
          required: true,
        },
      },
    ],
  };
}

export function buildQuotaEditModal(
  locale: string,
  quotaType: QuotaType,
  currentConfig: QuotaConfigState,
  nonce: string,
): {
  custom_id: string;
  title: string;
  components: RawDiscordComponent[];
} {
  const titleKeys = {
    image: "commands.moderation.quota_modal_image_title",
    text: "commands.moderation.quota_modal_text_title",
    video: "commands.moderation.quota_modal_video_title",
  } as const;

  return {
    custom_id: buildModerationRouteId({ action: "quota-edit-submit", locale, quotaType, nonce }),
    title: safeSelectOptionText(localizer(locale, titleKeys[quotaType]), 45),
    components: [
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.moderation.quota_daily_user_limit_label"), 45),
        description: safeModalLocalizer(locale, "commands.moderation.quota_daily_user_limit_description"),
        component: {
          type: 4,
          custom_id: buildQuotaModalFieldId(nonce, "daily_user_quota"),
          style: TextInputStyle.Short,
          value: String(currentConfig.daily_user_quota),
          required: true,
        },
      },
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.moderation.quota_serverwide_limit_label"), 45),
        description: safeModalLocalizer(locale, "commands.moderation.quota_serverwide_limit_description"),
        component: {
          type: 4,
          custom_id: buildQuotaModalFieldId(nonce, "serverwide_quota"),
          style: TextInputStyle.Short,
          value: String(currentConfig.serverwide_quota),
          required: true,
        },
      },
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.moderation.quota_reset_days_label"), 45),
        description: safeModalLocalizer(locale, "commands.moderation.quota_reset_days_description"),
        component: {
          type: 4,
          custom_id: buildQuotaModalFieldId(nonce, "serverwide_quota_resets_in"),
          style: TextInputStyle.Short,
          value: String(currentConfig.serverwide_quota_resets_in),
          required: true,
        },
      },
    ],
  };
}
