import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  deleteCharRef,
  loadCharRefAsBase64,
  resolveCharRefDisplayAsset,
  type CharRefStorageConfig,
} from "@/utils/storage/charrefStorage";

const storageConfig: CharRefStorageConfig = {
  bucket: "tomori-media",
  region: "ap-southeast-1",
  prefix: "charreferences",
  publicBaseUrl: "https://cdn.example.invalid/media",
};

describe("character-reference display resolver", () => {
  it.each([
    [
      "configured CDN",
      "https://cdn.example.invalid/media/charreferences/personas/55/asset.png?version=1",
      storageConfig,
    ],
    [
      "configured S3 origin",
      "https://tomori-media.s3.ap-southeast-1.amazonaws.com/charreferences/personas/55/asset.png",
      { ...storageConfig, publicBaseUrl: "https://tomori-media.s3.ap-southeast-1.amazonaws.com" },
    ],
  ])("passes through a trusted %s URL for its persona", async (_label, reference, config) => {
    const result = await resolveCharRefDisplayAsset(reference, 55, { storageConfig: config });

    expect(result).toEqual({ type: "url", url: reference });
  });

  it("loads a valid same-persona local reference as bytes", async () => {
    let loadedPath: string | undefined;
    const result = await resolveCharRefDisplayAsset("data\\charreferences\\personas\\55\\asset.png", 55, {
      loadLocalBuffer: async (absolutePath) => {
        loadedPath = absolutePath;
        return Buffer.from("png");
      },
    });

    expect(result).toEqual({ type: "buffer", buffer: Buffer.from("png") });
    expect(loadedPath).toContain("data");
    expect(loadedPath).toContain("charreferences");
    expect(loadedPath).toContain("personas");
    expect(loadedPath).toContain("55");
  });

  it.each([
    "https://cdn.example.invalid/media/charreferences/personas/56/asset.png",
    "https://cdn.example.invalid/media/charreferences/personas/55/",
    "https://cdn.example.invalid/media/charreferences/users/55/asset.png",
    "https://cdn.example.invalid/media/other/personas/55/asset.png",
    "https://other.example.invalid/media/charreferences/personas/55/asset.png",
    "https://tomori-media.s3.ap-southeast-1.amazonaws.com/charreferences/personas/55/asset.png",
    "https://cdn.example.invalid/media/charreferences/personas/55/%2e%2e/users/asset.png",
    "not-a-url",
    "data/charreferences/personas/56/asset.png",
    "data/charreferences/users/55/asset.png",
    "data/charreferences/personas/55/../../users/55/asset.png",
  ])("rejects an untrusted or wrong-owner reference without loading it: %s", async (reference) => {
    let loadAttempted = false;
    const result = await resolveCharRefDisplayAsset(reference, 55, {
      storageConfig,
      loadLocalBuffer: async () => {
        loadAttempted = true;
        return Buffer.from("should not load");
      },
    });

    expect(result).toBeNull();
    expect(loadAttempted).toBe(false);
  });

  it("returns no local asset when the stored file cannot be read", async () => {
    const result = await resolveCharRefDisplayAsset("data/charreferences/personas/55/missing.png", 55, {
      loadLocalBuffer: async () => null,
    });

    expect(result).toBeNull();
  });
});

describe("character-reference generation loader", () => {
  const ownerDir = join(process.cwd(), "data", "charreferences", "users", "900000000000000001");
  const otherDir = join(process.cwd(), "data", "charreferences", "users", "900000000000000002");

  afterAll(() => {
    rmSync(ownerDir, { recursive: true, force: true });
    rmSync(otherDir, { recursive: true, force: true });
  });

  it("reads only a local reference inside the requesting owner's directory", async () => {
    mkdirSync(ownerDir, { recursive: true });
    mkdirSync(otherDir, { recursive: true });
    writeFileSync(join(ownerDir, "own.png"), "own");
    writeFileSync(join(otherDir, "foreign.png"), "foreign");

    const own = await loadCharRefAsBase64(
      "data/charreferences/users/900000000000000001/own.png",
      "users",
      "900000000000000001",
    );
    expect(Buffer.from(own ?? "", "base64").toString()).toBe("own");
    for (const reference of [
      "data/charreferences/users/900000000000000002/foreign.png",
      "data/charreferences/users/900000000000000001/../900000000000000002/foreign.png",
      "data/charreferences/personas/900000000000000001/own.png",
    ]) {
      expect(await loadCharRefAsBase64(reference, "users", "900000000000000001")).toBeNull();
    }
  });

  it("deletes only a local reference inside the requesting owner's directory", async () => {
    mkdirSync(ownerDir, { recursive: true });
    mkdirSync(otherDir, { recursive: true });
    writeFileSync(join(ownerDir, "replaced.png"), "own");
    writeFileSync(join(otherDir, "kept.png"), "foreign");

    for (const reference of [
      "data/charreferences/users/900000000000000002/kept.png",
      "data/charreferences/users/900000000000000001/../900000000000000002/kept.png",
    ]) {
      expect(await deleteCharRef(reference, "users", "900000000000000001")).toBe(false);
    }
    expect(existsSync(join(otherDir, "kept.png"))).toBe(true);

    expect(
      await deleteCharRef("data/charreferences/users/900000000000000001/replaced.png", "users", "900000000000000001"),
    ).toBe(true);
    expect(existsSync(join(ownerDir, "replaced.png"))).toBe(false);
  });
});
