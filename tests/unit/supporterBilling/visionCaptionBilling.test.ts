import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { supporterSpendGuard } from "@/modules/supporter-billing/runtime/spendGuard";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import * as realRemoteFetch from "@/utils/security/userRemoteFetch";
import { createScopedModuleMocker } from "../../helpers/mockSurface";

const requests: RequestInit[] = [];
const remoteFetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
  requests.push(init ?? {});
  return Response.json({ choices: [{ message: { content: "caption" } }] });
});
const scopedMock = createScopedModuleMocker(mock, { "@/utils/security/userRemoteFetch": realRemoteFetch });
scopedMock.module("@/utils/security/userRemoteFetch", () => ({ ...realRemoteFetch, fetchUserRemoteUrl: remoteFetch }));

const { callOpenAiCompatibleVision } = await import("@/utils/provider/visionCaption");

afterEach(() => {
  requests.length = 0;
  remoteFetch.mockClear();
});

describe("managed vision admission", () => {
  test("rejects a managed vision request before the SSRF transport sends it", async () => {
    const denied = new SupporterRequestDeniedError("allowance_exhausted");
    const admission = spyOn(supporterSpendGuard, "begin").mockRejectedValue(denied);
    try {
      await expect(
        callOpenAiCompatibleVision(
          "synthetic-member",
          "vision-model",
          "https://openrouter.ai/api/v1/chat/completions",
          { data: "aW1hZ2U=", mimeType: "image/png" },
          "Describe",
          AbortSignal.timeout(5000),
        ),
      ).rejects.toBe(denied);
      expect(admission.mock.calls[0]?.[0]).toBe("synthetic-member");
      expect(remoteFetch).not.toHaveBeenCalled();
    } finally {
      admission.mockRestore();
    }
  });
});
