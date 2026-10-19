import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { LlmRow } from "@/types/db/schema";
import { resolvePlannerModel } from "@/modules/natural-nudges/runtime/model";
import { llmModelRepo } from "@/utils/db/repositories";
import * as serverStructuredOutput from "@/utils/provider/serverStructuredOutput";
import { createPersona } from "../../helpers/fixtures";

const CHAT_MODEL_ID = 11;
const PINNED_MODEL_ID = 22;
const NO_STRUCTURED_MODEL_ID = 33;

const spies: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

/** Every model but the one without structured output resolves on the server's key. */
function stubModels(): number[] {
  const resolvedIds: number[] = [];
  spies.push(
    spyOn(serverStructuredOutput, "resolveServerStructuredModel").mockImplementation(async (state, llmId) => {
      resolvedIds.push(llmId);
      return llmId === NO_STRUCTURED_MODEL_ID ? null : ({ state, apiKey: "key" } as never);
    }),
    spyOn(llmModelRepo, "loadById").mockImplementation(
      async (llmId: number) => ({ llm_id: llmId, supports_structoutput: llmId !== NO_STRUCTURED_MODEL_ID }) as LlmRow,
    ),
  );
  return resolvedIds;
}

function stateWithChatModel(llmId: number) {
  const state = createPersona({ server_id: 7 });
  return { ...state, llm: { ...state.llm, llm_id: llmId } };
}

describe("Natural Nudges planner model", () => {
  it("uses the pinned model over the chat model", async () => {
    const resolvedIds = stubModels();
    expect(await resolvePlannerModel(stateWithChatModel(CHAT_MODEL_ID), PINNED_MODEL_ID)).toEqual({
      kind: "ready",
      llmId: PINNED_MODEL_ID,
      source: "pinned",
    });
    expect(resolvedIds).toEqual([PINNED_MODEL_ID]);
  });

  it("falls back to the server's chat model when none is pinned", async () => {
    stubModels();
    expect(await resolvePlannerModel(stateWithChatModel(CHAT_MODEL_ID), null)).toEqual({
      kind: "ready",
      llmId: CHAT_MODEL_ID,
      source: "chat",
    });
  });

  it("leaves the server idle when the chat model cannot plan, and never falls back from a failed pin", async () => {
    stubModels();
    expect(await resolvePlannerModel(stateWithChatModel(NO_STRUCTURED_MODEL_ID), null)).toMatchObject({
      kind: "unusable",
      reason: "no_structured_output",
    });
    expect(await resolvePlannerModel(stateWithChatModel(CHAT_MODEL_ID), NO_STRUCTURED_MODEL_ID)).toMatchObject({
      kind: "unusable",
      source: "pinned",
    });
    expect(await resolvePlannerModel(stateWithChatModel(0), null)).toEqual({ kind: "none" });
  });
});
