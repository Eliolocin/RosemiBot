import { isIP } from "node:net";
import { type RemoteUrlValidationFailureCode, validateRemoteUrl } from "@/utils/security/remoteUrlSecurity";

export type RemoteUrlPolicyFailureCode =
  | RemoteUrlValidationFailureCode
  | "REDIRECT_FORBIDDEN"
  | "REDIRECT_LIMIT_EXCEEDED"
  | "REDIRECT_LOCATION_MISSING"
  | "REDIRECT_CREDENTIALS_WITHHELD"
  | "ADDRESS_NOT_PINNABLE";

/**
 * A user-supplied URL was refused by the SSRF gate, either before the first
 * request or at a redirect hop.
 *
 * Thrown instead of a bare Error so callers can tell a deliberate refusal from a
 * transport failure: no socket was opened, so these must not be reported as
 * network errors, retried, or alerted on as connectivity problems.
 */
export class RemoteUrlPolicyError extends Error {
  readonly failureCode: RemoteUrlPolicyFailureCode | undefined;
  readonly hostname: string;

  constructor(message: string, hostname: string, failureCode?: RemoteUrlPolicyFailureCode) {
    super(message);
    this.name = "RemoteUrlPolicyError";
    this.hostname = hostname;
    this.failureCode = failureCode;
  }
}

export interface PinnedFetchRequest {
  url: URL;
  init: BunFetchRequestInit;
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const USER_REMOTE_FETCH_MAX_REDIRECTS = readPositiveIntegerEnv("USER_REMOTE_FETCH_MAX_REDIRECTS", 3);

function isRequestLike(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function mergeHeaders(baseHeaders?: HeadersInit, overrideHeaders?: HeadersInit): Headers {
  const headers = new Headers(baseHeaders);
  if (!overrideHeaders) {
    return headers;
  }

  const overrides = new Headers(overrideHeaders);
  overrides.forEach((value, key) => {
    headers.set(key, value);
  });
  return headers;
}

async function normalizeRequestInput(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<{
  url: URL;
  requestInit: RequestInit;
}> {
  if (!isRequestLike(input)) {
    return {
      url: input instanceof URL ? new URL(input.toString()) : new URL(input),
      requestInit: { ...(init ?? {}) },
    };
  }

  const method = init?.method ?? input.method;
  let body = init?.body;
  if (body === undefined && !["GET", "HEAD"].includes(method.toUpperCase())) {
    body = await input.clone().arrayBuffer();
  }

  return {
    url: new URL(input.url),
    requestInit: {
      method,
      headers: mergeHeaders(input.headers, init?.headers),
      body,
      redirect: init?.redirect ?? input.redirect,
      signal: init?.signal ?? input.signal,
      credentials: init?.credentials ?? input.credentials,
      keepalive: init?.keepalive ?? input.keepalive,
      mode: init?.mode ?? input.mode,
      referrer: init?.referrer ?? input.referrer,
      referrerPolicy: init?.referrerPolicy ?? input.referrerPolicy,
      integrity: init?.integrity ?? input.integrity,
    },
  };
}

/**
 * Build a Bun-native request pinned to an already validated IP address.
 *
 * The URL uses the literal IP so the transport performs no second DNS lookup,
 * while Host and TLS SNI retain the validated origin hostname. Bun's native fetch
 * is used because npm Undici response bodies can stall under Bun for lengthless or
 * compressed streaming responses.
 */
export function createPinnedFetchRequest(url: URL, requestInit: RequestInit, address: string): PinnedFetchRequest {
  const addressFamily = isIP(address);
  if (addressFamily !== 4 && addressFamily !== 6) {
    throw new Error(`Validated address '${address}' is not a valid IP address.`);
  }

  const pinnedUrl = new URL(url);
  pinnedUrl.hostname = addressFamily === 6 ? `[${address}]` : address;

  const headers = mergeHeaders(requestInit.headers);
  headers.set("host", url.host);

  const init: BunFetchRequestInit = {
    ...requestInit,
    headers,
    redirect: "manual",
  };
  if (url.protocol === "https:") {
    init.tls = { serverName: url.hostname };
  }

  return { url: pinnedUrl, init };
}

function isRedirectStatus(status: number): status is 301 | 302 | 303 | 307 | 308 {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isConnectionRefusedTransportError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  if (record.code === "ConnectionRefused" || record.code === "ECONNREFUSED") return true;
  return isConnectionRefusedTransportError(record.cause);
}

/**
 * Headers that carry no credential and may follow a redirect to another origin. Every other header
 * is dropped at an origin change, because callers attach provider keys under custom names
 * (`x-api-key`, `x-goog-api-key`) and a denylist would forward the next one somebody adds.
 */
const CROSS_ORIGIN_REDIRECT_HEADERS = new Set([
  "accept",
  "accept-language",
  "content-language",
  "content-type",
  "user-agent",
]);

/** Statuses that mean the redirected origin wanted the credential this fetcher withheld. */
const CREDENTIAL_CHALLENGE_STATUSES = new Set([401, 403, 407]);

function hasUrlCredentials(url: URL): boolean {
  return url.username !== "" || url.password !== "";
}

function hasCrossOriginUnsafeHeaders(headers: Headers): boolean {
  for (const name of headers.keys()) {
    if (!CROSS_ORIGIN_REDIRECT_HEADERS.has(name)) return true;
  }
  return false;
}

function buildRedirectRequestInit(requestInit: RequestInit, status: number, crossOrigin: boolean): RequestInit {
  const currentMethod = (requestInit.method ?? "GET").toUpperCase();
  const headers = mergeHeaders(requestInit.headers);
  if (crossOrigin) {
    for (const name of [...headers.keys()]) {
      if (!CROSS_ORIGIN_REDIRECT_HEADERS.has(name)) headers.delete(name);
    }
  }

  if (status === 303 || ((status === 301 || status === 302) && currentMethod === "POST")) {
    headers.delete("content-length");
    headers.delete("content-type");
    headers.delete("transfer-encoding");

    return {
      ...requestInit,
      method: "GET",
      body: undefined,
      headers,
    };
  }

  return {
    ...requestInit,
    headers,
  };
}

function credentialsWithheldError(url: URL, reason: string): RemoteUrlPolicyError {
  return new RemoteUrlPolicyError(
    `Credentials were not forwarded to '${url.origin}' because ${reason}. Configure the endpoint with its final URL directly.`,
    url.hostname,
    "REDIRECT_CREDENTIALS_WITHHELD",
  );
}

/**
 * Refuses a cross-origin hop that cannot be made anonymous, before anything is sent to it.
 *
 * Origin equality (scheme, hostname, effective port) is the trust unit: the operator configured
 * one origin, and a redirect response cannot extend that trust. Other cross-origin hops continue
 * anonymously so signed asset URLs still download.
 *
 * @returns Whether the hop drops credentials the request carried.
 */
export function checkCrossOriginRedirect(currentUrl: URL, nextUrl: URL, requestInit: RequestInit): boolean {
  if (hasUrlCredentials(nextUrl)) {
    throw credentialsWithheldError(nextUrl, "the redirect target embeds a username or password");
  }
  const carriesCredentials =
    hasUrlCredentials(currentUrl) || hasCrossOriginUnsafeHeaders(mergeHeaders(requestInit.headers));
  if (carriesCredentials && currentUrl.protocol === "https:" && nextUrl.protocol === "http:") {
    throw credentialsWithheldError(nextUrl, "the redirect downgrades HTTPS to HTTP");
  }
  return carriesCredentials;
}

export async function resolveValidatedUserRedirect(
  currentUrl: URL,
  location: string,
  strict: boolean,
  allowPrivateNetwork = false,
): Promise<URL> {
  const nextUrl = new URL(location, currentUrl);
  const validation = await validateRemoteUrl(nextUrl.toString(), { strict, allowPrivateNetwork });
  if (!validation.valid) {
    throw new RemoteUrlPolicyError(
      validation.details ?? `Remote redirect validation failed for '${nextUrl.hostname}'.`,
      nextUrl.hostname,
      validation.failureCode,
    );
  }
  return nextUrl;
}

interface RedirectState {
  redirectCount: number;
  strict: boolean;
  allowPrivateNetwork: boolean;
  /** Set once a hop dropped credentials; they are never reattached, even if a later hop returns. */
  credentialsWithheld: boolean;
}

async function fetchUserRemoteUrlInternal(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  state: RedirectState,
): Promise<Response> {
  const { redirectCount, strict, allowPrivateNetwork } = state;
  const { url, requestInit } = await normalizeRequestInput(input, init);
  const validation = await validateRemoteUrl(url.toString(), { strict, allowPrivateNetwork });
  if (!validation.valid) {
    throw new RemoteUrlPolicyError(
      validation.details ?? `Remote URL validation failed for '${url.hostname}'.`,
      url.hostname,
      validation.failureCode,
    );
  }

  const redirectPolicy = requestInit.redirect ?? "follow";
  let fetchUrl = url;
  let fetchInit: BunFetchRequestInit = { ...requestInit, redirect: "manual" };
  let response: Response | null = null;

  if (isIP(url.hostname) === 0) {
    const pinnedAddresses = [...new Set(validation.resolvedAddresses?.filter((address) => isIP(address) !== 0) ?? [])];
    if (pinnedAddresses.length === 0) {
      throw new RemoteUrlPolicyError(
        `Remote URL validation did not return a pinnable address for '${url.hostname}'.`,
        url.hostname,
        "ADDRESS_NOT_PINNABLE",
      );
    }
    const method = (requestInit.method ?? "GET").toUpperCase();
    const canRetryAfterAnyTransportFailure = method === "GET" || method === "HEAD";
    let lastTransportError: unknown;
    for (const [index, pinnedAddress] of pinnedAddresses.entries()) {
      ({ url: fetchUrl, init: fetchInit } = createPinnedFetchRequest(url, requestInit, pinnedAddress));
      try {
        response = await fetch(fetchUrl, fetchInit);
        lastTransportError = undefined;
        break;
      } catch (error) {
        lastTransportError = error;
        const isFinalAddress = index === pinnedAddresses.length - 1;
        const canRetry = canRetryAfterAnyTransportFailure || isConnectionRefusedTransportError(error);
        if (!canRetry || requestInit.signal?.aborted || isFinalAddress) throw error;
      }
    }
    if (lastTransportError !== undefined) throw lastTransportError;
  } else {
    response = await fetch(fetchUrl, fetchInit);
  }
  if (!response) {
    throw new Error(`Remote request to '${url.hostname}' completed without a response.`);
  }

  // Do not expose the transport-level pinned IP to callers or redirect logic.
  Object.defineProperty(response, "url", { value: url.toString() });

  if (!isRedirectStatus(response.status)) {
    if (state.credentialsWithheld && CREDENTIAL_CHALLENGE_STATUSES.has(response.status)) {
      await response.body?.cancel();
      throw credentialsWithheldError(url, `the redirect left the configured origin and '${url.origin}' requires them`);
    }
    return response;
  }

  if (redirectPolicy === "manual") {
    return response;
  }

  await response.body?.cancel();

  if (redirectPolicy === "error") {
    throw new RemoteUrlPolicyError(
      `Redirects are not allowed for user-supplied URL '${url.toString()}'.`,
      url.hostname,
      "REDIRECT_FORBIDDEN",
    );
  }

  if (redirectCount >= USER_REMOTE_FETCH_MAX_REDIRECTS) {
    throw new RemoteUrlPolicyError(
      `Too many redirects while fetching '${url.toString()}'.`,
      url.hostname,
      "REDIRECT_LIMIT_EXCEEDED",
    );
  }

  const location = response.headers.get("location");
  if (!location) {
    throw new RemoteUrlPolicyError(
      `Redirect response from '${url.toString()}' did not include a Location header.`,
      url.hostname,
      "REDIRECT_LOCATION_MISSING",
    );
  }

  const nextUrl = await resolveValidatedUserRedirect(url, location, strict, allowPrivateNetwork);
  const crossOrigin = url.origin !== nextUrl.origin;
  const withholdsCredentials = crossOrigin && checkCrossOriginRedirect(url, nextUrl, requestInit);
  return await fetchUserRemoteUrlInternal(
    nextUrl,
    buildRedirectRequestInit(requestInit, response.status, crossOrigin),
    {
      ...state,
      redirectCount: redirectCount + 1,
      credentialsWithheld: state.credentialsWithheld || withholdsCredentials,
    },
  );
}

export interface FetchUserRemoteUrlOptions {
  /** Enforce the private/link-local/loopback blocklist even outside production. */
  strict?: boolean;
  /** Permit private/internal targets even in production, aligning with the
   *  `fetch_url` `FETCH_URL_ALLOW_PRIVATE_NETWORK` opt-in. The always-on
   *  cloud-metadata denylist still applies. Ignored when `strict` is set. */
  allowPrivateNetwork?: boolean;
}

export async function fetchUserRemoteUrl(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: FetchUserRemoteUrlOptions,
): Promise<Response> {
  return await fetchUserRemoteUrlInternal(input, init, {
    redirectCount: 0,
    strict: options?.strict === true,
    allowPrivateNetwork: options?.allowPrivateNetwork === true,
    credentialsWithheld: false,
  });
}
