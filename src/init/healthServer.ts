import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { log } from "@/utils/misc/logger";
import { healthTracker } from "@/utils/misc/healthTracker";
import { eventLoopMonitor } from "@/utils/misc/eventLoopMonitor";

interface HealthServerRouteContext {
  requestUrl: URL;
}

type HealthServerRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  context: HealthServerRouteContext,
) => void | Promise<void>;

export interface HealthServerRoute {
  method: string;
  path: string;
  handler: HealthServerRouteHandler;
}

const registeredRoutes = new Map<string, HealthServerRoute>();

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/** Optional modules register routes here even when the base installation has no extra HTTP routes. */
export function registerHealthServerRoute(route: HealthServerRoute): void {
  registeredRoutes.set(routeKey(route.method, route.path), {
    ...route,
    method: route.method.toUpperCase(),
  });
}

/**
 * Binds the health check HTTP server on the given port.
 * Called before any other init so Cloud Run's startup probe can bind the port
 * before the rest of initialization completes.
 *
 * Returns 503 during startup (before Discord connects), so expected and safe.
 * Returns 200 only when the Discord client is ready and the WebSocket is healthy.
 *
 * @param port - Port to bind (defaults to PORT env var, fallback 8080)
 */
export function startHealthServer(port: number): void {
  // Started here rather than with the post-ready timers so the series covers startup, which is when
  // the working set is established and when a stall would otherwise look like slow boot.
  eventLoopMonitor.start();

  const server = createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/health" || req.url === "/healthz")) {
      const healthStatus = healthTracker.getHealthStatus();
      const statusCode = healthStatus.healthy ? 200 : 503;

      // `eventLoop` is reported but deliberately excluded from the verdict: the Compose healthcheck
      // runs `curl -f`, so letting staleness produce a 503 would mark the container unhealthy on a
      // threshold nobody has calibrated yet.
      res.writeHead(statusCode, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: healthStatus.healthy ? "healthy" : "unhealthy",
          reason: healthStatus.reason,
          discord: {
            connected: healthStatus.details.clientReady,
            websocketPing: healthStatus.details.websocketPing,
            timeSinceLastActivity: healthStatus.details.timeSinceLastActivity,
            ...healthTracker.getConnectionState(),
          },
          eventLoop: eventLoopMonitor.getSnapshot(),
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    let requestUrl: URL;
    try {
      requestUrl = new URL(req.url ?? "/", "http://localhost");
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Bad Request");
      return;
    }
    const registeredRoute = registeredRoutes.get(routeKey(req.method ?? "GET", requestUrl.pathname));
    if (registeredRoute) {
      void Promise.resolve()
        .then(() => registeredRoute.handler(req, res, { requestUrl }))
        .catch((error) => {
          void log.error("Health server route handler failed", error);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Internal Server Error");
          } else {
            res.destroy();
          }
        });
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  server.listen(port, "0.0.0.0", () => {
    log.success(`Health check server listening on http://0.0.0.0:${port}/health`);
  });

  server.on("error", (error) => {
    log.error("Health check server error", error);
  });
}
