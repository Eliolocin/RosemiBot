import { beforeAll, describe, expect, it, mock } from "bun:test";
import {
  ComponentType,
  type Client,
  type InteractionEditReplyOptions,
  type ContainerComponentData,
  type AttachmentBuilder,
} from "discord.js";
import type { GlobalRoutableInteraction } from "@/utils/discord/interactions/routeRegistry";
import { parseInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import {
  createExpressionsInteractionRoute,
  type ExpressionsRouteDependencies,
} from "@/utils/discord/interactions/expressionsRoutes";
import {
  buildExpressionsRouteId,
  expressionFieldId,
  expressionPanelFingerprint,
  type ExpressionsPanelRoute,
} from "@/utils/discord/expressionsPanelCatalog";
import type { ExpressionsPanelData } from "@/utils/discord/ui/expressionsPanel";
import type { CustomExpressionRow } from "@/types/db/schema";
import { ExpressionWriteError } from "@/utils/db/repositories/ServerRepository";
import { ExpressionMediaError } from "@/utils/storage/expressionMedia";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createCustomExpression } from "../../helpers/fixtures";
import {
  createRouteInteraction,
  type RouteInteractionOptions,
  type RouteInteraction,
} from "../../helpers/routeInteraction";
import { collectTextDisplays } from "../../helpers/panelLimits";
import { localizedCopy, localizedProse } from "../../helpers/localeCases";
import { MAX_CUSTOM_EXPRESSIONS_PER_SERVER } from "@/constants/expressionLimits";

beforeAll(async () => initializeLocalizer());

const PNG_MEDIA = { mime_type: "image/png", extension: "png", byte_size: 100 } as const;

function harness(overrides: Partial<ExpressionsRouteDependencies> = {}) {
  const actor = createRouteInteraction().user.id;
  const row = createCustomExpression();
  const fp = expressionPanelFingerprint(row.server_id, actor, row.custom_expression_id, row.revision);
  const data: ExpressionsPanelData = {
    serverId: row.server_id,
    emojis: [],
    stickers: [],
    customs: [
      {
        id: row.custom_expression_id,
        name: row.name,
        description: row.description,
        emotion: row.emotion_key,
        revision: row.revision,
        initialized: true,
        usable: true,
        fp,
        custom: row,
      },
    ],
    personas: Array.from({ length: 27 }, (_, i) => ({ id: i + 1, name: `Persona ${i + 1}` })),
  };
  const save = mock(async (..._args: Parameters<ExpressionsRouteDependencies["saveCustom"]>) => {});
  const cleanup = mock(async (..._args: Parameters<ExpressionsRouteDependencies["deleteMedia"]>) => {});
  const show = mock(async (..._args: Parameters<ExpressionsRouteDependencies["showModal"]>) => {});
  const prepare = mock(async () => null);
  const allow = mock(async (..._args: Parameters<ExpressionsRouteDependencies["setPersona"]>) => {});
  const authorize = mock(async () => true);
  const loadMedia = mock(async () => Buffer.alloc(100));
  const validateUrl = mock(async () => ({ valid: true }));
  const dependencies: Partial<ExpressionsRouteDependencies> = {
    load: async () => data,
    authorize,
    loadMedia,
    validateUrl,
    count: async () => 9,
    saveCustom: save,
    deleteMedia: cleanup,
    prepareMedia: prepare,
    takeFiles: () => [],
    takeSelect: () => "joy",
    showModal: show,
    recordAction: async () => {},
    setPersona: allow,
    nonce: () => "abcdef123456",
    ...overrides,
  };
  const route = createExpressionsInteractionRoute(dependencies);
  const state: ExpressionsPanelRoute = {
    action: "save",
    locale: "en-US",
    category: "customs",
    page: 0,
    entityId: row.custom_expression_id,
    fp,
    personaPage: 0,
    nonce: "abcdef123456",
  };
  const dispatch = async (
    changes: Partial<ExpressionsPanelRoute> = {},
    fields: Record<string, string> = {},
    kind: "button" | "modal" | "string-select" = "modal",
    values: string[] = [],
    options: Pick<RouteInteractionOptions, "messageAttachments" | "attachmentSizeLimit" | "onEditReply"> = {},
  ) => {
    const customId = buildExpressionsRouteId({ ...state, ...changes });
    const interaction = createRouteInteraction({
      customId,
      kind,
      fields: {
        [expressionFieldId(state.nonce, "name")]: row.name,
        [expressionFieldId(state.nonce, "description")]: row.description,
        [expressionFieldId(state.nonce, "link")]: "",
        ...fields,
      },
      values,
      ...options,
    });
    const parsed = parseInteractionRoute(customId);
    if (!parsed) throw new Error("Invalid fixture route");
    await route.execute({} as Client, interaction as unknown as GlobalRoutableInteraction, parsed);
    return interaction;
  };
  return { data, row, save, cleanup, show, prepare, allow, authorize, loadMedia, validateUrl, dispatch };
}

describe("expressions routed mutations", () => {
  it("rejects additions at capacity before opening a modal or processing media and still allows edits", async () => {
    const h = harness();
    h.data.customs = Array.from({ length: MAX_CUSTOM_EXPRESSIONS_PER_SERVER }, (_, index) => {
      if (index === 0) return h.data.customs[0];
      const row = createCustomExpression({
        custom_expression_id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
        name: `Expression ${index}`,
      });
      return {
        ...h.data.customs[0],
        id: row.custom_expression_id,
        name: row.name,
        custom: row,
        fp: expressionPanelFingerprint(
          row.server_id,
          createRouteInteraction().user.id,
          row.custom_expression_id,
          row.revision,
        ),
      };
    });
    const opened = await h.dispatch({ action: "select" }, {}, "string-select", ["add"]);
    expect(opened.calls[0]?.method).toBe("reply");
    expect(h.show).not.toHaveBeenCalled();
    const id = "00000000-0000-4000-8000-999999999999";
    const submitted = await h.dispatch({
      entityId: id,
      fp: expressionPanelFingerprint(h.data.serverId, opened.user.id, id, 0),
    });
    expect(submitted.calls[0]?.method).toBe("deferUpdate");
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.save).not.toHaveBeenCalled();
    const payload = submitted.calls.find((call) => call.method === "editReply")?.payload as InteractionEditReplyOptions;
    expect(collectTextDisplays(payload).join(" ")).toMatch(
      localizedProse("en-US", "commands.expressions.manage.error_limit", { limit: MAX_CUSTOM_EXPRESSIONS_PER_SERVER }),
    );
    await h.dispatch();
    expect(h.save).toHaveBeenCalledTimes(1);
  });

  it("cleans uploaded media when another manager fills the last slot during preparation", async () => {
    const id = "00000000-0000-4000-8000-999999999999";
    const reference = `custom-expressions/1/${id}/00000000-0000-4000-8000-000000000002.png`;
    const stored = createCustomExpression({
      source_kind: "upload",
      delivery_kind: "stored",
      original_link: null,
      storage_reference: reference,
      ...PNG_MEDIA,
    });
    const h = harness({
      prepareMedia: async () => stored,
      saveCustom: async () => {
        throw new ExpressionWriteError("limit");
      },
    });
    const interaction = await h.dispatch({
      entityId: id,
      fp: expressionPanelFingerprint(h.data.serverId, createRouteInteraction().user.id, id, 0),
    });
    expect(h.cleanup.mock.calls.map((call) => call[0])).toEqual([reference]);
    const payload = interaction.calls.find((call) => call.method === "editReply")
      ?.payload as InteractionEditReplyOptions;
    expect(collectTextDisplays(payload).join(" ")).toMatch(
      localizedProse("en-US", "commands.expressions.manage.error_limit", { limit: MAX_CUSTOM_EXPRESSIONS_PER_SERVER }),
    );
  });

  it("opens a prefilled editor without deferring and rejects a stale row before writing", async () => {
    const h = harness();
    const opened = await h.dispatch({ action: "edit" }, {}, "button");
    expect(opened.deferred).toBe(false);
    expect(h.show).toHaveBeenCalledTimes(1);
    expect(h.loadMedia).not.toHaveBeenCalled();
    await h.dispatch({ fp: "outdated" });
    expect(h.save).not.toHaveBeenCalled();
    expect(h.prepare).not.toHaveBeenCalled();
  });

  it("acknowledges a stalled modal read before the interaction expires", async () => {
    const h = harness({ load: () => new Promise(() => {}) });
    const start = Date.now();
    const interaction = await h.dispatch({ action: "edit" }, {}, "button");
    expect(Date.now() - start).toBeLessThan(2800);
    expect(interaction.calls[0]?.method).toBe("reply");
    expect(h.show).not.toHaveBeenCalled();
  });

  it("acknowledges before media work and retains media on an unchanged edit", async () => {
    let acknowledged = false;
    const h = harness({
      prepareMedia: async () => {
        acknowledged = true;
        return null;
      },
    });
    const submitted = await h.dispatch();
    expect(submitted.calls[0].method).toBe("deferUpdate");
    expect(acknowledged).toBe(true);
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[0]?.[3]?.media).toEqual(h.row);
    expect(h.cleanup).not.toHaveBeenCalled();
  });

  it("cleans new storage after a failed write and keeps old storage until commit", async () => {
    const id = createCustomExpression().custom_expression_id;
    const newReference = `custom-expressions/1/${id}/00000000-0000-4000-8000-000000000002.png`;
    const stored = createCustomExpression({
      source_kind: "upload",
      delivery_kind: "stored",
      original_link: null,
      storage_reference: newReference,
      ...PNG_MEDIA,
    });
    const save = mock(async () => {
      throw new ExpressionWriteError("stale");
    });
    const h = harness({ prepareMedia: async () => stored, saveCustom: save });
    h.data.customs[0].custom = createCustomExpression({
      delivery_kind: "stored",
      storage_reference: `custom-expressions/1/${id}/00000000-0000-4000-8000-000000000003.png`,
      ...PNG_MEDIA,
    });
    await h.dispatch();
    expect(h.cleanup.mock.calls.map((call) => call[0])).toEqual([newReference]);
    expect(h.row.storage_reference).toBeNull();
  });

  it("commits replacements before retiring old storage and rechecks permission after media work", async () => {
    const id = createCustomExpression().custom_expression_id;
    const oldReference = `custom-expressions/1/${id}/00000000-0000-4000-8000-000000000002.png`;
    const newReference = `custom-expressions/1/${id}/00000000-0000-4000-8000-000000000003.png`;
    const old = createCustomExpression({ delivery_kind: "stored", storage_reference: oldReference, ...PNG_MEDIA });
    const replacement = createCustomExpression({
      delivery_kind: "stored",
      storage_reference: newReference,
      ...PNG_MEDIA,
    });
    let committed = false;
    const retired: string[] = [];
    const h = harness({
      prepareMedia: async () => replacement,
      saveCustom: async () => {
        committed = true;
      },
      deleteMedia: async (reference) => {
        expect(committed).toBe(true);
        retired.push(reference);
      },
    });
    h.data.customs[0].custom = old;
    await h.dispatch();
    expect(retired).toEqual([oldReference]);
    const authorization = mock(async () => true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const revoked = harness({ authorize: authorization, prepareMedia: async () => replacement });
    await revoked.dispatch();
    expect(revoked.save).not.toHaveBeenCalled();
    expect(revoked.cleanup.mock.calls.map((call) => call[0])).toEqual([newReference]);
  });

  it("rejects validation and revoked permissions without writing", async () => {
    const invalid = harness({
      prepareMedia: async () => {
        throw new ExpressionMediaError("sources");
      },
    });
    await invalid.dispatch();
    expect(invalid.save).not.toHaveBeenCalled();
    const forbidden = harness({ authorize: async () => false });
    await forbidden.dispatch();
    expect(forbidden.save).not.toHaveBeenCalled();
    expect(forbidden.prepare).not.toHaveBeenCalled();
  });

  it("pages the persona picker and rejects a persona from outside the presented page", async () => {
    const h = harness({ takeSelect: () => "27" });
    await h.dispatch({ action: "add-persona", personaPage: 1 }, {}, "button");
    const payload = h.show.mock.calls[0]?.[1];
    expect(payload?.components[0].component?.options?.map((option) => option.value)).toEqual(["26", "27"]);
    await h.dispatch({ action: "allow", personaPage: 0 });
    expect(h.allow).not.toHaveBeenCalled();
    await h.dispatch({ action: "allow", personaPage: 1 });
    expect(h.allow).toHaveBeenCalledWith(1, h.row.custom_expression_id, 1, 27, true);
  });
});

function lastPanel(interaction: RouteInteraction): InteractionEditReplyOptions {
  return interaction.edits.at(-1) as InteractionEditReplyOptions;
}

function gallery(payload: InteractionEditReplyOptions) {
  return (payload.components?.[0] as ContainerComponentData).components.find(
    (component) => "type" in component && component.type === ComponentType.MediaGallery,
  );
}

function setCustom(h: ReturnType<typeof harness>, row: CustomExpressionRow): void {
  h.data.customs[0] = {
    ...h.data.customs[0],
    custom: row,
    revision: row.revision,
    fp: expressionPanelFingerprint(
      row.server_id,
      createRouteInteraction().user.id,
      row.custom_expression_id,
      row.revision,
    ),
  };
}

function stored(row: CustomExpressionRow): CustomExpressionRow {
  const extension = row.extension ?? "png";
  return createCustomExpression({
    ...row,
    source_kind: "upload",
    delivery_kind: "stored",
    original_link: null,
    storage_reference: `custom-expressions/${row.server_id}/${row.custom_expression_id}/00000000-0000-4000-8000-000000000002.${extension}`,
    mime_type: row.mime_type ?? "image/png",
    extension,
    byte_size: row.byte_size ?? 100,
  });
}

describe("custom expression panel previews", () => {
  it("offers a validated link button for every link without downloading it", async () => {
    for (const url of [
      "https://tenor.com/view/wave-gif-12345",
      "https://example.com/share/wave",
      "https://example.com/wave.gif",
    ]) {
      const h = harness();
      setCustom(h, createCustomExpression({ original_link: url }));
      const payload = lastPanel(await h.dispatch({ action: "view" }, {}, "button"));
      const container = payload.components?.[0] as ContainerComponentData;
      expect(container.components.at(-1)).toMatchObject({
        components: [{ style: 5, url, label: localizedCopy("en-US", "commands.expressions.manage.open_link") }],
      });
      expect(gallery(payload)).toBeUndefined();
      expect(h.validateUrl).toHaveBeenCalledWith(url);
      expect(h.loadMedia).not.toHaveBeenCalled();
      expect(h.prepare).not.toHaveBeenCalled();
    }
  });

  it("loads local, private GCS and private S3 media through the scoped storage helper", async () => {
    for (const [prefix, mime_type, extension] of [
      ["", "image/png", "png"],
      ["https://storage.googleapis.com/private-test-bucket/", "image/gif", "gif"],
      ["https://private-test-bucket.s3.us-east-1.amazonaws.com/", "video/mp4", "mp4"],
    ] as const) {
      const h = harness();
      const row = stored(createCustomExpression({ ...h.row, mime_type, extension }));
      row.storage_reference = `${prefix}${row.storage_reference}`;
      setCustom(h, row);
      const interaction = await h.dispatch({ action: "view" }, {}, "button");
      const payload = lastPanel(interaction);
      const file = payload.files?.[0] as AttachmentBuilder;
      expect(file.name?.endsWith(`.${extension}`)).toBe(true);
      expect(interaction.calls[0]?.method).toBe("deferUpdate");
      expect(h.loadMedia).toHaveBeenCalledWith(row.storage_reference, row.server_id, row.custom_expression_id);
      expect(gallery(payload)).toMatchObject({ items: [{ media: { url: `attachment://${file.name}` } }] });
      expect(file.attachment).toEqual(Buffer.alloc(row.byte_size ?? 0));
      expect(payload.attachments).toEqual([]);
      expect(h.validateUrl).not.toHaveBeenCalled();
    }
  });

  it("retains the same attachment across confirmation, whitelist and metadata revisions", async () => {
    const h = harness({ takeSelect: () => "27" });
    setCustom(h, stored(h.row));
    const first = lastPanel(await h.dispatch({ action: "view" }, {}, "button"));
    const name = (first.files?.[0] as AttachmentBuilder).name;
    if (!name) throw new Error("Preview file has no name");
    const options = { messageAttachments: [{ id: "123456789012345678", name, size: 100 }] };
    const confirmation = lastPanel(await h.dispatch({ action: "delete" }, {}, "button", [], options));
    expect(confirmation.files).toEqual([]);
    expect(confirmation.attachments).toEqual([{ id: options.messageAttachments[0].id }]);
    h.allow.mockImplementation(async () => {
      setCustom(
        h,
        createCustomExpression({ ...h.data.customs[0].custom, revision: 2, restricted: true, persona_ids: [27] }),
      );
    });
    const allowed = lastPanel(await h.dispatch({ action: "allow", personaPage: 1 }, {}, "modal", [], options));
    expect(h.allow).toHaveBeenCalledTimes(1);
    expect(allowed.files).toEqual([]);
    expect(allowed.attachments).toEqual(confirmation.attachments);
    h.save.mockImplementation(async () => {
      setCustom(
        h,
        createCustomExpression({ ...h.data.customs[0].custom, revision: 3, description: "Updated greeting" }),
      );
    });
    const edited = lastPanel(await h.dispatch({ fp: h.data.customs[0].fp }, {}, "modal", [], options));
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(edited.files).toEqual([]);
    expect(edited.attachments).toEqual(confirmation.attachments);
    expect(gallery(edited)).toEqual(gallery(first));
    expect(h.loadMedia).toHaveBeenCalledTimes(1);
  });

  it("replaces attachments when media or selection changes and clears them on category changes", async () => {
    const h = harness();
    setCustom(h, stored(h.row));
    const first = lastPanel(await h.dispatch({ action: "view" }, {}, "button"));
    const name = (first.files?.[0] as AttachmentBuilder).name;
    if (!name) throw new Error("Preview file has no name");
    const options = { messageAttachments: [{ id: "123456789012345678", name, size: 100 }] };
    setCustom(
      h,
      createCustomExpression({
        ...h.data.customs[0].custom,
        revision: 2,
        storage_reference: `custom-expressions/1/${h.row.custom_expression_id}/00000000-0000-4000-8000-000000000003.png`,
      }),
    );
    const replaced = lastPanel(await h.dispatch({ action: "view" }, {}, "button", [], options));
    expect(replaced.attachments).toEqual([]);
    expect((replaced.files?.[0] as AttachmentBuilder).name).not.toBe(name);
    const other = stored(createCustomExpression({ custom_expression_id: "00000000-0000-4000-8000-000000000004" }));
    h.data.customs.push({ ...h.data.customs[0], id: other.custom_expression_id, custom: other });
    const switched = lastPanel(
      await h.dispatch({ action: "select" }, {}, "string-select", [other.custom_expression_id], options),
    );
    expect(switched.attachments).toEqual([]);
    expect((switched.files?.[0] as AttachmentBuilder).name).not.toBe((replaced.files?.[0] as AttachmentBuilder).name);
    expect(h.loadMedia).toHaveBeenCalledTimes(3);
    setCustom(h, createCustomExpression({ ...h.row, revision: 3 }));
    const linked = lastPanel(await h.dispatch({ action: "view" }, {}, "button", [], options));
    expect(linked.attachments).toEqual([]);
    expect(linked.files).toEqual([]);
    expect(gallery(linked)).toBeUndefined();
    expect(h.loadMedia).toHaveBeenCalledTimes(3);
    const native = lastPanel(
      await h.dispatch({ action: "view", category: "emojis", entityId: "none" }, {}, "button", [], options),
    );
    expect(native.attachments).toEqual([]);
    expect(native.files).toEqual([]);
    expect(gallery(native)).toBeUndefined();
  });

  it("clears attachments when the selected custom is deleted or access is denied", async () => {
    const remove = mock(async () => true);
    const h = harness({ deleteCustom: remove });
    setCustom(h, stored(h.row));
    const first = lastPanel(await h.dispatch({ action: "view" }, {}, "button"));
    const name = (first.files?.[0] as AttachmentBuilder).name;
    if (!name) throw new Error("Preview file has no name");
    const options = { messageAttachments: [{ id: "123456789012345678", name, size: 100 }] };
    remove.mockImplementation(async () => {
      h.data.customs = [];
      return true;
    });
    const deleted = lastPanel(await h.dispatch({ action: "confirm" }, {}, "button", [], options));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(deleted.files).toEqual([]);
    expect(deleted.attachments).toEqual([]);
    expect(gallery(deleted)).toBeUndefined();
    const denied = harness({ authorize: async () => false });
    expect(lastPanel(await denied.dispatch({ action: "view" }, {}, "button", [], options)).attachments).toEqual([]);
  });

  it("keeps management controls when storage reads, size checks or URL validation fail", async () => {
    const unavailable = localizedProse("en-US", "commands.expressions.manage.preview_unavailable");
    const failing = harness({
      loadMedia: async () => {
        throw new Error("Storage unavailable");
      },
    });
    setCustom(failing, stored(failing.row));
    const mismatch = harness({ loadMedia: async () => Buffer.alloc(101) });
    setCustom(mismatch, stored(mismatch.row));
    const tooLarge = harness();
    setCustom(tooLarge, stored(tooLarge.row));
    const blocked = harness({ validateUrl: async () => ({ valid: false }) });
    const longLink = harness();
    setCustom(
      longLink,
      createCustomExpression({
        original_link: `https://tenor.com/view/${"wave".repeat(150)}-12345`,
        mime_type: null,
        extension: null,
        byte_size: null,
      }),
    );
    for (const h of [failing, mismatch, tooLarge, blocked, longLink]) {
      const payload = lastPanel(
        await h.dispatch({ action: "view" }, {}, "button", [], h === tooLarge ? { attachmentSizeLimit: 64 } : {}),
      );
      expect(collectTextDisplays(payload).join("\n")).toMatch(unavailable);
      expect(gallery(payload)).toBeUndefined();
      expect(payload.files).toEqual([]);
      expect(payload.attachments).toEqual([]);
      expect(
        (payload.components?.[0] as ContainerComponentData).components.some(
          (component) => "type" in component && component.type === ComponentType.ActionRow,
        ),
      ).toBe(true);
    }
    expect(tooLarge.loadMedia).not.toHaveBeenCalled();
    expect(blocked.loadMedia).not.toHaveBeenCalled();
  });

  it("retries a rejected preview upload without media while preserving the saved receipt", async () => {
    const h = harness();
    setCustom(h, stored(h.row));
    const interaction = await h.dispatch({}, {}, "modal", [], {
      onEditReply: async (value) => {
        const payload = value as InteractionEditReplyOptions;
        if (payload.files?.length) throw new Error("Upload rejected");
        return payload;
      },
    });
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(interaction.edits).toHaveLength(2);
    const payload = lastPanel(interaction);
    expect(payload.files).toEqual([]);
    expect(payload.attachments).toEqual([]);
    expect(gallery(payload)).toBeUndefined();
    const text = collectTextDisplays(payload).join("\n");
    expect(text).toMatch(localizedProse("en-US", "commands.expressions.manage.preview_unavailable"));
    expect(text).toContain(localizedCopy("en-US", "commands.expressions.manage.saved_detail"));
  });
});
