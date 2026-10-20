import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { Collection, type Attachment, type Message } from "discord.js";
import type { CustomEndpointRow } from "@/types/db/schema";
import { transcribeMessageAudioAttachment } from "@/utils/audio/audioAttachmentTranscription";
import { log } from "@/utils/misc/logger";
import * as speechEndpointResolver from "@/utils/provider/speechEndpointResolver";
import * as safeDownloadModule from "@/utils/security/safeDownload";
import { stubGlobalFetch } from "../../helpers/fetchStub";

const SERVER_ID = 7;
const API_KEY = "synthetic-elevenlabs-transcription-key";

function audioMessage(): Message {
  const attachment = {
    name: "voice.ogg",
    contentType: "audio/ogg",
    url: "https://cdn.discordapp.com/attachments/voice.ogg",
    size: 3,
  } as Attachment;
  return { id: "message_1", attachments: new Collection([["attachment_1", attachment]]) } as unknown as Message;
}

describe("ElevenLabs transcription failure reporting", () => {
  const spies: Array<{ mockRestore(): void }> = [];
  let errorSpy: ReturnType<typeof spyOn<typeof log, "error">>;
  let status = 200;

  beforeEach(() => {
    spies.push(
      spyOn(speechEndpointResolver, "resolveActiveTranscriptionEndpoint").mockResolvedValue({
        endpoint: { api_style: "elevenlabs-transcription", requires_auth: true } as CustomEndpointRow,
        apiKey: API_KEY,
      }),
      spyOn(safeDownloadModule, "safeDownload").mockResolvedValue({ success: true, buffer: Buffer.from("ogg") }),
      spyOn(log, "warn").mockImplementation(() => undefined),
      stubGlobalFetch(() =>
        Response.json({ detail: { status: "synthetic_outage", message: `rejected ${API_KEY}` } }, { status }),
      ),
    );
    errorSpy = spyOn(log, "error").mockResolvedValue(undefined);
    spies.push(errorSpy);
  });

  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  it("logs a provider outage with its body and keeps a rejected key out of error logs", async () => {
    for (const nextStatus of [500, 401]) {
      status = nextStatus;
      errorSpy.mockClear();
      const result = await transcribeMessageAudioAttachment(audioMessage(), SERVER_ID);
      expect(result.failureReason).toBe("stt_failed");
      expect(errorSpy).toHaveBeenCalledTimes(nextStatus === 500 ? 1 : 0);
      if (nextStatus !== 500) continue;
      const [message, , context] = errorSpy.mock.calls[0];
      expect(message).toContain("HTTP 500");
      expect(message).toContain("synthetic_outage");
      expect(message).not.toContain(API_KEY);
      expect(context?.serverId).toBe(SERVER_ID);
      expect(context?.metadata).toMatchObject({ operation: "transcription", providerStatus: 500 });
    }
  });
});
