import { z } from "zod";
import type { OAuthFetch } from "@/utils/oauth/oauthFetch";
import { readBoundedResponse } from "@/utils/security/boundedResponse";
import { fetchUserRemoteUrl } from "@/utils/security/userRemoteFetch";

export function patreonTokenTransport(fetchImpl?: OAuthFetch): OAuthFetch {
  return async (input, init) => {
    const response = await (fetchImpl
      ? fetchImpl(input, init)
      : fetchUserRemoteUrl(String(input), init, { strict: true }));
    if (response.ok) return response;
    const body = await readBoundedResponse(response, 128 * 1024, init?.signal ?? undefined);
    const headers = new Headers(response.headers);
    try {
      const parsed = z
        .object({ errors: z.array(z.object({ retry_after_seconds: z.number().finite().nonnegative().optional() })) })
        .safeParse(JSON.parse(body.toString("utf8")));
      if (parsed.success) {
        const seconds = Math.max(0, ...parsed.data.errors.map((error) => error.retry_after_seconds ?? 0));
        const header = headers.get("Retry-After");
        const headerSeconds = header && /^\d+(?:\.\d+)?$/.test(header) ? Number(header) : 0;
        const headerDate = header ? Date.parse(header) : Number.NaN;
        const dateSeconds = Number.isFinite(headerDate) ? Math.max(0, (headerDate - Date.now()) / 1000) : 0;
        if (seconds > 0) headers.set("Retry-After", String(Math.max(seconds, headerSeconds, dateSeconds)));
      }
    } catch {}
    return new Response(new Uint8Array(body), { status: response.status, statusText: response.statusText, headers });
  };
}
