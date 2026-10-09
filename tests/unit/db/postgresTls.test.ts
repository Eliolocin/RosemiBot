import { describe, expect, it } from "bun:test";
import { resolveProductionPostgresTls, skipsTlsForTestProduction } from "@/utils/db/client";

describe("production PostgreSQL TLS trust", () => {
  it("uses the operating-system trust store for Azure PostgreSQL", () => {
    const tls = resolveProductionPostgresTls("tomoribot-postgres.postgres.database.azure.com", "");

    expect(tls).toEqual({ rejectUnauthorized: true });
    expect(tls.ca).toBeUndefined();
  });

  it("fails closed when an explicitly configured CA bundle is missing", () => {
    expect(() =>
      resolveProductionPostgresTls("database.example.com", "C:/definitely-missing/tomoribot-postgres-ca.pem"),
    ).toThrow("Configured PostgreSQL CA bundle was not found");
  });

  it("lets TEST_PRODUCTION skip TLS only for a database on this machine", () => {
    for (const host of ["localhost", "127.0.0.1", "::1", "[::1]", " LOCALHOST "]) {
      expect(skipsTlsForTestProduction(host, "true")).toBe(true);
      expect(skipsTlsForTestProduction(host, undefined)).toBe(false);
    }
    for (const host of ["tomoribot-postgres.postgres.database.azure.com", "10.0.0.5", "127.0.0.1.example.com", "db"]) {
      expect(skipsTlsForTestProduction(host, "true")).toBe(false);
    }
  });
});
