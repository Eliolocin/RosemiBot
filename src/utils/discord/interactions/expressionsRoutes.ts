import { createHash, randomUUID } from "node:crypto";
import {
  MessageFlags,
  AttachmentBuilder,
  StickerFormatType,
  type APIAttachment,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { CustomExpressionMedia, CustomExpressionRow } from "@/types/db/schema";
import type { PanelReceipt } from "@/types/discord/panel";
import { serverRepository, ExpressionWriteError } from "@/utils/db/repositories/ServerRepository";
import { personaRepository } from "@/utils/db/repositories/PersonaRepository";
import { statRepository } from "@/utils/db/repositories/StatRepository";
import {
  EXPRESSIONS_ROUTE_NAMESPACE,
  EXPRESSIONS_ROUTE_VERSION,
  expressionFieldId,
  expressionPanelFingerprint,
  parseExpressionsPanelRoute,
  type ExpressionsPanelRoute,
} from "@/utils/discord/expressionsPanelCatalog";
import {
  buildExpressionPersonaModal,
  buildExpressionsEditModal,
  buildExpressionsPanelPayload,
  buildExpressionsTerminalPayload,
  resolveExpressionsSelection,
  type ExpressionPanelItem,
  type ExpressionsPanelData,
  type ExpressionPanelPreview,
} from "@/utils/discord/ui/expressionsPanel";
import { beginPanelInteraction, deliverGuardedPanel } from "@/utils/discord/interactions/panelController";
import type { GlobalInteractionRoute, GlobalRoutableInteraction } from "@/utils/discord/interactions/routeRegistry";
import { createNonce } from "@/utils/discord/panelRouteTokens";
import { showRoutedRawModal, takeRawModalFileUploads, takeRawModalSelectValue } from "@/utils/discord/ui/modals";
import { isStickerSendable } from "@/utils/discord/stickerAvailability";
import { nativeExpressionRevision } from "@/utils/text/expressionRevision";
import {
  prepareExpressionMedia,
  ExpressionMediaError,
  EXPRESSION_MEDIA_MAX_BYTES,
} from "@/utils/storage/expressionMedia";
import { deleteExpressionMedia, loadExpressionMedia } from "@/utils/storage/expressionStorage";
import { validateRemoteUrl } from "@/utils/security/remoteUrlSecurity";
import { DISCORD_BUTTON_URL_MAX } from "@/utils/discord/ui/componentsV2Limits";
import { recordPanelActionStat } from "@/utils/stats/panelActionMetrics";
import { buildPanelReceiptContainer } from "@/utils/discord/ui/panel";
import type { PanelAction } from "@/constants/panelActions";
import { localizer } from "@/utils/text/localizer";
import { log } from "@/utils/misc/logger";
import { MAX_CUSTOM_EXPRESSIONS_PER_SERVER } from "@/constants/expressionLimits";

type ExpressionInteraction = GlobalRoutableInteraction | ChatInputCommandInteraction;

async function authorize(interaction: ExpressionInteraction, refresh: boolean): Promise<boolean> {
  if (!interaction.guildId || !interaction.guild || !interaction.member) return false;
  if (!refresh) return interaction.memberPermissions?.has("ManageGuild") ?? false;
  const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
  return member?.permissions.has("ManageGuild") ?? false;
}

async function loadExpressionsPanelData(
  interaction: ExpressionInteraction,
  refresh: boolean,
): Promise<ExpressionsPanelData | null> {
  const guild = interaction.guild;
  if (!guild || !interaction.guildId) return null;
  const personas = await personaRepository.loadAllForServer(interaction.guildId);
  const serverId = personas[0]?.server_id;
  if (!serverId) return null;
  if (refresh) {
    await Promise.all([guild.emojis.fetch(), guild.stickers.fetch()]);
    await serverRepository.synchronizeExpressions(guild, serverId);
  }
  const [metadata, customs] = await Promise.all([
    serverRepository.loadExpressionPanelMetadata(serverId),
    serverRepository.loadCustomExpressions(serverId),
  ]);
  const native = (kind: "emojis" | "stickers"): ExpressionPanelItem[] =>
    metadata[kind].flatMap((row) => {
      const id = "emoji_disc_id" in row ? row.emoji_disc_id : row.sticker_disc_id;
      const asset = kind === "emojis" ? guild.emojis.cache.get(id) : guild.stickers.cache.get(id);
      if (!asset) return [];
      const description = "emoji_desc" in row ? row.emoji_desc : row.sticker_desc;
      const revision = nativeExpressionRevision(row);
      const thumbnail =
        "imageURL" in asset
          ? (asset.imageURL() ?? undefined)
          : asset.format === StickerFormatType.Lottie
            ? undefined
            : asset.url;
      return [
        {
          id,
          name: asset.name ?? "",
          description,
          emotion: row.emotion_key,
          initialized: !!description && !!row.emotion_key && row.emotion_key !== "unset",
          usable: "format" in asset ? isStickerSendable(asset) : asset.available !== false,
          revision,
          fp: expressionPanelFingerprint(serverId, interaction.user.id, id, revision),
          thumbnail,
        },
      ];
    });
  return {
    serverId,
    emojis: native("emojis"),
    stickers: native("stickers"),
    customs: customs.map((row) => ({
      id: row.custom_expression_id,
      name: row.name,
      description: row.description,
      emotion: row.emotion_key,
      initialized: true,
      usable: true,
      revision: row.revision,
      fp: expressionPanelFingerprint(serverId, interaction.user.id, row.custom_expression_id, row.revision),
      custom: row,
    })),
    personas: personas
      .flatMap((persona) => (persona.persona_id ? [{ id: persona.persona_id, name: persona.persona_nickname }] : []))
      .sort((a, b) => a.id - b.id),
  };
}

export interface ExpressionsRouteDependencies {
  authorize: typeof authorize;
  load: typeof loadExpressionsPanelData;
  writeNative: typeof serverRepository.writeNativeExpression;
  saveCustom: typeof serverRepository.saveCustomExpression;
  deleteCustom: typeof serverRepository.deleteCustomExpression;
  setPersona: typeof serverRepository.setCustomExpressionPersona;
  prepareMedia: typeof prepareExpressionMedia;
  deleteMedia: typeof deleteExpressionMedia;
  loadMedia: typeof loadExpressionMedia;
  validateUrl: typeof validateRemoteUrl;
  count: typeof statRepository.getServerExpressionCount;
  showModal: typeof showRoutedRawModal;
  takeSelect: typeof takeRawModalSelectValue;
  takeFiles(interactionId: string, customId: string): APIAttachment[];
  recordAction: typeof recordPanelActionStat;
  nonce: typeof createNonce;
}

const defaults: ExpressionsRouteDependencies = {
  authorize,
  load: loadExpressionsPanelData,
  writeNative: (...args) => serverRepository.writeNativeExpression(...args),
  saveCustom: (...args) => serverRepository.saveCustomExpression(...args),
  deleteCustom: (...args) => serverRepository.deleteCustomExpression(...args),
  setPersona: (...args) => serverRepository.setCustomExpressionPersona(...args),
  prepareMedia: prepareExpressionMedia,
  deleteMedia: deleteExpressionMedia,
  loadMedia: loadExpressionMedia,
  validateUrl: validateRemoteUrl,
  count: (...args) => statRepository.getServerExpressionCount(...args),
  showModal: showRoutedRawModal,
  takeSelect: takeRawModalSelectValue,
  takeFiles: takeRawModalFileUploads,
  recordAction: recordPanelActionStat,
  nonce: createNonce,
};

// Leave time for the modal acknowledgement before Discord's three-second deadline.
const MODAL_LOAD_DEADLINE_MS = 2_000;

async function loadForModal(interaction: ExpressionInteraction, deps: ExpressionsRouteDependencies) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const elapsed = typeof interaction.createdTimestamp === "number" ? Date.now() - interaction.createdTimestamp : 0;
  const remaining = Math.max(0, MODAL_LOAD_DEADLINE_MS - Math.max(0, elapsed));
  try {
    return await Promise.race([
      deps.load(interaction, false),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Expression modal load deadline exceeded")), remaining);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function receipt(locale: string, key: string, success = false): PanelReceipt {
  return {
    tone: success ? "success" : "error",
    heading: localizer(locale, `commands.expressions.manage.${success ? "saved_title" : "error_title"}`),
    detail: localizer(locale, `commands.expressions.manage.${key}`, { limit: MAX_CUSTOM_EXPRESSIONS_PER_SERVER }),
  };
}

async function resolveCustomPreview(
  interaction: ExpressionInteraction,
  row: CustomExpressionRow,
  deps: ExpressionsRouteDependencies,
): Promise<{ preview: ExpressionPanelPreview; files: AttachmentBuilder[]; attachments: Array<{ id: string }> }> {
  if (row.delivery_kind === "link") {
    const url = new URL(row.original_link ?? "");
    if (url.username || url.password || url.toString().length > 2000 || !(await deps.validateUrl(url.toString())).valid)
      throw new ExpressionMediaError("url");
    if (url.toString().length > DISCORD_BUTTON_URL_MAX) throw new ExpressionMediaError("url");
    return { preview: { kind: "link", url: url.toString() }, files: [], attachments: [] };
  }
  const limit = Math.min(EXPRESSION_MEDIA_MAX_BYTES, interaction.attachmentSizeLimit);
  if (!row.byte_size || row.byte_size > limit || !row.storage_reference || !row.extension)
    throw new ExpressionMediaError("size");
  // Metadata and whitelist edits advance revisions without changing the immutable stored object.
  const identity = createHash("sha256")
    .update(
      JSON.stringify([row.server_id, row.custom_expression_id, row.storage_reference, row.mime_type, row.byte_size]),
    )
    .digest("hex")
    .slice(0, 24);
  const name = `expression-preview-${identity}.${row.extension}`;
  const retained =
    "message" in interaction
      ? interaction.message?.attachments.find(
          (attachment) => attachment.name === name && attachment.size === row.byte_size,
        )
      : undefined;
  const preview: ExpressionPanelPreview = { kind: "gallery", url: `attachment://${name}` };
  if (retained) return { preview, files: [], attachments: [{ id: retained.id }] };
  // All expression backends currently load private objects through this helper; their references are not public URLs.
  const buffer = await deps.loadMedia(row.storage_reference, row.server_id, row.custom_expression_id);
  if (!buffer.length || buffer.length > limit || buffer.length !== row.byte_size)
    throw new ExpressionMediaError("size");
  return { preview, files: [new AttachmentBuilder(buffer, { name })], attachments: [] };
}

function logPreviewFailure(serverId: number, expressionId: string, error: unknown): void {
  log.warn("Expression panel preview failed", {
    serverId,
    metadata: { expressionId, errorType: error instanceof Error ? error.name : "unknown" },
  });
}

async function repaint(
  interaction: ExpressionInteraction,
  route: ExpressionsPanelRoute,
  data: ExpressionsPanelData,
  deps: ExpressionsRouteDependencies,
  feedback?: PanelReceipt,
  confirmDelete = false,
): Promise<void> {
  const { selected } = resolveExpressionsSelection(data, route.category, route.page, route.entityId);
  const count = selected
    ? await deps.count(
        data.serverId,
        route.category === "emojis"
          ? "emoji_used"
          : route.category === "stickers"
            ? "sticker_used"
            : "custom_expression_used",
        route.category === "customs" ? selected.id : selected.name,
      )
    : null;
  let media: Awaited<ReturnType<typeof resolveCustomPreview>> | undefined;
  if (route.category === "customs" && selected?.custom) {
    try {
      media = await resolveCustomPreview(interaction, selected.custom, deps);
    } catch (error) {
      logPreviewFailure(data.serverId, selected.id, error);
      media = { preview: { kind: "unavailable" }, files: [], attachments: [] };
    }
  }
  const input = {
    locale: route.locale,
    category: route.category,
    page: route.page,
    selectedId: route.entityId,
    personaPage: route.personaPage,
    data,
    usageCount: count,
    receipt: feedback,
    confirmDelete,
    preview: media?.preview,
  };
  const options = { method: "editReply" as const, locale: route.locale, receipt: feedback };
  try {
    await deliverGuardedPanel(
      interaction,
      {
        ...buildExpressionsPanelPayload(input),
        files: media?.files ?? [],
        attachments: media?.attachments ?? [],
      },
      options,
    );
  } catch (error) {
    if (!media || media.preview.kind === "unavailable") throw error;
    logPreviewFailure(data.serverId, selected?.id ?? "none", error);
    await deliverGuardedPanel(
      interaction,
      {
        ...buildExpressionsPanelPayload({ ...input, preview: { kind: "unavailable" } }),
        files: [],
        attachments: [],
      },
      options,
    );
  }
}

async function deny(interaction: ExpressionInteraction, locale: string, key: string): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await deliverGuardedPanel(interaction, buildExpressionsTerminalPayload(locale, key), {
      method: "editReply",
      locale,
    });
  } else await interaction.reply({ content: localizer(locale, key), flags: MessageFlags.Ephemeral });
}

export function createExpressionsInteractionRoute(
  overrides: Partial<ExpressionsRouteDependencies> = {},
): GlobalInteractionRoute {
  const deps = { ...defaults, ...overrides };
  return {
    namespace: EXPRESSIONS_ROUTE_NAMESPACE,
    version: EXPRESSIONS_ROUTE_VERSION,
    async execute(_client, interaction, parsed) {
      const route = parseExpressionsPanelRoute(parsed);
      if (!route) throw new Error("Malformed expressions route");
      const isSubmit = ["save", "allow", "deny"].includes(route.action);
      if (
        isSubmit
          ? !interaction.isModalSubmit()
          : route.action === "select"
            ? !interaction.isStringSelectMenu()
            : !interaction.isButton()
      )
        throw new Error("Expressions route interaction type mismatch");
      let selectedValue: string | undefined;
      if (interaction.isStringSelectMenu()) selectedValue = interaction.values[0];
      const opensModal =
        ["edit", "add-persona", "remove-persona"].includes(route.action) ||
        (route.action === "select" && route.category === "customs" && selectedValue === "add");
      let data: ExpressionsPanelData | null;
      if (opensModal) {
        if (!(await deps.authorize(interaction, false)))
          return deny(interaction, route.locale, "general.errors.permission_denied_description");
        try {
          data = await loadForModal(interaction, deps);
        } catch {
          return deny(interaction, route.locale, "commands.expressions.manage.unavailable");
        }
        if (!data) return deny(interaction, route.locale, "general.errors.tomori_not_setup_description");
      } else {
        data = await beginPanelInteraction(interaction, {
          authorize: () => deps.authorize(interaction, true),
          onDenied: () => deny(interaction, route.locale, "general.errors.permission_denied_description"),
          load: () => deps.load(interaction, ["view", "select", "page"].includes(route.action)),
          onMissing: () => deny(interaction, route.locale, "general.errors.tomori_not_setup_description"),
        });
        if (!data) return;
      }
      if (route.action === "select" && !opensModal) {
        const visible = resolveExpressionsSelection(data, route.category, route.page, route.entityId).visible;
        if (!visible.some((item) => item.id === selectedValue))
          return repaint(interaction, route, data, deps, receipt(route.locale, "error_stale"));
        route.entityId = selectedValue ?? "none";
      }
      const selected = data[route.category].find((item) => item.id === route.entityId);
      if (opensModal) {
        if (route.action === "select") {
          if (data.customs.length >= MAX_CUSTOM_EXPRESSIONS_PER_SERVER) {
            await interaction.reply({
              content: localizer(route.locale, "commands.expressions.manage.error_limit", {
                limit: MAX_CUSTOM_EXPRESSIONS_PER_SERVER,
              }),
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          const id = randomUUID();
          return deps.showModal(
            interaction as Parameters<typeof showRoutedRawModal>[0],
            buildExpressionsEditModal({
              ...route,
              entityId: id,
              fp: expressionPanelFingerprint(data.serverId, interaction.user.id, id, 0),
              nonce: deps.nonce(),
            }),
          );
        }
        if (!selected || selected.fp !== route.fp)
          return deny(interaction, route.locale, "commands.expressions.manage.error_stale");
        const modalRoute = { ...route, nonce: deps.nonce() };
        if (route.action === "edit")
          return deps.showModal(
            interaction as Parameters<typeof showRoutedRawModal>[0],
            buildExpressionsEditModal(modalRoute, selected),
          );
        if (!selected.custom) throw new ExpressionWriteError("scope");
        const add = route.action === "add-persona";
        const choices = data.personas
          .slice(route.personaPage * 25, (route.personaPage + 1) * 25)
          .filter((persona) => add !== selected.custom?.persona_ids.includes(persona.id));
        if (!choices.length) return deny(interaction, route.locale, "commands.expressions.manage.error_stale");
        return deps.showModal(
          interaction as Parameters<typeof showRoutedRawModal>[0],
          buildExpressionPersonaModal(modalRoute, choices, add),
        );
      }
      if (["view", "select", "page", "persona-page"].includes(route.action))
        return repaint(interaction, route, data, deps);
      if (route.action === "delete") {
        if (!selected?.custom || selected.fp !== route.fp)
          return repaint(interaction, route, data, deps, receipt(route.locale, "error_stale"));
        return repaint(interaction, route, data, deps, undefined, true);
      }
      let newMedia: CustomExpressionMedia | null = null;
      let committed = false;
      let feedback: PanelReceipt;
      try {
        let action: PanelAction;
        const creating = route.action === "save" && route.category === "customs" && !selected;
        if (
          creating
            ? route.fp !== expressionPanelFingerprint(data.serverId, interaction.user.id, route.entityId, 0)
            : !selected || selected.fp !== route.fp
        )
          throw new ExpressionWriteError("stale");
        if (isSubmit && route.nonce === "none") throw new ExpressionWriteError("invalid");
        if (creating && data.customs.length >= MAX_CUSTOM_EXPRESSIONS_PER_SERVER)
          throw new ExpressionWriteError("limit");
        if (route.action === "save") {
          const modal = interaction as ModalSubmitInteraction;
          const description = modal.fields.getTextInputValue(expressionFieldId(route.nonce, "description")).trim();
          const emotion =
            deps.takeSelect(modal.id, expressionFieldId(route.nonce, "emotion")) ?? selected?.emotion ?? "unset";
          if (route.category === "customs") {
            const name = modal.fields.getTextInputValue(expressionFieldId(route.nonce, "name")).trim();
            const link = modal.fields.getTextInputValue(expressionFieldId(route.nonce, "link"));
            const files = deps.takeFiles(modal.id, expressionFieldId(route.nonce, "file"));
            newMedia = await deps.prepareMedia(data.serverId, route.entityId, link, files, !creating);
            if (
              newMedia?.delivery_kind === "stored" &&
              newMedia.byte_size &&
              newMedia.byte_size > modal.attachmentSizeLimit
            )
              throw new ExpressionMediaError("size");
            const media = newMedia ?? selected?.custom;
            if (!media) throw new ExpressionMediaError("sources");
            // Downloads can take longer than Discord's permission snapshot remains authoritative.
            if (!(await deps.authorize(interaction, true))) throw new ExpressionWriteError("scope");
            const currentScope = await deps.load(interaction, false);
            if (!currentScope || currentScope.serverId !== data.serverId) throw new ExpressionWriteError("scope");
            await deps.saveCustom(data.serverId, route.entityId, creating ? null : Number(selected?.revision), {
              name,
              description,
              emotion_key: emotion,
              media,
              nativeStickerNames: currentScope.stickers.map((item) => item.name),
            });
            action = creating ? "expressions.workspace.custom.add" : "expressions.workspace.custom.edit";
          } else {
            if (!selected) throw new ExpressionWriteError("stale");
            await deps.writeNative(data.serverId, route.category, route.entityId, String(selected.revision), {
              description,
              emotion,
            });
            action = "expressions.workspace.native.edit";
          }
        } else if (route.action === "clear" && route.category !== "customs" && selected) {
          await deps.writeNative(data.serverId, route.category, route.entityId, String(selected.revision), null);
          action = "expressions.workspace.native.clear";
        } else if (route.action === "confirm" && selected?.custom) {
          if (!(await deps.deleteCustom(data.serverId, route.entityId, Number(selected.revision))))
            throw new ExpressionWriteError("stale");
          action = "expressions.workspace.custom.delete";
        } else if ((route.action === "allow" || route.action === "deny") && selected?.custom) {
          const persona = Number(deps.takeSelect(interaction.id, expressionFieldId(route.nonce, "persona")));
          const add = route.action === "allow";
          const choices = data.personas
            .slice(route.personaPage * 25, (route.personaPage + 1) * 25)
            .filter((item) => add !== selected.custom?.persona_ids.includes(item.id));
          if (!choices.some((item) => item.id === persona)) throw new ExpressionWriteError("scope");
          await deps.setPersona(data.serverId, route.entityId, Number(selected.revision), persona, add);
          action = add ? "expressions.workspace.whitelist.add" : "expressions.workspace.whitelist.remove";
        } else throw new ExpressionWriteError("invalid");
        committed = true;
        if (selected?.custom?.storage_reference && (newMedia || route.action === "confirm"))
          await deps.deleteMedia(selected.custom.storage_reference, data.serverId, selected.id);
        void deps.recordAction({ action, serverId: data.serverId, userDiscId: interaction.user.id });
        feedback = receipt(
          route.locale,
          route.action === "confirm" ? "deleted_detail" : route.action === "clear" ? "cleared_detail" : "saved_detail",
          true,
        );
      } catch (error) {
        if (newMedia?.storage_reference && !committed)
          await deps.deleteMedia(newMedia.storage_reference, data.serverId, route.entityId);
        const code =
          error instanceof ExpressionWriteError || error instanceof ExpressionMediaError ? error.code : "write";
        log.warn("Expression panel mutation failed", {
          serverId: data.serverId,
          metadata: { expressionId: route.entityId, code },
        });
        feedback = receipt(route.locale, `error_${code}`);
      }
      const refreshed = await deps.load(interaction, false).catch(() => null);
      if (!refreshed) {
        const payload = buildExpressionsTerminalPayload(route.locale, "commands.expressions.manage.unavailable");
        payload.components?.push(buildPanelReceiptContainer(feedback));
        return deliverGuardedPanel(interaction, payload, {
          method: "editReply",
          locale: route.locale,
          receipt: feedback,
        });
      }
      return repaint(interaction, route, refreshed, deps, feedback);
    },
  };
}

export const expressionsInteractionRoute = createExpressionsInteractionRoute();

export async function executeExpressionsManageCommand(
  interaction: ChatInputCommandInteraction,
  locale: string,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!(await authorize(interaction, true)))
    return deny(interaction, locale, "general.errors.permission_denied_description");
  const data = await loadExpressionsPanelData(interaction, true);
  if (!data) return deny(interaction, locale, "general.errors.tomori_not_setup_description");
  await repaint(
    interaction,
    {
      action: "view",
      locale,
      category: "emojis",
      page: 0,
      entityId: "none",
      fp: "none",
      personaPage: 0,
      nonce: "none",
    },
    data,
    defaults,
  );
}
