import { afterEach, describe, expect, it } from "bun:test";
import {
  clearNegativeMessageProxyMessageIdentityCacheForTests,
  forgetNegativeMessageProxyMessageIdentity,
  hasNegativeMessageProxyMessageIdentity,
  rememberNegativeMessageProxyMessageIdentity,
} from "@/utils/messageProxy/messageIdentityNegativeCache";

afterEach(clearNegativeMessageProxyMessageIdentityCacheForTests);

describe("message-proxy message identity negative cache", () => {
  it("forgets a miss after successful persistence makes attribution available", () => {
    rememberNegativeMessageProxyMessageIdentity("message-1");
    expect(hasNegativeMessageProxyMessageIdentity("message-1")).toBe(true);

    forgetNegativeMessageProxyMessageIdentity("message-1");
    expect(hasNegativeMessageProxyMessageIdentity("message-1")).toBe(false);
  });

  it("evicts the oldest miss instead of growing without a bound", () => {
    for (let index = 0; index <= 2000; index += 1) {
      rememberNegativeMessageProxyMessageIdentity(`message-${index}`);
    }

    expect(hasNegativeMessageProxyMessageIdentity("message-0")).toBe(false);
    expect(hasNegativeMessageProxyMessageIdentity("message-1")).toBe(true);
    expect(hasNegativeMessageProxyMessageIdentity("message-2000")).toBe(true);
  });
});
