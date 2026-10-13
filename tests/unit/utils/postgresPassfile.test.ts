import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { withPostgresPassfile } from "@/utils/backup/dataBackup";

const SYNTHETIC_PASSWORD = String.raw`p@ss:wo\rd%canary`;
const DATABASE_URL = `postgresql://tomori:${encodeURIComponent(SYNTHETIC_PASSWORD)}@db.example:6543/tomodb?sslmode=require&options=-c%20search_path%3Dpublic`;

describe("withPostgresPassfile", () => {
  it("moves the password into an escaped private passfile and keeps the rest of the URL", async () => {
    const seen = await withPostgresPassfile(DATABASE_URL, async ({ connectionUrl, env }) => {
      const passfile = env.PGPASSFILE ?? "";
      return {
        connectionUrl,
        passfile,
        contents: readFileSync(passfile, "utf8"),
        mode: statSync(passfile).mode & 0o777,
        env,
      };
    });

    expect(seen.connectionUrl).toBe(
      "postgresql://tomori@db.example:6543/tomodb?sslmode=require&options=-c%20search_path%3Dpublic",
    );
    expect(seen.contents).toBe("*:*:*:*:p@ss\\:wo\\\\rd%canary\n");
    if (process.platform !== "win32") expect(seen.mode).toBe(0o600);
    for (const name of ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PASSWORD", "PGPASSWORD"]) {
      expect(seen.env[name]).toBeUndefined();
    }
    expect(existsSync(seen.passfile)).toBe(false);
  });

  it("removes the passfile when the client fails", async () => {
    let passfile = "";
    const failure = await withPostgresPassfile(DATABASE_URL, async ({ env }) => {
      passfile = env.PGPASSFILE ?? "";
      throw new Error("pg_dump exited with code 1");
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(passfile).not.toBe("");
    expect(existsSync(passfile)).toBe(false);
  });

  it("writes no passfile for a password-free URL", async () => {
    const seen = await withPostgresPassfile("postgresql://tomori@db.example/tomodb", async (connection) => connection);

    expect(seen.connectionUrl).toBe("postgresql://tomori@db.example/tomodb");
    expect(seen.env.PGPASSFILE).toBe(process.env.PGPASSFILE);
  });
});
