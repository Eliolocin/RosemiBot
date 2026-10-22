import type { IncomingMessage } from "node:http";
import { initializeOAuthCallbackRoute, registerOAuthCallbackFlow } from "@/utils/oauth/callbackRoute";
import type { SupporterBillingConfig } from "@/modules/supporter-billing/config";
import { registerHealthServerRoute } from "@/init/healthServer";
import { handlePatreonOAuthCallbackUrl } from "@/modules/supporter-billing/patreon/callback";
import { handlePatreonWebhookRawBody } from "@/modules/supporter-billing/patreon/webhook";
import {
  getPatreonWebhookMaxBytes,
  getPatreonOAuthCredentials,
  PATREON_WEBHOOK_PATH,
} from "@/modules/supporter-billing/patreon/settings";

export interface PatreonRouteInitializationContext {
  config: SupporterBillingConfig;
  env?: Readonly<Record<string, string | undefined>>;
}

export type PatreonRouteInitializer = (context: PatreonRouteInitializationContext) => void | Promise<void>;

async function readRawRequestBody(req: IncomingMessage, maxBytes: number): Promise<Uint8Array | "too_large"> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      return "too_large";
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

export function initializePatreonRoutes(context: PatreonRouteInitializationContext): void {
  initializeOAuthCallbackRoute();
  registerOAuthCallbackFlow("patreon", {
    signerSecret: getPatreonOAuthCredentials(context.config, context.env).clientSecret,
    handle: (url) => handlePatreonOAuthCallbackUrl(url, { config: context.config, env: context.env }),
  });

  registerHealthServerRoute({
    method: "POST",
    path: PATREON_WEBHOOK_PATH,
    handler: async (req, res) => {
      const rawBody = await readRawRequestBody(req, getPatreonWebhookMaxBytes());
      if (rawBody === "too_large") {
        res.writeHead(413, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end("Payload Too Large");
        return;
      }

      const response = await handlePatreonWebhookRawBody(rawBody, req.headers, {
        config: context.config,
      });

      res.writeHead(response.statusCode, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(response.body);
    },
  });
}
