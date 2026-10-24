import { registerHealthServerRoute } from "@/init/healthServer";
import { log } from "@/utils/misc/logger";
import { oauthFailureDiagnostics } from "@/utils/oauth/errorDiagnostics";
import { OAUTH_CALLBACK_PATH } from "@/utils/oauth/settings";
import { validateSignedOAuthState } from "@/utils/oauth/state";
import { localizer } from "@/utils/text/localizer";

export interface OAuthCallbackResponse {
  statusCode: number;
  contentType: string;
  body: string;
}

const flows = new Map<
  string,
  {
    signerSecret: string;
    handle: (url: URL) => Promise<OAuthCallbackResponse>;
  }
>();

export function registerOAuthCallbackFlow(flow: string, handler: NonNullable<ReturnType<typeof flows.get>>): void {
  flows.set(flow, handler);
}

function invalidCallback(): OAuthCallbackResponse {
  return {
    statusCode: 400,
    contentType: "text/plain; charset=utf-8",
    body: localizer("en-US", "general.oauth.invalid_callback"),
  };
}

export async function dispatchOAuthCallback(url: URL): Promise<OAuthCallbackResponse> {
  const states = url.searchParams.getAll("state");
  const state = states[0];
  if (states.length !== 1 || !state || state.length > 4096) return invalidCallback();
  let flow: unknown;
  try {
    flow = (JSON.parse(Buffer.from(state.split(".")[0], "base64url").toString("utf8")) as { flow?: unknown }).flow;
  } catch {
    return invalidCallback();
  }
  if (typeof flow !== "string") return invalidCallback();
  const handler = flows.get(flow);
  if (!handler || !validateSignedOAuthState(state, handler.signerSecret, new Date(), flow).valid)
    return invalidCallback();
  try {
    return await handler.handle(url);
  } catch (error) {
    void log.error(
      "OAuth callback handler failed",
      undefined,
      {
        metadata: { flow, ...oauthFailureDiagnostics(error) },
      },
      { persist: false },
    );
    return {
      statusCode: 500,
      contentType: "text/plain; charset=utf-8",
      body: localizer("en-US", "general.oauth.server_error"),
    };
  }
}

export function initializeOAuthCallbackRoute(): void {
  registerHealthServerRoute({
    method: "GET",
    path: OAUTH_CALLBACK_PATH,
    handler: async (_req, res, context) => {
      const response = await dispatchOAuthCallback(context.requestUrl);
      res.writeHead(response.statusCode, {
        "Content-Type": response.contentType,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      });
      res.end(response.body);
    },
  });
}

export function clearOAuthCallbackFlowsForTests(): void {
  flows.clear();
}
