import { describe, expect, it } from "bun:test";
import { readBoundedMessageProxyResponse } from "@/utils/messageProxy/boundedResponse";

describe("message-proxy response limit", () => {
  it("rejects a response body beyond the lookup size limit", async () => {
    const response = new Response("x".repeat(129 * 1024));
    await expect(readBoundedMessageProxyResponse(response)).rejects.toThrow("size limit");
  });
});
