import { describe, expect, it, mock } from "bun:test";
import type { CustomEndpointRow } from "@/types/db/schema";
import * as realUserRemoteFetch from "@/utils/security/userRemoteFetch";
import { synthesizeSpeechViaTtsCloneBuffer } from "@/providers/custom/styles/ttsCloningAdapter";
import { createScopedModuleMocker } from "../../helpers/mockSurface";

let requestBody: Record<string, unknown> | null = null;
const fetchMock = mock(async (_input: unknown, init?: RequestInit) => {
  if (init?.signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
  requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
  return new Response(Buffer.from("audio"), { headers: { "content-type": "audio/wav" } });
});

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/security/userRemoteFetch": realUserRemoteFetch,
});

scopedMock.module("@/utils/security/userRemoteFetch", () => ({
  ...realUserRemoteFetch,
  fetchUserRemoteUrl: fetchMock,
}));

const COSYVOICE3_ENDPOINT = {
  label: "CosyVoice 3",
  api_style: "tts-clone",
  endpoint_url: "https://cosyvoice.example.test",
  extra_config: {
    script_markup: "plain",
    supports_instruct: true,
  },
} as unknown as CustomEndpointRow;

describe("CosyVoice 3 clone adapter contract", () => {
  it("maps generic voice instructions to the TTS server instruct field", async () => {
    requestBody = null;

    const result = await synthesizeSpeechViaTtsCloneBuffer({
      endpoint: COSYVOICE3_ENDPOINT,
      refAudio: Buffer.from("reference-audio"),
      refText: "Reference words",
      script: "[happy] Hello there",
      apiKey: "",
      voiceInstructions: "  speak softly  ",
    });

    expect(result.success).toBe(true);
    expect(requestBody).toMatchObject({
      text: "Hello there",
      ref_audio: Buffer.from("reference-audio").toString("base64"),
      ref_text: "Reference words",
      instruct: "speak softly",
    });
  });
});

const CHATTERBOX_SETTINGS = { turboEnabled: true, cfgWeight: 0.5, exaggeration: 0.5 };

function bracketTagEndpoint(label: string): CustomEndpointRow {
  return {
    label,
    api_style: "tts-clone",
    endpoint_url: "https://tts.example.test",
    extra_config: { script_markup: "bracket-tags" },
  } as unknown as CustomEndpointRow;
}

describe("bracket tag handling", () => {
  it("keeps free-form expression tags for a non-Chatterbox endpoint carrying Chatterbox settings", async () => {
    requestBody = null;

    await synthesizeSpeechViaTtsCloneBuffer({
      endpoint: bracketTagEndpoint("Fish S2 Pro"),
      refAudio: Buffer.from("reference-audio"),
      refText: "Reference words",
      script: "[whisper] Keep your voice down. [excited] Wait!",
      apiKey: "",
      chatterbox: CHATTERBOX_SETTINGS,
    });

    expect(requestBody).toMatchObject({ text: "[whisper] Keep your voice down. [excited] Wait!" });
  });

  it("limits a Chatterbox Turbo endpoint to its supported event tags", async () => {
    requestBody = null;

    await synthesizeSpeechViaTtsCloneBuffer({
      endpoint: bracketTagEndpoint("Chatterbox Turbo"),
      refAudio: Buffer.from("reference-audio"),
      refText: null,
      script: "[whisper] Keep your voice down. [laugh] Wait!",
      apiKey: "",
      chatterbox: CHATTERBOX_SETTINGS,
    });

    expect(requestBody).toMatchObject({ text: "Keep your voice down. [laugh] Wait!" });
  });

  it("strips every tag for standard Chatterbox", async () => {
    requestBody = null;

    await synthesizeSpeechViaTtsCloneBuffer({
      endpoint: bracketTagEndpoint("Chatterbox"),
      refAudio: Buffer.from("reference-audio"),
      refText: null,
      script: "[laugh] Keep your voice down.",
      apiKey: "",
      chatterbox: { ...CHATTERBOX_SETTINGS, turboEnabled: false },
    });

    expect(requestBody).toMatchObject({ text: "Keep your voice down." });
  });
});

describe("turn cancellation", () => {
  it("aborts the synthesis request on /kill and does not report it as a timeout", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await synthesizeSpeechViaTtsCloneBuffer({
      endpoint: COSYVOICE3_ENDPOINT,
      refAudio: Buffer.from("reference-audio"),
      refText: null,
      script: "Hello there",
      apiKey: "",
      abortSignal: controller.signal,
    });

    expect(result.success).toBe(false);
    expect(result.errorKind).toBe("request_failed");
  });
});

describe("failure details", () => {
  it("keeps an echoed credential in the endpoint's error body and headers out of details", async () => {
    const canary = "sk-live-CANARY0001";
    const request = {
      endpoint: COSYVOICE3_ENDPOINT,
      refAudio: Buffer.from("reference-audio"),
      refText: null,
      script: "Hello there",
      apiKey: canary,
    };

    fetchMock.mockImplementationOnce(async () =>
      Response.json({ detail: `rejected Authorization: Bearer ${canary} <@&42>` }, { status: 500 }),
    );
    const httpFailure = await synthesizeSpeechViaTtsCloneBuffer(request);

    fetchMock.mockImplementationOnce(
      async () => new Response("not audio", { headers: { "content-type": `text/html; echo=${canary}` } }),
    );
    const contentTypeFailure = await synthesizeSpeechViaTtsCloneBuffer(request);

    expect(httpFailure.details).toBe("HTTP 500");
    expect(contentTypeFailure.success).toBe(false);
    expect(contentTypeFailure.details).not.toContain(canary);
  });
});
