import { beforeAll, describe, expect, it } from "bun:test";
import { ComponentType, type StringSelectMenuComponentData } from "discord.js";
import type { ServerMemoryRow } from "@/types/db/schema";
import type { PanelReadStatus, PanelReceipt } from "@/types/discord/panel";
import type { DocumentChunkRow, DocumentListRow } from "@/utils/discord/interactions/memoriesDocumentOperations";
import {
  buildMemoriesPanelPayload,
  MAX_DOCUMENT_PAGE_SIZE,
  MAX_SERVER_MEMORY_PAGE_SIZE,
  MAX_STM_MANAGEABLE_ENTRIES,
  MAX_STM_OPTIONS_PER_GROUP,
} from "@/utils/discord/ui/memoriesPanel";
import { getMemoryLimits } from "@/utils/misc/memoryLimits";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";
import { RUNTIME_LOCALES, localizedProse } from "../../helpers/localeCases";
import { collectTextDisplays, expectSafePanelPayload } from "../../helpers/panelLimits";

beforeAll(async () => initializeLocalizer());

const REALISTIC_RECEIPT: PanelReceipt = {
  tone: "success",
  heading: "Server Memory Action Completed Successfully",
  detail:
    "Memory operation completed. The memory content has been saved and vectorized for persona lineage 100 with active tags: schedule, rules, guidelines.",
  metadata: "trace: mem-op-987654 | actor: 123456789012345678 | elapsed: 48ms",
};

function makeMemory(id: number, overrides: Partial<ServerMemoryRow> = {}): ServerMemoryRow {
  return {
    server_memory_id: id,
    server_id: 1,
    persona_lineage_id: 100,
    user_id: 1,
    content: `Server memory sample content #${id} with realistic length and context.`,
    tags: ["important", "guidelines"],
    channel_disc_ids: [],
    channel_scope_pending: false,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function makeDocument(id: number, overrides: Partial<DocumentListRow> = {}): DocumentListRow {
  return {
    document_id: id,
    document_name: `Document ${id}.pdf`,
    first_chunk: `First chunk preview of document #${id}`,
    channel_disc_ids: [],
    channel_scope_pending: false,
    isHistory: false,
    ...overrides,
  };
}

function makeChunk(documentId: number, chunkIndex: number): DocumentChunkRow {
  return {
    document_chunk_id: documentId * 100 + chunkIndex,
    chunk_index: chunkIndex,
    content: `Document #${documentId} chunk content at index ${chunkIndex}. Detailed textual data.`,
  };
}

describe("MemoriesPanel Limits & Boundary Sweeps", () => {
  it("conforms to Discord Components V2 protocol limits across the full state axis sweep", () => {
    const memorySizes = [
      0,
      1,
      MAX_SERVER_MEMORY_PAGE_SIZE - 1,
      MAX_SERVER_MEMORY_PAGE_SIZE,
      MAX_SERVER_MEMORY_PAGE_SIZE + 1,
      MAX_SERVER_MEMORY_PAGE_SIZE * 3,
    ];
    const personaSizes = [0, 1, 24, 25, 26, 75];
    const documentSizes = [
      0,
      1,
      MAX_DOCUMENT_PAGE_SIZE - 1,
      MAX_DOCUMENT_PAGE_SIZE,
      MAX_DOCUMENT_PAGE_SIZE + 1,
      MAX_DOCUMENT_PAGE_SIZE * 3,
    ];
    const stmSizes = [
      0,
      1,
      MAX_STM_OPTIONS_PER_GROUP - 1,
      MAX_STM_OPTIONS_PER_GROUP,
      MAX_STM_OPTIONS_PER_GROUP + 1,
      MAX_STM_MANAGEABLE_ENTRIES + 10,
    ];

    const readStatuses: PanelReadStatus[] = ["fresh", "stale", "unavailable"];
    const receipts: (PanelReceipt | undefined)[] = [undefined, REALISTIC_RECEIPT];

    for (const locale of RUNTIME_LOCALES) {
      for (const receipt of receipts) {
        for (const readStatus of readStatuses) {
          // Sweep Memories category across memory collection sizes and page kinds
          for (const size of memorySizes) {
            const memories = Array.from({ length: size }, (_, i) => makeMemory(i + 1));
            const personas = [createPersona({ persona_nickname: "Main Persona" })];

            expectSafePanelPayload(
              buildMemoriesPanelPayload({
                locale,
                category: "memories",
                selectedLineageId: 100,
                personas,
                memories,
                canManage: true,
                readStatus,
                page: { kind: "main" },
                receipt,
              }),
              `memories main/${locale}/${readStatus}/size-${size}`,
            );

            const firstMemory = memories[0];
            if (firstMemory?.server_memory_id !== undefined) {
              expectSafePanelPayload(
                buildMemoriesPanelPayload({
                  locale,
                  category: "memories",
                  selectedLineageId: 100,
                  personas,
                  memories,
                  canManage: true,
                  readStatus,
                  page: { kind: "remove", memoryId: firstMemory.server_memory_id },
                  receipt,
                }),
                `memories remove/${locale}/${readStatus}/size-${size}`,
              );

              expectSafePanelPayload(
                buildMemoriesPanelPayload({
                  locale,
                  category: "memories",
                  selectedLineageId: 100,
                  personas,
                  memories,
                  canManage: true,
                  readStatus,
                  page: { kind: "vectorize", memoryId: firstMemory.server_memory_id, personaId: 1 },
                  receipt,
                }),
                `memories vectorize/${locale}/${readStatus}/size-${size}`,
              );
            }
          }

          // Sweep personas collection sizes
          for (const pSize of personaSizes) {
            const personas = Array.from({ length: pSize }, (_, i) =>
              createPersona({ persona_id: i + 1, persona_lineage_id: 100 + i, persona_nickname: `Persona ${i + 1}` }),
            );
            expectSafePanelPayload(
              buildMemoriesPanelPayload({
                locale,
                category: "memories",
                selectedLineageId: personas[0]?.persona_lineage_id ?? 100,
                personas,
                memories: [makeMemory(1, { persona_lineage_id: personas[0]?.persona_lineage_id ?? 100 })],
                canManage: true,
                readStatus,
                page: { kind: "main" },
                receipt,
              }),
              `memories persona sizes/${locale}/pSize-${pSize}`,
            );
          }

          // Sweep Documents category
          for (const docSize of documentSizes) {
            const docs = Array.from({ length: docSize }, (_, i) => makeDocument(i + 1));
            const personas = [createPersona({ persona_nickname: "Main Persona" })];
            const firstDoc = docs[0];
            const chunks = firstDoc ? [makeChunk(firstDoc.document_id, 0), makeChunk(firstDoc.document_id, 1)] : [];

            expectSafePanelPayload(
              buildMemoriesPanelPayload({
                locale,
                category: "documents",
                selectedLineageId: 100,
                selectedDocumentPersonaId: 1,
                personas,
                memories: [],
                documents: docs,
                documentCount: docSize,
                documentChunks: chunks,
                canManage: true,
                readStatus,
                page: { kind: "documents", selectedDocumentId: firstDoc?.document_id },
                receipt,
              }),
              `documents main/${locale}/docSize-${docSize}`,
            );

            if (firstDoc) {
              expectSafePanelPayload(
                buildMemoriesPanelPayload({
                  locale,
                  category: "documents",
                  selectedLineageId: 100,
                  selectedDocumentPersonaId: 1,
                  personas,
                  memories: [],
                  documents: docs,
                  documentCount: docSize,
                  canManage: true,
                  readStatus,
                  page: { kind: "document-remove", documentId: firstDoc.document_id, historyOnly: false },
                  receipt,
                }),
                `document remove/${locale}/docSize-${docSize}`,
              );

              expectSafePanelPayload(
                buildMemoriesPanelPayload({
                  locale,
                  category: "documents",
                  selectedLineageId: 100,
                  selectedDocumentPersonaId: 1,
                  personas,
                  memories: [],
                  documents: docs,
                  documentChunks: chunks,
                  canManage: true,
                  readStatus,
                  page: {
                    kind: "document-chunk-remove",
                    documentId: firstDoc.document_id,
                    chunkIdx: 0,
                  },
                  receipt,
                }),
                `document chunk remove/${locale}/docSize-${docSize}`,
              );
            }
          }

          // Sweep STM category
          for (const stmSize of stmSizes) {
            const stmEntries = Array.from({ length: stmSize }, (_, i) => ({
              personaName: `Persona ${i + 1}`,
              channelId: `12345678901234567${i}`,
              lastUpdated: Date.now(),
            }));
            expectSafePanelPayload(
              buildMemoriesPanelPayload({
                locale,
                category: "stm",
                selectedLineageId: 100,
                personas: [createPersona({ persona_nickname: "Main Persona" })],
                memories: [],
                stmCount: stmSize,
                stmEntries,
                canManage: true,
                readStatus,
                page: { kind: "main" },
                receipt,
              }),
              `STM/${locale}/stmSize-${stmSize}`,
            );
          }
        }
      }
    }
  });

  it("covers every record in the union of paginated pages without dropping overflow", () => {
    const totalMemories = MAX_SERVER_MEMORY_PAGE_SIZE + 1;
    const memories = Array.from({ length: totalMemories }, (_, i) => makeMemory(i + 1, { persona_lineage_id: 100 }));
    const personas = [createPersona({ persona_nickname: "Main Persona" })];

    function extractMemoryIds(payload: ReturnType<typeof buildMemoriesPanelPayload>): number[] {
      const ids: number[] = [];
      for (const topComp of payload.components) {
        if ("components" in topComp && Array.isArray(topComp.components)) {
          for (const inner of topComp.components) {
            if ("components" in inner && Array.isArray(inner.components)) {
              for (const elem of inner.components) {
                if (elem.type === ComponentType.StringSelect) {
                  const select = elem as StringSelectMenuComponentData;
                  if (select.customId?.includes(":select:")) {
                    for (const opt of select.options) {
                      if (!opt.value.startsWith("action:")) {
                        ids.push(Number(opt.value));
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      return ids;
    }

    const rangePayload = (rangeIndex: number) =>
      buildMemoriesPanelPayload({
        locale: "en-US",
        category: "memories",
        selectedLineageId: 100,
        personas,
        memories,
        canManage: true,
        readStatus: "fresh",
        page: { kind: "main", rangeIndex },
      });

    const idsPage0 = extractMemoryIds(rangePayload(0));
    const idsPage1 = extractMemoryIds(rangePayload(1));

    expect(idsPage0.length).toBe(MAX_SERVER_MEMORY_PAGE_SIZE);
    expect(idsPage1.length).toBe(1);

    const unionIds = [...idsPage0, ...idsPage1];
    expect(unionIds.length).toBe(totalMemories);

    const expectedIds = Array.from({ length: totalMemories }, (_, i) => i + 1);
    expect(unionIds.sort((a, b) => a - b)).toEqual(expectedIds);
  });

  it("handles oversized content, backtick runs, and astral emoji across pages", () => {
    const personas = [createPersona({ persona_nickname: "Main Persona" })];
    const limits = getMemoryLimits();

    const memoryPayload = (content: string, page: Parameters<typeof buildMemoriesPanelPayload>[0]["page"]) =>
      buildMemoriesPanelPayload({
        locale: "en-US",
        category: "memories",
        selectedLineageId: 100,
        personas,
        memories: [makeMemory(1, { content })],
        canManage: true,
        readStatus: "fresh",
        page,
      });

    for (const runLen of [3, 4, 5, 6, 8]) {
      const content = `Prefix \`${"`".repeat(runLen - 1)} middle \`${"`".repeat(runLen - 1)} suffix`;

      expectSafePanelPayload(memoryPayload(content, { kind: "main" }), `server memories backtick run ${runLen}`);
    }

    const lengthsToTest = [limits.maxMemoryLength, 4000, 20000, 100000];
    for (const len of lengthsToTest) {
      const content = "M".repeat(len);

      expectSafePanelPayload(memoryPayload(content, { kind: "main" }), `server memories main (len ${len})`);

      expectSafePanelPayload(
        memoryPayload(content, { kind: "remove", memoryId: 1 }),
        `server memories remove (len ${len})`,
      );

      expectSafePanelPayload(
        memoryPayload(content, { kind: "vectorize", memoryId: 1, personaId: 1 }),
        `server memories vectorize (len ${len})`,
      );

      expectSafePanelPayload(
        buildMemoriesPanelPayload({
          locale: "en-US",
          category: "documents",
          selectedLineageId: 100,
          selectedDocumentPersonaId: 1,
          personas,
          memories: [],
          documents: [makeDocument(1)],
          documentCount: 1,
          documentChunks: [
            {
              document_chunk_id: 1,
              chunk_index: 0,
              content,
            },
          ],
          canManage: true,
          readStatus: "fresh",
          page: { kind: "documents", selectedDocumentId: 1 },
        }),
        `server document chunk (len ${len})`,
      );
    }

    for (const len of [4000, 20000, 100000]) {
      // 🌟 is \uD83C\uDF1F (2 UTF-16 units, 1 codepoint)
      const content = "🌟".repeat(len);

      expectSafePanelPayload(memoryPayload(content, { kind: "main" }), `server memories astral emoji (len ${len})`);
    }
  });
});

describe("Legacy channel scope notice", () => {
  const personas = [createPersona({ persona_nickname: "Main Persona" })];

  function memoryPanel(memories: ServerMemoryRow[], selectedMemoryId?: number) {
    return buildMemoriesPanelPayload({
      locale: "en-US",
      category: "memories",
      selectedLineageId: 100,
      personas,
      memories,
      canManage: true,
      readStatus: "fresh",
      page: selectedMemoryId === undefined ? { kind: "main" } : { kind: "main", selectedMemoryId },
    });
  }

  function documentPanel(documents: DocumentListRow[]) {
    return buildMemoriesPanelPayload({
      locale: "en-US",
      category: "documents",
      selectedLineageId: 100,
      personas,
      memories: [],
      documents,
      documentChunks: [],
      canManage: true,
      readStatus: "fresh",
      page: { kind: "documents" },
    });
  }

  it("marks a pending memory in the header and in its detail", () => {
    const payload = memoryPanel([makeMemory(1), makeMemory(2, { channel_scope_pending: true })], 2);
    expectSafePanelPayload(payload, "pending memory detail");
    const contents = collectTextDisplays(payload).join("\n");
    expect(contents).toMatch(localizedProse("en-US", "commands.memories.channel_scope_legacy_notice"));
    expect(contents).toMatch(localizedProse("en-US", "commands.memories.channel_scope_unresolved_line"));
  });

  it("marks a pending document in the header", () => {
    const payload = documentPanel([makeDocument(1, { channel_scope_pending: true })]);
    expectSafePanelPayload(payload, "pending document detail");
    const contents = collectTextDisplays(payload).join("\n");
    expect(contents).toMatch(localizedProse("en-US", "commands.memories.channel_scope_legacy_notice"));
  });

  it("omits the header notice when nothing is pending", () => {
    const contents = collectTextDisplays(memoryPanel([makeMemory(1), makeMemory(2)])).join("\n");
    expect(contents).not.toMatch(localizedProse("en-US", "commands.memories.channel_scope_legacy_notice"));
    expect(contents).not.toMatch(localizedProse("en-US", "commands.memories.channel_scope_unresolved_line"));
  });
});
