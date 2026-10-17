import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import { z } from "zod";
import { callOpenrouterStructuredJSON } from "@/providers/openrouter/openrouterStructuredOutput";
import { callDeepseekStructuredJSON } from "@/providers/deepseek/deepseekStructuredOutput";
import { callZaiStructuredJSON } from "@/providers/zai/zaiStructuredOutput";
import { callNvidiaStructuredJSON } from "@/providers/nvidia/nvidiaStructuredOutput";
import { callAnthropicStructuredJSON } from "@/providers/anthropic/anthropicStructuredOutput";
import { draftReviewResultSchema } from "@/utils/chat/responseReview";
import { log } from "@/utils/misc/logger";
import type { ProviderStructuredJsonRequest } from "@/types/provider/featureInterfaces";
import { STUB_PUBLIC_HOST, stubGlobalFetch } from "../../helpers/fetchStub";
import { ApiError, GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { callGoogleStructuredJSON } from "@/providers/google/googleStructuredOutput";
import { callCustomStructuredJSON } from "@/providers/custom/customStructuredOutput";
import { NVIDIA_STRUCTURED_OUTPUT_MODELS } from "@/providers/nvidia/nvidiaConstants";

const request: ProviderStructuredJsonRequest = {
  model: "fixture",
  apiKey: "PRIVATE_KEY",
  systemPrompt: "PRIVATE_PROTOCOL",
  userPrompt: "PRIVATE_EVIDENCE",
  maxOutputTokens: 1024,
  privateOutput: true,
};

describe("private structured review transports", () => {
  const errors = spyOn(log, "error").mockImplementation(async () => {});
  const info = spyOn(log, "info").mockImplementation(() => {});
  afterEach(() => {
    errors.mockClear();
    info.mockClear();
  });
  afterAll(() => {
    errors.mockRestore();
    info.mockRestore();
  });

  it("validates output and reports usage for refusals and malformed reviews, showing only a malformed body at info", async () => {
    let respond: Parameters<typeof stubGlobalFetch>[0] = () => Response.json({});
    const fetchSpy = stubGlobalFetch((url, init) => respond(url, init));
    try {
      for (const [content, refusal, expected] of [
        [JSON.stringify({ status: "pass" }), null, true],
        ["PRIVATE_RESPONSE", null, false],
        [null, "PRIVATE_REFUSAL", false],
      ] as const) {
        const usage: unknown[] = [];
        const controller = new AbortController();
        respond = async (_url, init) => {
          expect(init?.signal).toBe(controller.signal);
          return Response.json({
            choices: [{ message: { content, refusal } }],
            usage: { prompt_tokens: 12, completion_tokens: 3 },
          });
        };
        const result = await callOpenrouterStructuredJSON(
          { ...request, abortSignal: controller.signal, onUsage: (value) => usage.push(value) },
          {},
          draftReviewResultSchema,
          "response_review",
        );
        expect(result.success).toBe(expected);
        expect(usage).toEqual([{ inputTokens: 12, outputTokens: 3 }]);
        if (refusal) expect(result).toMatchObject({ failure: "refusal" });
        expect(errors).not.toHaveBeenCalled();
        expect(JSON.stringify(info.mock.calls).includes("PRIVATE_RESPONSE")).toBe(content === "PRIVATE_RESPONSE");
        expect(JSON.stringify(info.mock.calls)).not.toContain("PRIVATE_REFUSAL");
        info.mockClear();
        expect(JSON.stringify(result)).not.toContain("PRIVATE_");
      }
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("classifies malformed private replies so the caller can retry with the exact problem", async () => {
    let content = "";
    const fetchSpy = stubGlobalFetch(async () =>
      Response.json({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1024 } }),
    );
    try {
      const call = () => callOpenrouterStructuredJSON(request, {}, draftReviewResultSchema, "response_review");
      content = "";
      expect(await call()).toMatchObject({ success: false, failure: "malformed", malformed: { reason: "empty" } });
      content = "PRIVATE_PROSE without any object";
      expect(await call()).toMatchObject({ malformed: { reason: "unparsable" } });
      content = '```json\n{"status":"pass"}\n```';
      expect(await call()).toEqual({ success: true, data: { status: "pass" } });
      content = JSON.stringify({ status: "revise", findings: [{ category: "style", problem: "p", direction: "d" }] });
      const schemaFailure = await call();
      expect(schemaFailure).toMatchObject({ malformed: { reason: "schema" } });
      expect(JSON.stringify(schemaFailure)).toContain("findings.0.category");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("gives prompt-schema providers a concrete example for the review union", async () => {
    let systemPrompt = "";
    const fetchSpy = stubGlobalFetch(async (_url, init) => {
      systemPrompt = JSON.parse(String(init?.body)).messages[0].content;
      return Response.json({ choices: [{ message: { content: JSON.stringify({ status: "pass" }) } }] });
    });
    try {
      await callDeepseekStructuredJSON(
        request,
        z.toJSONSchema(draftReviewResultSchema, { target: "openapi-3.0" }),
        draftReviewResultSchema,
      );
      const example = systemPrompt.split("Example json object:")[1]?.split("Do not wrap")[0] ?? "";
      expect(JSON.parse(example)).toEqual({ status: "pass" });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("applies a requested thinking level only when the caller passes one", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchSpy = stubGlobalFetch(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ choices: [{ message: { content: JSON.stringify({ status: "pass" }) } }] });
    });
    try {
      // A catalog codename that the API aliases to the Flash thinking toggle.
      const flash = { ...request, model: "deepseek-v4-flash-vision" };
      const schema = z.toJSONSchema(draftReviewResultSchema, { target: "openapi-3.0" });
      await callDeepseekStructuredJSON({ ...flash, thinkingLevel: "high" }, schema, draftReviewResultSchema);
      await callDeepseekStructuredJSON(flash, schema, draftReviewResultSchema);
      expect(bodies[0]?.thinking).toEqual({ type: "enabled" });
      expect(bodies[0]).not.toHaveProperty("temperature");
      expect(bodies[1]).not.toHaveProperty("thinking");
      expect(bodies[1]).toHaveProperty("temperature");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("propagates cancellation and disables structured mode retries for private requests", async () => {
    let respond: Parameters<typeof stubGlobalFetch>[0] = () => Response.json({});
    const fetchSpy = stubGlobalFetch((url, init) => respond(url, init));
    try {
      let calls = 0;
      respond = async () => {
        calls++;
        return new Response("PRIVATE_RESPONSE json_schema unsupported", { status: 400 });
      };
      const nvidiaModel = [...NVIDIA_STRUCTURED_OUTPUT_MODELS][0];
      const result = await callNvidiaStructuredJSON({ ...request, model: nvidiaModel }, {}, draftReviewResultSchema);
      expect(result).toMatchObject({ success: false, failure: "transport", httpStatus: 400 });
      expect(calls).toBe(1);
      const anthropic = await callAnthropicStructuredJSON(request, {}, draftReviewResultSchema);
      expect(anthropic).toMatchObject({ success: false, failure: "transport", httpStatus: 400 });
      expect(JSON.stringify(anthropic)).not.toContain("PRIVATE_");
      const controller = new AbortController();
      controller.abort();
      respond = async (_url, init) => {
        expect(init?.signal?.aborted).toBe(true);
        throw new Error("PRIVATE_KEY PRIVATE_EVIDENCE");
      };
      const cancelled = await callOpenrouterStructuredJSON(
        { ...request, abortSignal: controller.signal },
        {},
        draftReviewResultSchema,
        "response_review",
      );
      expect(cancelled).toMatchObject({ success: false, failure: "cancelled" });
      expect(errors).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("bounds decoded output and HTTP bodies", async () => {
    let respond: Parameters<typeof stubGlobalFetch>[0] = () => Response.json({});
    const fetchSpy = stubGlobalFetch((url, init) => respond(url, init));
    try {
      respond = () => Response.json({ choices: [{ message: { content: "x".repeat(17000) } }] });
      expect(await callOpenrouterStructuredJSON(request, {}, draftReviewResultSchema, "response_review")).toMatchObject(
        { success: false, failure: "malformed" },
      );
      respond = () => new Response("x".repeat(1024 * 1024 + 1));
      const oversized = await callOpenrouterStructuredJSON(request, {}, draftReviewResultSchema, "response_review");
      expect(oversized.success).toBe(false);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("keeps provider-specific structured APIs on the same private result and usage contract", async () => {
    let respond: Parameters<typeof stubGlobalFetch>[0] = () => Response.json({});
    const fetchSpy = stubGlobalFetch((url, init) => respond(url, init));
    try {
      const usage: unknown[] = [];
      respond = () =>
        Response.json({
          choices: [{ message: { content: JSON.stringify({ status: "pass" }) } }],
          usage: { prompt_tokens: 9, completion_tokens: 1 },
        });
      for (const call of [callDeepseekStructuredJSON, callZaiStructuredJSON, callNvidiaStructuredJSON]) {
        const result = await call(
          { ...request, model: [...NVIDIA_STRUCTURED_OUTPUT_MODELS][0], onUsage: (value) => usage.push(value) },
          {},
          draftReviewResultSchema,
        );
        expect(result).toMatchObject({ success: true, data: { status: "pass" } });
      }
      respond = () =>
        Response.json({
          content: [
            { type: "thinking", thinking: "" },
            { type: "text", text: JSON.stringify({ status: "pass" }) },
          ],
          usage: { input_tokens: 5, output_tokens: 1 },
        });
      const result = await callAnthropicStructuredJSON(
        { ...request, onUsage: (value) => usage.push(value) },
        {},
        draftReviewResultSchema,
      );
      expect(result).toMatchObject({ success: true, data: { status: "pass" } });
      respond = () =>
        Response.json({
          choices: [{ message: { content: JSON.stringify({ status: "pass" }) } }],
          usage: { prompt_tokens: 4, completion_tokens: 1 },
        });
      const custom = await callCustomStructuredJSON(
        { ...request, endpointUrl: `https://${STUB_PUBLIC_HOST}/v1`, onUsage: (value) => usage.push(value) },
        {},
        draftReviewResultSchema,
      );
      expect(custom).toMatchObject({ success: true, data: { status: "pass" } });
      expect(usage).toHaveLength(5);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
  it("preserves Google native refusal and usage through the same private contract", async () => {
    const client = new GoogleGenAI({ apiKey: "fixture" });
    const response = new GenerateContentResponse();
    response.usageMetadata = { promptTokenCount: 7, candidatesTokenCount: 1 };
    response.candidates = [{ content: { parts: [{ text: JSON.stringify({ status: "pass" }) }] } }];
    const generate = spyOn(client.models, "generateContent").mockResolvedValue(response);
    const usage: unknown[] = [];
    const controller = new AbortController();
    try {
      const result = await callGoogleStructuredJSON(
        { ...request, abortSignal: controller.signal, onUsage: (value) => usage.push(value) },
        {},
        draftReviewResultSchema,
        client,
      );
      expect(result).toMatchObject({ success: true, data: { status: "pass" } });
      expect(generate.mock.calls[0]?.[0].config?.abortSignal).toBe(controller.signal);
      response.promptFeedback = {
        blockReason: "SAFETY" as NonNullable<GenerateContentResponse["promptFeedback"]>["blockReason"],
      };
      expect(
        await callGoogleStructuredJSON(
          { ...request, onUsage: (value) => usage.push(value) },
          {},
          draftReviewResultSchema,
          client,
        ),
      ).toMatchObject({ success: false, failure: "refusal" });
      expect(usage).toHaveLength(2);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      generate.mockRestore();
    }
  });

  it("sends Anthropic a native output format its schema grammar accepts instead of a forced tool", async () => {
    let body: Record<string, unknown> = {};
    const fetchSpy = stubGlobalFetch(async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ content: [{ type: "text", text: JSON.stringify({ status: "pass" }) }] });
    });
    try {
      const schema = z.toJSONSchema(z.object({ review: draftReviewResultSchema, maxLength: z.string().max(5) }), {
        target: "openapi-3.0",
      });
      await callAnthropicStructuredJSON(request, schema, z.unknown());
      expect(body).not.toHaveProperty("tool_choice");
      expect(body).not.toHaveProperty("tools");
      const sent = JSON.stringify((body.output_config as { format: unknown }).format);
      // The API answers each of these keywords with a 400, as it does an object left open.
      expect(sent).not.toMatch(/"(oneOf|maxItems|maxLength|minLength)":[\d[]/);
      expect(sent).toContain('"maxLength":{');
      expect(sent.match(/"type":"object"/g)?.length).toBe(sent.match(/"additionalProperties":false/g)?.length);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("makes OpenRouter reject endpoints that would drop the schema without excluding non-reasoning models", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchSpy = stubGlobalFetch(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ choices: [{ message: { content: JSON.stringify({ status: "pass" }) } }] });
    });
    try {
      await callOpenrouterStructuredJSON(
        { ...request, model: "uncataloged/model", thinkingLevel: "minimal" },
        {},
        draftReviewResultSchema,
        "response_review",
      );
      expect(bodies[0]?.provider).toEqual({ require_parameters: true });
      expect(bodies[0]).not.toHaveProperty("reasoning");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("sends Google the standard JSON Schema field and keeps a rejected request's HTTP status", async () => {
    const client = new GoogleGenAI({ apiKey: "fixture" });
    const generate = spyOn(client.models, "generateContent").mockRejectedValue(
      new ApiError({ message: "PRIVATE_EVIDENCE", status: 400 }),
    );
    // The review union's oneOf and additionalProperties are what Google's OpenAPI subset rejected.
    const schema = z.toJSONSchema(draftReviewResultSchema, { target: "openapi-3.0" });
    try {
      const result = await callGoogleStructuredJSON(request, schema, draftReviewResultSchema, client);
      expect(result).toMatchObject({ success: false, failure: "transport", httpStatus: 400 });
      expect(JSON.stringify(result)).not.toContain("PRIVATE_");
      const config = generate.mock.calls[0]?.[0].config;
      expect(config?.responseJsonSchema).toBe(schema);
      expect(config).not.toHaveProperty("responseSchema");
    } finally {
      generate.mockRestore();
    }
  });

  it("keeps recovered reviewer and rule failures visible under production filtering and TEST_PRODUCTION", async () => {
    // A child process must reload the logger's import-time environment policy.
    const script = `
      import {reviewResponseCandidate, createResponseReviewState} from "./src/utils/chat/responseReview";
      import {checkResponseRules} from "./src/utils/chat/responseRuleCheck";
      import {getGuildMcpManager} from "./src/utils/mcp/guildMcpManager";
      import {mcpRepository} from "./src/utils/db/repositories";
      import {createPersona, createLlmRow} from "./tests/helpers/fixtures";
      import {ContextItemTag} from "./src/types/misc/context";
      const persona = createPersona({llm:createLlmRow({supports_structoutput:true,context_window:64000}),config:{response_drafting_enabled:true,response_reviewer_prompt:"PRIVATE_RUBRIC"}});
      const context = {currentPersona:persona,tomoriState:persona,streamingContext:{},channel:{id:"fixture"},message:{id:"trigger"},textCredentialSource:"personal",contextItems:[
        {role:"system",metadataTag:ContextItemTag.SYSTEM_PERSONALITY,parts:[{type:"text",text:"PRIVATE_PERSONA"}]},
        {role:"user",messageId:"trigger",parts:[{type:"text",text:"PRIVATE_TRIGGER"}]}
      ]};
      context.responseReview = createResponseReviewState(context);
      context.responseReview.pending = [{text:"PRIVATE_DRAFT",deliver:async()=>{throw new Error("Unexpected delivery");}}];
      const result = await reviewResponseCandidate(context,{callStructuredJSON:async()=>{throw new Error("PRIVATE_BODY PRIVATE_KEY");}},{apiKey:"PRIVATE_KEY",model:persona.llm.llm_codename});
      if(result.status !== "unavailable") process.exit(1);
      await reviewResponseCandidate(context,{},{});
      mcpRepository.loadGuildMcpConfigsResult = async () => ({status:"fresh",configs:[{server_id:42,guild_mcp_id:7,is_enabled:true,server_type:"prose_linter",name:"fixture",url:"https://rules.example.test/mcp"}]});
      getGuildMcpManager().getRegisteredTool = async () => ({tool:async()=>{throw new Error("PRIVATE_RULE_BODY PRIVATE_KEY");}});
      const rule = await checkResponseRules(42,{scope:"workspace",registrationId:7,toolName:"check_slop"},"PRIVATE_DRAFT",{calls:0},new AbortController().signal);
      if(rule.status !== "failed") process.exit(1);
      await getGuildMcpManager().cleanup();
    `;
    for (const testProduction of ["false", "true"]) {
      const child = Bun.spawn([process.execPath, "--eval", script], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          RUN_ENV: "production",
          TEST_PRODUCTION: testProduction,
          ERROR_DB_LOGGING_ENABLED: "false",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(exit).toBe(0);
      expect(stdout.match(/Response review unavailable/g)).toHaveLength(1);
      expect(stdout.match(/Response rule check failed/g)).toHaveLength(1);
      expect(stdout.includes("Response review {")).toBe(testProduction === "true");
      expect(stdout.includes("Response rule check {")).toBe(testProduction === "true");
      // TEST_PRODUCTION shows info, where the reviewer prompt dump carries persona and draft text.
      for (const secret of ["PRIVATE_BODY", "PRIVATE_KEY", "PRIVATE_RULE_BODY"])
        expect(stdout + stderr).not.toContain(secret);
      if (testProduction === "false") {
        expect(stdout + stderr).not.toContain("PRIVATE_");
        const records = stdout
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        expect(records.every((record) => record.level >= 50)).toBe(true);
      }
    }
  });
});
