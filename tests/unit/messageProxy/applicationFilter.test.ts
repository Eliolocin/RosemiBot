import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { Message } from "discord.js";
import { createApplicationIdFilter } from "@/utils/messageProxy/applicationFilter";
import type { MessageProxyInstanceContext } from "@/utils/messageProxy/instances";

const official: MessageProxyInstanceContext = {
  serviceId: "service_a",
  instanceId: "service_a:official",
  origin: "https://a.example",
};
const custom: MessageProxyInstanceContext = {
  serviceId: "service_a",
  instanceId: "service_a:11111111-2222-4333-8444-555555555555",
  origin: "https://b.example",
};
const knownApp = "111111111111111111";
const otherApp = "222222222222222222";
const ONE_HOUR_MS = 60 * 60 * 1000;

function webhookMessage(applicationId: string | null): Message {
  return { applicationId } as Message;
}

afterEach(() => {
  mock.restore();
});

describe("application ID filter", () => {
  it("allows every webhook message until an application ID has been learned", () => {
    const filter = createApplicationIdFilter();

    expect(filter.canAttest(webhookMessage(otherApp), official)).toBe(true);
    expect(filter.canAttest(webhookMessage(null), official)).toBe(true);
  });

  it("rejects messages from any other application once one is learned", () => {
    const filter = createApplicationIdFilter();
    filter.record(webhookMessage(knownApp), official);

    expect(filter.canAttest(webhookMessage(knownApp), official)).toBe(true);
    expect(filter.canAttest(webhookMessage(otherApp), official)).toBe(false);
    expect(filter.canAttest(webhookMessage(null), official)).toBe(false);
  });

  it("keeps what each instance learned separate", () => {
    const filter = createApplicationIdFilter();
    filter.record(webhookMessage(knownApp), official);

    expect(filter.canAttest(webhookMessage(otherApp), custom)).toBe(true);
    filter.record(webhookMessage(otherApp), custom);
    expect(filter.canAttest(webhookMessage(otherApp), custom)).toBe(true);
    expect(filter.canAttest(webhookMessage(knownApp), custom)).toBe(false);
    expect(filter.canAttest(webhookMessage(knownApp), official)).toBe(true);
  });

  it("learns nothing from a message without an application ID", () => {
    const filter = createApplicationIdFilter();
    filter.record(webhookMessage(null), official);

    expect(filter.canAttest(webhookMessage(otherApp), official)).toBe(true);
  });

  it("stops filtering on a stale ID so a changed application can be relearned", () => {
    const now = spyOn(Date, "now").mockReturnValue(1_000_000);
    const filter = createApplicationIdFilter();
    filter.record(webhookMessage(knownApp), official);

    now.mockReturnValue(1_000_000 + ONE_HOUR_MS);
    expect(filter.canAttest(webhookMessage(otherApp), official)).toBe(false);

    now.mockReturnValue(1_000_000 + ONE_HOUR_MS + 1);
    expect(filter.canAttest(webhookMessage(otherApp), official)).toBe(true);
  });

  it("extends the window each time the service confirms another message", () => {
    const now = spyOn(Date, "now").mockReturnValue(1_000_000);
    const filter = createApplicationIdFilter();
    filter.record(webhookMessage(knownApp), official);

    now.mockReturnValue(1_000_000 + ONE_HOUR_MS - 1);
    filter.record(webhookMessage(knownApp), official);

    now.mockReturnValue(1_000_000 + ONE_HOUR_MS + 1);
    expect(filter.canAttest(webhookMessage(otherApp), official)).toBe(false);
  });
});
