import { once } from "node:events";
import { request, Server } from "node:http";
import { describe, expect, it, spyOn } from "bun:test";
import { registerHealthServerRoute, startHealthServer } from "@/init/healthServer";
import { eventLoopMonitor } from "@/utils/misc/eventLoopMonitor";
import { stubLogMembers } from "../../helpers/mockSurface";

stubLogMembers({ success: () => undefined, error: () => undefined });

describe("health server route dispatch", () => {
  it("dispatches by method and pathname with query context while preserving probes and rejection handling", async () => {
    let server: Server | undefined;
    const realListen = Server.prototype.listen;
    const listen = spyOn(Server.prototype, "listen").mockImplementation(function (this: Server) {
      server = this;
      return this;
    });
    try {
      startHealthServer(0);
    } finally {
      listen.mockRestore();
    }
    if (!server) throw new Error("Health server did not start");
    const activeServer: Server = server;
    registerHealthServerRoute({
      method: "post",
      path: "/fixture-route",
      handler: (_req, res, { requestUrl }) => {
        res.writeHead(201);
        res.end(requestUrl.searchParams.get("value"));
      },
    });
    registerHealthServerRoute({
      method: "GET",
      path: "/fixture-failure",
      handler: async () => {
        throw new Error("fixture-failure");
      },
    });
    registerHealthServerRoute({
      method: "GET",
      path: "/fixture-sync-failure",
      handler: () => {
        throw new Error("fixture-failure");
      },
    });
    registerHealthServerRoute({
      method: "GET",
      path: "/healthz",
      handler: (_req, res) => {
        res.writeHead(418);
        res.end();
      },
    });
    try {
      realListen.call(activeServer, { port: 0, host: "127.0.0.1" });
      await once(activeServer, "listening");
      const address = activeServer.address();
      if (!address || typeof address === "string") throw new Error("Missing health server address");
      const base = `http://127.0.0.1:${address.port}`;
      const response = await fetch(`${base}/fixture-route?value=fixture`, { method: "POST" });
      expect(response.status).toBe(201);
      expect(await response.text()).toBe("fixture");
      for (const path of ["/fixture-route", "/missing"]) {
        const missing = await fetch(`${base}${path}`);
        expect(missing.status).toBe(404);
        await missing.text();
      }
      const probe = await fetch(`${base}/healthz`);
      expect([200, 503]).toContain(probe.status);
      expect(await probe.json()).toHaveProperty("eventLoop");
      for (const path of ["/fixture-failure", "/fixture-sync-failure"]) {
        const failure = await fetch(`${base}${path}`);
        expect(failure.status).toBe(500);
        await failure.text();
      }
      const invalidStatus = await new Promise<number | undefined>((resolve, reject) => {
        const invalid = request({ host: "127.0.0.1", port: address.port, path: "http://[" }, (response) => {
          response.resume();
          resolve(response.statusCode);
        });
        invalid.on("error", reject);
        invalid.end();
      });
      expect(invalidStatus).toBe(400);
    } finally {
      eventLoopMonitor.stop();
      activeServer.closeAllConnections();
      if (activeServer.listening)
        await new Promise<void>((resolve, reject) =>
          activeServer.close((error) => (error ? reject(error) : resolve())),
        );
    }
  });
});
