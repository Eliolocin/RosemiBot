import { createMemberKeyMetadata as metadata } from "../../helpers/memberKeyMetadata";
import { describe, expect, it, spyOn } from "bun:test";
import { createMemberKeyProvider, MemberKeyError } from "@/modules/supporter-billing/openrouter/management";
import { useEnvSandbox } from "../../helpers/env";

const env = { TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY: "synthetic-management-secret" };

describe("member-key management transport", () => {
  useEnvSandbox(["OPENROUTER_DEBUG"]);

  it("uses zero-limit creation, cumulative caps, disabled-key pagination, and secret-free SDK debug output", async () => {
    process.env.OPENROUTER_DEBUG = "true";
    const output = spyOn(console, "log").mockImplementation(() => {});
    const requests: Request[] = [];
    const redirects: Array<RequestRedirect | undefined> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request.clone());
      redirects.push(request.redirect);
      if (request.method === "POST")
        return Response.json({ data: metadata(), key: "synthetic-member-secret" }, { status: 201 });
      if (request.method === "PATCH") {
        const body = (await request.json()) as { disabled: boolean; limit: number };
        return Response.json({ data: metadata(body) });
      }
      if (request.method === "DELETE") return Response.json({ deleted: true });
      const url = new URL(request.url);
      if (url.pathname.endsWith("/synthetic-hash")) return Response.json({ data: metadata() });
      if (url.searchParams.get("offset") === "0")
        return Response.json({
          data: Array.from({ length: 100 }, (_, i) => metadata({ hash: `other-${i}`, name: "other-operation" })),
        });
      return Response.json({ data: [metadata({ disabled: true })] });
    };
    try {
      const provider = createMemberKeyProvider(env, fetchImpl);
      expect(await provider.create("synthetic-operation")).toEqual({
        hash: "synthetic-hash",
        key: "synthetic-member-secret",
      });
      expect((await provider.findByName("synthetic-operation"))[0]?.disabled).toBe(true);
      expect((await provider.get("synthetic-hash"))?.usage).toBe(0);
      await provider.update("synthetic-hash", { disabled: false, limit: 12.5 });
      await provider.delete("synthetic-hash");
      expect(await requests[0].json()).toEqual({
        name: "synthetic-operation",
        limit: 0,
        limit_reset: null,
        include_byok_in_limit: true,
      });
      const patch = requests.find((request) => request.method === "PATCH");
      expect(await patch?.json()).toEqual({
        disabled: false,
        limit: 12.5,
        limit_reset: null,
        include_byok_in_limit: true,
      });
      expect(
        requests.every(
          (request) =>
            request.headers.get("Authorization") === `Bearer ${env.TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY}`,
        ),
      ).toBe(true);
      expect(
        requests
          .filter((request) => request.url.includes("offset="))
          .every((request) => new URL(request.url).searchParams.get("include_disabled") === "true"),
      ).toBe(true);
      expect(redirects.every((value) => value === "error")).toBe(true);
      expect(output.mock.calls.flat().join(" ")).not.toContain("synthetic-member-secret");
      expect(output.mock.calls.flat().join(" ")).not.toContain(env.TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY);
    } finally {
      output.mockRestore();
    }
  });

  it("treats only a provider 404 as missing and makes deletion idempotent", async () => {
    const provider = createMemberKeyProvider(env, async () =>
      Response.json({ error: { code: 404, message: "missing" } }, { status: 404 }),
    );
    expect(await provider.get("missing-hash")).toBeNull();
    await provider.delete("missing-hash");
  });

  it("finds an operation when unrelated keys have empty names", async () => {
    const provider = createMemberKeyProvider(env, async () =>
      Response.json({ data: [metadata({ hash: "unnamed-hash", name: "" }), metadata()] }),
    );
    expect((await provider.findByName("synthetic-operation")).map((key) => key.hash)).toEqual(["synthetic-hash"]);
  });

  it("normalizes outgoing limits and accepts only machine-level rounding differences in the response", async () => {
    for (const delta of [0, Number.EPSILON * 2, 0.000001, 1]) {
      let sent: number | undefined;
      const provider = createMemberKeyProvider(env, async (input, init) => {
        const body = (await new Request(input, init).json()) as { limit: number; disabled: boolean };
        sent = body.limit;
        return Response.json({ data: metadata({ ...body, limit: body.limit + delta }) });
      });
      const pending = provider.update("synthetic-hash", { disabled: false, limit: 0.28 + 3 });
      if (delta <= Number.EPSILON * 2) await pending;
      else await expect(pending).rejects.toBeInstanceOf(MemberKeyError);
      expect(sent).toBe(3.28);
    }
  });

  it("rejects malformed provider data and strips provider, transport, and validation diagnostics", async () => {
    for (const response of [
      () => Response.json({ data: { ...metadata(), usage: -1 }, key: "synthetic-member-secret" }, { status: 201 }),
      () =>
        Response.json(
          { error: { code: 503, message: "synthetic-management-secret synthetic-member-secret" } },
          { status: 503 },
        ),
      () => {
        throw new Error("synthetic-management-secret synthetic-member-secret");
      },
    ]) {
      const provider = createMemberKeyProvider(env, async () => response());
      for (const call of [() => provider.create("synthetic-operation"), () => provider.get("synthetic-hash")]) {
        try {
          await call();
          throw new Error("Unexpected success");
        } catch (error) {
          expect(error).toBeInstanceOf(MemberKeyError);
          expect(String(error)).not.toContain("synthetic-management-secret");
          expect(String(error)).not.toContain("synthetic-member-secret");
        }
      }
    }
  });
});
