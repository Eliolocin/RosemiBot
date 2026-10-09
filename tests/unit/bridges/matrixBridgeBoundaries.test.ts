import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { createRequire } from "node:module";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import type * as MatrixAppserviceBridge from "matrix-appservice-bridge";
import { execute as executeMatrixLink } from "@/commands/matrix/link";
import { initializeMatrixClient } from "@/utils/bridges/matrix/client";
import { downloadMatrixMedia, parseMxcUri } from "@/utils/bridges/matrix/media";
import { ensureRoomRelayable, getRoomEncryptionState } from "@/utils/bridges/matrix/rooms";
import { getPersonaReplyEventMetadata } from "@/utils/bridges/matrix/stateSync";
import {
  getMatrixBridge,
  MatrixConfigError,
  parseMatrixSettings,
  setMatrixBridge,
  setMatrixSettings,
  unencryptedRoomCache,
} from "@/utils/bridges/matrix/state";
import * as tomoriStateCache from "@/utils/cache/tomoriStateCache";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";
import { initializeLocalizer } from "@/utils/text/localizer";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";
import { createPersona, createUserRow } from "../../helpers/fixtures";
import { localizedCopy } from "../../helpers/localeCases";

await initializeLocalizer();

const MATRIX_ENV_NAMES = [
  "MATRIX_HOMESERVER_URL",
  "MATRIX_ACCESS_TOKEN",
  "MATRIX_HS_TOKEN",
  "MATRIX_BOT_USER_ID",
  "MATRIX_SERVER_NAME",
  "MATRIX_APPSERVICE_PORT",
  "MATRIX_APPSERVICE_BIND_HOST",
  "MATRIX_APPSERVICE_PUBLIC_URL",
  "MATRIX_MAX_ATTACHMENT_MB",
  "MATRIX_MEDIA_TIMEOUT_MS",
] as const;
const originalEnv = Object.fromEntries(MATRIX_ENV_NAMES.map((name) => [name, process.env[name]]));
const AS_TOKEN = "synthetic-appservice-token";
const MIB = 1024 * 1024;

type RecordedRequest = { path: string; authorization: string | null };

/** A synthetic homeserver on loopback; each test installs the route handler it needs. */
const homeserverRequests: RecordedRequest[] = [];
let homeserverRoute: (request: Request, path: string) => Response | Promise<Response> = () =>
  new Response("unexpected", { status: 500 });
const homeserver = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    homeserverRequests.push({ path, authorization: request.headers.get("authorization") });
    return homeserverRoute(request, path);
  },
});
const homeserverUrl = `http://127.0.0.1:${homeserver.port}`;

function restoreMatrixEnv(): void {
  for (const name of MATRIX_ENV_NAMES) {
    const original = originalEnv[name];
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
}

type MatrixEnv = Partial<Record<(typeof MATRIX_ENV_NAMES)[number], string>>;

/** Every name written here is restored by `restoreMatrixEnv` in `afterEach`. */
function setMatrixEnv(values: MatrixEnv): void {
  for (const [name, value] of Object.entries(values)) process.env[name] = value;
}

function useSettings(overrides: MatrixEnv = {}): void {
  setMatrixEnv(overrides);
  setMatrixSettings(parseMatrixSettings());
}

beforeEach(() => {
  restoreMatrixEnv();
  for (const name of MATRIX_ENV_NAMES) delete process.env[name];
  setMatrixEnv({ MATRIX_HOMESERVER_URL: homeserverUrl, MATRIX_ACCESS_TOKEN: AS_TOKEN });
  homeserverRequests.length = 0;
  unencryptedRoomCache.clear();
  useSettings();
});

afterEach(() => {
  restoreMatrixEnv();
  setMatrixSettings(null);
  setMatrixBridge(null);
});

afterAll(() => {
  homeserver.stop(true);
});

describe("Matrix deployment settings", () => {
  it("rejects malformed, non-positive, and out-of-range values instead of producing NaN", () => {
    const rejected: Array<[string, string]> = [
      ["MATRIX_MAX_ATTACHMENT_MB", "abc"],
      ["MATRIX_MAX_ATTACHMENT_MB", "0"],
      ["MATRIX_MAX_ATTACHMENT_MB", "-1"],
      ["MATRIX_MAX_ATTACHMENT_MB", "Infinity"],
      ["MATRIX_MAX_ATTACHMENT_MB", "101"],
      ["MATRIX_MEDIA_TIMEOUT_MS", "NaN"],
      ["MATRIX_MEDIA_TIMEOUT_MS", "999"],
      ["MATRIX_MEDIA_TIMEOUT_MS", "1500.5"],
      ["MATRIX_APPSERVICE_PORT", "70000"],
      ["MATRIX_APPSERVICE_PORT", "9993abc"],
      ["MATRIX_APPSERVICE_BIND_HOST", "bad host"],
    ];
    const accepted: string[] = [];
    for (const [name, value] of rejected) {
      process.env[name] = value;
      try {
        parseMatrixSettings();
        accepted.push(`${name}=${value}`);
      } catch (error) {
        if (!(error instanceof MatrixConfigError)) throw error;
      }
      delete process.env[name];
    }
    expect(accepted).toEqual([]);
  });

  it("binds loopback by default and accepts an explicit bind host and fractional size", () => {
    expect(parseMatrixSettings()).toMatchObject({ port: 9993, bindHost: "127.0.0.1", maxAttachmentBytes: 8 * MIB });

    setMatrixEnv({ MATRIX_APPSERVICE_BIND_HOST: "0.0.0.0", MATRIX_MAX_ATTACHMENT_MB: "0.5" });
    expect(parseMatrixSettings()).toMatchObject({ bindHost: "0.0.0.0", maxAttachmentBytes: MIB / 2 });
  });
});

describe("appservice listener", () => {
  it("passes the loopback bind host to the bridge and rejects transactions without the homeserver token", async () => {
    const portProbe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const listenerPort = portProbe.port;
    portProbe.stop(true);

    setMatrixEnv({
      MATRIX_HS_TOKEN: "synthetic-homeserver-token",
      MATRIX_BOT_USER_ID: "@tomoribot:synthetic.test",
      MATRIX_SERVER_NAME: "synthetic.test",
      MATRIX_APPSERVICE_PORT: String(listenerPort),
    });
    const { Bridge } = createRequire(import.meta.url)("matrix-appservice-bridge") as typeof MatrixAppserviceBridge;
    const listen = spyOn(Bridge.prototype, "listen");

    try {
      await initializeMatrixClient({} as Client);
      expect(getMatrixBridge()).not.toBeNull();
      expect(listen.mock.calls[0]?.[1]).toBe("127.0.0.1");

      const transactionUrl = `http://127.0.0.1:${listenerPort}/_matrix/app/v1/transactions/1`;
      const send = (authorization?: string) =>
        fetch(transactionUrl, {
          method: "PUT",
          headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
          body: JSON.stringify({ events: [] }),
        });
      expect((await send()).status).toBe(403);
      expect((await send("Bearer wrong-token")).status).toBe(403);
      expect((await send("Bearer synthetic-homeserver-token")).status).toBe(200);
    } finally {
      listen.mockRestore();
      await getMatrixBridge()?.close();
    }
  });
});

describe("MXC identifiers", () => {
  it("accepts valid server names including ports and IP literals", () => {
    const valid = [
      ["mxc://matrix.org/abcDEF_123-x", "matrix.org", "abcDEF_123-x"],
      ["mxc://localhost:8448/media", "localhost:8448", "media"],
      ["mxc://203.0.113.5/media", "203.0.113.5", "media"],
      ["mxc://[2001:db8::1]:8448/media", "[2001:db8::1]:8448", "media"],
    ] as const;
    for (const [uri, serverName, mediaId] of valid) {
      expect(parseMxcUri(uri)).toEqual({ serverName, mediaId });
    }
  });

  it("refuses traversal, extra segments, encodings, and malformed authorities", () => {
    const invalid = [
      "mxc://matrix.org/../../_synapse/admin",
      "mxc://matrix.org/a/b",
      "mxc://matrix.org/..%2F..%2Fadmin",
      "mxc://matrix.org/a\\b",
      "mxc://matrix.org/a?x=1",
      "mxc://matrix.org/a#frag",
      "mxc://matrix.org/.",
      "mxc://../media",
      "mxc://./media",
      "mxc://matrix..org/media",
      "mxc://999.1.1.1/media",
      "mxc://[zz::1]/media",
      "mxc://matrix.org:0/media",
      "mxc://matrix.org:70000/media",
      "mxc://user@matrix.org/media",
      "mxc://matrix.org/",
      "https://matrix.org/media",
    ];
    expect(invalid.filter((uri) => parseMxcUri(uri) !== null)).toEqual([]);
  });
});

describe("authenticated media download", () => {
  it("sends no request at all for an identifier that could escape the download route", async () => {
    const result = await downloadMatrixMedia("mxc://matrix.org/../../admin", homeserverUrl, AS_TOKEN);

    expect(result).toBeNull();
    expect(homeserverRequests).toEqual([]);
  });

  it("downloads from the encoded route with the token", async () => {
    homeserverRoute = () => new Response("media-bytes", { headers: { "content-type": "image/png" } });

    const result = await downloadMatrixMedia("mxc://[2001:db8::1]:8448/abc", homeserverUrl, AS_TOKEN);

    expect(result?.buffer.toString()).toBe("media-bytes");
    expect(homeserverRequests).toEqual([
      {
        path: "/_matrix/client/v1/media/download/%5B2001%3Adb8%3A%3A1%5D%3A8448/abc",
        authorization: `Bearer ${AS_TOKEN}`,
      },
    ]);
  });

  it("cancels a chunked body without content-length once it passes the cap", async () => {
    useSettings({ MATRIX_MAX_ATTACHMENT_MB: "1" });
    let producedBytes = 0;
    homeserverRoute = () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            producedBytes += 64 * 1024;
            controller.enqueue(new Uint8Array(64 * 1024));
            if (producedBytes >= 64 * MIB) controller.close();
          },
        }),
      );

    const result = await downloadMatrixMedia("mxc://matrix.org/large", homeserverUrl, AS_TOKEN);

    expect(result).toBeNull();
    expect(producedBytes).toBeLessThan(64 * MIB);
  });

  it("follows a CDN redirect anonymously and keeps the size cap", async () => {
    const cdnRequests: RecordedRequest[] = [];
    const cdn = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        cdnRequests.push({ path, authorization: request.headers.get("authorization") });
        return path === "/large" ? new Response(new Uint8Array(2 * MIB)) : new Response("cdn-bytes");
      },
    });
    useSettings({ MATRIX_MAX_ATTACHMENT_MB: "1" });
    homeserverRoute = (_request, path) =>
      new Response(null, {
        status: 307,
        headers: { location: `http://127.0.0.1:${cdn.port}/${path.endsWith("/large") ? "large" : "small"}` },
      });

    try {
      const small = await downloadMatrixMedia("mxc://matrix.org/small", homeserverUrl, AS_TOKEN);
      const large = await downloadMatrixMedia("mxc://matrix.org/large", homeserverUrl, AS_TOKEN);

      expect(small?.buffer.toString()).toBe("cdn-bytes");
      expect(large).toBeNull();
      expect(cdnRequests.map((request) => request.authorization)).toEqual([null, null]);
    } finally {
      cdn.stop(true);
    }
  });
});

describe("reply event lookup", () => {
  const roomId = "!room:synthetic.test";

  it("cancels an oversized event body instead of buffering it", async () => {
    let producedBytes = 0;
    homeserverRoute = () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            producedBytes += 64 * 1024;
            controller.enqueue(new TextEncoder().encode(" ".repeat(64 * 1024)));
            if (producedBytes >= 64 * MIB) controller.close();
          },
        }),
      );

    const result = await getPersonaReplyEventMetadata(roomId, "$large", "synthetic.test");

    expect(result).toEqual({ isPersonaReply: false });
    expect(producedBytes).toBeLessThan(64 * MIB);
  });

  it("recognizes a persona event and refuses malformed shapes", async () => {
    const events: Record<string, unknown> = {
      $persona: { sender: "@_tomori_mirri:synthetic.test", content: { body: "hello  there" } },
      $foreign: { sender: "@_tomori_mirri:elsewhere.test", content: { body: "hi" } },
      $array: [{ sender: "@_tomori_mirri:synthetic.test" }],
      $badBody: { sender: "@_tomori_mirri:synthetic.test", content: { body: 42 } },
    };
    homeserverRoute = (_request, path) => Response.json(events[decodeURIComponent(path.split("/").at(-1) ?? "")]);

    const results = Object.fromEntries(
      await Promise.all(
        Object.keys(events).map(async (id) => [id, await getPersonaReplyEventMetadata(roomId, id, "synthetic.test")]),
      ),
    );

    expect(results).toEqual({
      $persona: { isPersonaReply: true, replySnippet: "hello there" },
      $foreign: { isPersonaReply: false },
      $array: { isPersonaReply: false },
      $badBody: { isPersonaReply: true, replySnippet: undefined },
    });
  });
});

describe("room encryption state", () => {
  const stateResponses: Record<string, () => Response> = {
    "!encrypted:synthetic.test": () => Response.json({ algorithm: "m.megolm.v1.aes-sha2" }),
    "!plain:synthetic.test": () =>
      Response.json({ errcode: "M_NOT_FOUND", error: "Event not found." }, { status: 404 }),
    "!proxy404:synthetic.test": () => new Response("<html>Not Found</html>", { status: 404 }),
    "!other404:synthetic.test": () => Response.json({ errcode: "M_UNRECOGNIZED" }, { status: 404 }),
    "!forbidden:synthetic.test": () => Response.json({ errcode: "M_FORBIDDEN" }, { status: 403 }),
    "!unauthorized:synthetic.test": () => Response.json({ errcode: "M_UNKNOWN_TOKEN" }, { status: 401 }),
    "!broken:synthetic.test": () => new Response("upstream failure", { status: 502 }),
    "!garbled:synthetic.test": () => new Response("{not json", { status: 200 }),
  };

  beforeEach(() => {
    homeserverRoute = (_request, path) => {
      const roomId = decodeURIComponent(path.split("/")[5] ?? "");
      return stateResponses[roomId]?.() ?? new Response("unknown room", { status: 500 });
    };
  });

  it("treats only the documented missing-state response as unencrypted", async () => {
    const results: Record<string, string> = {};
    for (const roomId of Object.keys(stateResponses)) {
      results[roomId] = await getRoomEncryptionState(roomId);
    }

    expect(results).toEqual({
      "!encrypted:synthetic.test": "encrypted",
      "!plain:synthetic.test": "unencrypted",
      "!proxy404:synthetic.test": "unavailable",
      "!other404:synthetic.test": "unavailable",
      "!forbidden:synthetic.test": "unavailable",
      "!unauthorized:synthetic.test": "unavailable",
      "!broken:synthetic.test": "unavailable",
      "!garbled:synthetic.test": "unavailable",
    });
  });

  it("fails closed when the homeserver does not answer before the deadline", async () => {
    useSettings({ MATRIX_MEDIA_TIMEOUT_MS: "1000" });
    homeserverRoute = () => new Promise<Response>((resolve) => setTimeout(() => resolve(Response.json({})), 3000));

    expect(await getRoomEncryptionState("!slow:synthetic.test")).toBe("unavailable");
  });

  it("unlinks a room that became encrypted and notifies its Discord channel", async () => {
    const roomId = "!plain:synthetic.test";
    const send = mock(async () => undefined);
    const channel = { isSendable: () => true, isDMBased: () => false, guild: { preferredLocale: "en-US" }, send };
    const client = { channels: { fetch: async () => channel } } as unknown as Client;
    const unlink = spyOn(serverRepository, "unlinkMatrixRoom").mockResolvedValue("123456789012345678");

    try {
      expect(await ensureRoomRelayable(roomId, client)).toBe(true);
      stateResponses[roomId] = () => Response.json({ algorithm: "m.megolm.v1.aes-sha2" });
      expect(await ensureRoomRelayable(roomId, client)).toBe(true);

      expect(await ensureRoomRelayable(roomId, client, { refresh: true })).toBe(false);
      expect(unlink).toHaveBeenCalledWith(roomId);
      expect(JSON.stringify(send.mock.calls)).toContain(localizedCopy("en-US", "matrix.encryption_unlinked.title"));
      expect(await ensureRoomRelayable(roomId, client)).toBe(false);
    } finally {
      unlink.mockRestore();
      stateResponses[roomId] = () => Response.json({ errcode: "M_NOT_FOUND" }, { status: 404 });
    }
  });

  it("pauses relay without unlinking when the state is unavailable", async () => {
    const unlink = spyOn(serverRepository, "unlinkMatrixRoom");
    try {
      expect(await ensureRoomRelayable("!broken:synthetic.test", {} as Client)).toBe(false);
      expect(unlink).not.toHaveBeenCalled();
    } finally {
      unlink.mockRestore();
    }
  });
});

describe("/matrix link", () => {
  let tomoriState: ReturnType<typeof spyOn>;

  beforeAll(() => {
    tomoriState = spyOn(tomoriStateCache, "getCachedTomoriState").mockResolvedValue(createPersona());
  });

  afterAll(() => {
    tomoriState.mockRestore();
  });

  async function runLink(roomId: string) {
    const intent = { join: async () => undefined, sendMessage: async () => ({}) };
    setMatrixBridge({ getIntent: () => intent } as unknown as MatrixAppserviceBridge.Bridge);
    const { interaction, calls } = makeFakeInteraction({
      guild: { id: "guild-fixture" },
      guildId: "guild-fixture",
      memberPermissions: { has: () => true },
    });
    Object.assign(interaction.options, {
      getString: () => roomId,
      getChannel: () => ({ id: "123456789012345678", name: "bridge" }),
    });
    await executeMatrixLink(
      {} as Client,
      interaction as unknown as ChatInputCommandInteraction,
      createUserRow(),
      "en-US",
    );
    return JSON.stringify(calls);
  }

  it("refuses to save a link when encryption cannot be verified, and links a verified room", async () => {
    homeserverRoute = (_request, path) =>
      path.includes(encodeURIComponent("!plain:synthetic.test"))
        ? Response.json({ errcode: "M_NOT_FOUND" }, { status: 404 })
        : Response.json({ errcode: "M_FORBIDDEN" }, { status: 403 });
    const link = spyOn(serverRepository, "linkMatrix").mockResolvedValue(true);
    const existing = spyOn(serverRepository, "getExistingMatrixLink").mockResolvedValue(null);

    try {
      const refused = await runLink("!unknown:synthetic.test");
      expect(link).not.toHaveBeenCalled();
      expect(refused).toContain(localizedCopy("en-US", "commands.matrix.link.encryption_unknown_title"));

      await runLink("!plain:synthetic.test");
      expect(link).toHaveBeenCalledTimes(1);
    } finally {
      link.mockRestore();
      existing.mockRestore();
    }
  });
});
