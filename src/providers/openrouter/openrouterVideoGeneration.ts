import type {
  ProviderNativeVideoGenerationRequest,
  ProviderNativeVideoGenerationResult,
} from "@/types/provider/featureInterfaces";
import type { Subprocess } from "bun";
import { log, redactLogString } from "@/utils/misc/logger";
import { z } from "zod";
import { readBoundedResponse } from "@/utils/security/boundedResponse";
import { safeDownload } from "@/utils/security/safeDownload";
import { PROVIDER_VIDEO_DOWNLOAD_MAX_MB } from "@/providers/utils/providerVideoDownload";
import { pollForCompletion } from "@/utils/async/pollForCompletion";
import { getOrFetchOpenRouterVideoModelCapabilities } from "@/utils/cache/openrouterVideoModelCache";
import { buildOpenRouterAttributionHeaders } from "@/utils/provider/openrouterAttribution";
import { readOpenRouterLimitError } from "@/providers/openrouter/openrouterLimit";
import { beginProviderRequest, type ProviderRequestHold } from "@/utils/provider/providerRequestHook";
import {
  buildOpenRouterVideoRequestBody,
  normalizeOpenRouterVideoOptions,
  resolveOpenRouterPollingUrl,
} from "@/providers/openrouter/openrouterVideoRequest";

// Bun's BoringSSL stack produces a non-standard TLS/HTTP fingerprint that Cloudflare
// identifies and serves cached HTML to, rather than routing to the API origin.
// Both fetch() and Bun's node:https shim share this same fingerprint.
// We bypass this by spawning an external process for HTTP requests:
//   - Windows: PowerShell 7 (pwsh) with Invoke-WebRequest: uses .NET's Schannel TLS
//     and proper HTTP/2 negotiation, confirmed to bypass Cloudflare.
//   - Linux/Docker: curl with HTTP/2 support (via nghttp2, standard on Alpine/Debian).
//     Linux curl produces a different TLS fingerprint than Bun and negotiates HTTP/2
//     correctly, which Cloudflare allows through.

/** Shape returned by the external HTTP helpers */
interface ExternalHttpResponse {
  status: number;
  headers: Record<string, string>;
  bodyBuffer: Buffer;
}

/** Whether the current platform is Windows (determines which HTTP backend to use) */
const IS_WINDOWS = process.platform === "win32";

interface ExternalRequestLimits {
  maxBodyBytes: number;
  abortSignal?: AbortSignal;
}

/** Submit and poll replies are small JSON documents; this only stops a broken or hostile stream. */
const MAX_API_RESPONSE_BYTES = 1024 * 1024;
const CURL_HEADER_ALLOWANCE_BYTES = 64 * 1024;
const MAX_HELPER_STDERR_BYTES = 64 * 1024;
// Both helpers time their own request out at 120 seconds. This covers a helper that hangs before
// or after its request, which those timeouts cannot see.
const EXTERNAL_REQUEST_DEADLINE_MS = 150_000;
const VIDEO_DOWNLOAD_TIMEOUT_MS = 120_000;

/**
 * Reads a helper's output with a byte cap and a deadline, killing the process on overflow, timeout
 * or cancellation so neither its pipe nor its upstream transfer keeps running.
 */
export async function readBoundedProcessOutput(
  proc: Subprocess<"pipe", "pipe", "pipe">,
  maxStdoutBytes: number,
  limits: ExternalRequestLimits,
): Promise<{ stdout: Buffer; stderr: string; exitCode: number }> {
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, EXTERNAL_REQUEST_DEADLINE_MS);
  const stop = () => proc.kill();
  limits.abortSignal?.addEventListener("abort", stop, { once: true });
  try {
    if (limits.abortSignal?.aborted) stop();
    const [stdout, stderr] = await Promise.all([
      readBoundedResponse(new Response(proc.stdout), maxStdoutBytes),
      readBoundedResponse(new Response(proc.stderr), MAX_HELPER_STDERR_BYTES),
    ]);
    const exitCode = await proc.exited;
    if (timedOut) throw new Error(`External HTTP helper exceeded ${EXTERNAL_REQUEST_DEADLINE_MS}ms`);
    return { stdout, stderr: stderr.toString("utf8"), exitCode };
  } catch (error) {
    proc.kill();
    throw error;
  } finally {
    clearTimeout(deadline);
    limits.abortSignal?.removeEventListener("abort", stop);
  }
}

/**
 * Inline pwsh script that reads a JSON request envelope from stdin and performs
 * the HTTP request using Invoke-WebRequest.
 *
 * Input (stdin JSON): { url, method, headers, body? }
 * Output (stdout JSON): { status, bodyBase64, location }
 *
 * The response body is base64-encoded so binary content (MP4 video) survives the text pipe.
 * -SkipHttpErrorCheck prevents throwing on non-2xx status codes (PowerShell 7+ feature).
 * Redirects are returned rather than followed, matching curl without `-L`, so the caller applies
 * its own destination policy to the Location.
 */
export const PWSH_HTTP_SCRIPT = `
$ErrorActionPreference = 'Stop'
$req = [Console]::In.ReadToEnd() | ConvertFrom-Json
$headers = @{}
foreach ($h in $req.headers.PSObject.Properties) {
  if ($h.Name -ne 'Content-Type') { $headers[$h.Name] = $h.Value }
}
$params = @{
  Uri = $req.url
  Method = $req.method
  Headers = $headers
  UseBasicParsing = $true
  SkipHttpErrorCheck = $true
  TimeoutSec = 120
  MaximumRedirection = 0
  # PowerShell 7 reports a 3xx past MaximumRedirection as an error even with SkipHttpErrorCheck, but
  # still returns the response when the error is not terminating. A missing response is a real failure.
  ErrorAction = 'SilentlyContinue'
  ErrorVariable = 'requestError'
}
if ($req.method -eq 'POST' -and $req.body) {
  $params.Body = $req.body
  $params.ContentType = 'application/json'
}
$resp = Invoke-WebRequest @params
if ($null -eq $resp) { throw $requestError[0] }
if ($resp.Content -is [byte[]]) {
  $bodyB64 = [Convert]::ToBase64String($resp.Content)
} else {
  $bodyB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([string]$resp.Content))
}
$out = @{ status = [int]$resp.StatusCode; bodyBase64 = $bodyB64; location = [string]$resp.Headers['Location'] }
[Console]::Out.Write(($out | ConvertTo-Json -Compress))
`;

/**
 * HTTP request via PowerShell 7's Invoke-WebRequest.
 * Used on Windows where system curl lacks HTTP/2 support.
 */
async function pwshHttpRequest(
  url: string,
  method: "GET" | "POST",
  headers: Record<string, string>,
  limits: ExternalRequestLimits,
  body?: string,
): Promise<ExternalHttpResponse> {
  const requestEnvelope = JSON.stringify({ url, method, headers, body });

  // Spawn pwsh with the inline HTTP script
  //    -NoProfile: skip user profile loading for faster startup
  //    -NonInteractive: no prompts: fail immediately on errors
  const proc = Bun.spawn(["pwsh", "-NoProfile", "-NonInteractive", "-Command", PWSH_HTTP_SCRIPT], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(requestEnvelope);
  proc.stdin.end();

  // The body arrives base64-encoded inside a JSON envelope, which is 4/3 of its size.
  const output = await readBoundedProcessOutput(proc, Math.ceil((limits.maxBodyBytes * 4) / 3) + 4096, limits);
  const rawOutput = output.stdout.toString("utf8");

  if (output.exitCode !== 0) {
    throw new Error(`pwsh HTTP request failed (exit ${output.exitCode}): ${output.stderr.slice(0, 500)}`);
  }

  let envelope: { status: number; bodyBase64: string; location?: string };
  try {
    envelope = JSON.parse(rawOutput) as typeof envelope;
  } catch {
    throw new Error(`pwsh HTTP response is not valid JSON: ${rawOutput.slice(0, 300)}`);
  }

  const bodyBuffer = Buffer.from(envelope.bodyBase64, "base64");

  return { status: envelope.status, headers: envelope.location ? { location: envelope.location } : {}, bodyBuffer };
}

/**
 * Quotes a value for a curl config file. Inside double quotes curl unescapes only backslash,
 * double quote, and the `t`, `n`, `r`, and `v` control escapes, so escaping exactly those keeps
 * any header or JSON body byte-exact.
 */
function quoteCurlConfigValue(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\t/g, "\\t")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\v/g, "\\v");
  return `"${escaped}"`;
}

/**
 * Builds the curl config read from stdin, so the bearer token and request body never appear in
 * the process table where other local users can read command-line arguments.
 */
export function buildCurlRequestConfig(headers: Record<string, string>, body?: string): string {
  const lines = Object.entries(headers).map(([key, value]) => `header = ${quoteCurlConfigValue(`${key}: ${value}`)}`);
  if (body !== undefined) {
    // `data-raw` keeps a body that starts with `@` from being read as a file name.
    lines.push(`data-raw = ${quoteCurlConfigValue(body)}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Used on Linux where curl has HTTP/2 support (via nghttp2) and produces a standard
 * TLS fingerprint that Cloudflare allows through.
 *
 * Key curl flags for correctness and security:
 *   --proto =https: restricts to HTTPS only (blocks file://, ftp://, gopher://, etc.)
 *   -K -: reads headers and body from stdin instead of argv
 *   -H "Expect:"; suppresses 100-Continue which breaks the -i header/body parser
 */
async function curlHttpRequest(
  url: string,
  method: "GET" | "POST",
  headers: Record<string, string>,
  limits: ExternalRequestLimits,
  body?: string,
): Promise<ExternalHttpResponse> {
  const args: string[] = [
    "-s",
    "-S",
    "--max-time",
    "120",
    "--max-filesize",
    String(limits.maxBodyBytes),
    "--proto",
    "=https",
    "-X",
    method,
    "-K",
    "-",
  ];

  // Suppress Expect: 100-continue because curl sends this for POST bodies over ~1KB,
  //    which inserts an intermediate "HTTP/1.1 100 Continue" block before the real response.
  //    Our -i parser splits on the first \r\n\r\n, so 100-Continue would break parsing.
  args.push("-H", "Expect:");
  args.push("-i");
  args.push(url);

  const proc = Bun.spawn(["curl", ...args], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(buildCurlRequestConfig(headers, body));
  proc.stdin.end();

  // `-i` writes the status line and headers ahead of the body on the same stream.
  const output = await readBoundedProcessOutput(proc, limits.maxBodyBytes + CURL_HEADER_ALLOWANCE_BYTES, limits);

  if (output.exitCode !== 0) {
    throw new Error(`curl exited with code ${output.exitCode}: ${output.stderr.slice(0, 500)}`);
  }

  const fullBuffer = output.stdout;
  const headerEndIndex = fullBuffer.indexOf("\r\n\r\n");

  if (headerEndIndex === -1) {
    throw new Error(`curl response missing header/body separator: ${fullBuffer.toString("utf8").slice(0, 200)}`);
  }

  const headerSection = fullBuffer.subarray(0, headerEndIndex).toString("utf8");
  const bodyBuffer = fullBuffer.subarray(headerEndIndex + 4);

  const headerLines = headerSection.split("\r\n");
  const statusMatch = headerLines[0]?.match(/HTTP\/[\d.]+ (\d+)/);
  const status = statusMatch ? Number.parseInt(statusMatch[1], 10) : 0;

  const responseHeaders: Record<string, string> = {};
  for (let i = 1; i < headerLines.length; i++) {
    const colonIdx = headerLines[i].indexOf(":");
    if (colonIdx > 0) {
      const key = headerLines[i].substring(0, colonIdx).trim().toLowerCase();
      const value = headerLines[i].substring(colonIdx + 1).trim();
      responseHeaders[key] = value;
    }
  }

  return { status, headers: responseHeaders, bodyBuffer };
}

/**
 * Makes an HTTP request via an external process to bypass Bun's TLS fingerprint.
 * Dispatches to the appropriate backend based on the current platform:
 *   - Windows: PowerShell 7 (pwsh) with Invoke-WebRequest
 *   - Linux/Docker: curl with HTTP/2 support
 *
 * @param url - The full URL to request (must be HTTPS)
 * @param limits - Body byte cap and optional cancellation applied to the helper process
 * @param body - Optional JSON body string for POST requests
 * @returns Object with HTTP status code, response headers, and raw body as a Buffer
 */
async function externalHttpRequest(
  url: string,
  method: "GET" | "POST",
  headers: Record<string, string>,
  limits: ExternalRequestLimits,
  body?: string,
): Promise<ExternalHttpResponse> {
  // Validate URL scheme: only HTTPS allowed to prevent protocol attacks
  if (!url.startsWith("https://")) {
    throw new Error(`externalHttpRequest: URL must use HTTPS, got: ${url.slice(0, 80)}`);
  }

  // Sanitize header values: strip CRLF to prevent header injection
  const sanitizedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    sanitizedHeaders[key] = value.replace(/[\r\n]/g, "");
  }

  try {
    limits.abortSignal?.throwIfAborted();
    return await (IS_WINDOWS
      ? pwshHttpRequest(url, method, sanitizedHeaders, limits, body)
      : curlHttpRequest(url, method, sanitizedHeaders, limits, body));
  } catch (error) {
    throw new Error(
      safeVideoErrorText(
        error instanceof Error ? error.message : "Video API transport failed",
        new Headers(sanitizedHeaders).get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "",
      ),
    );
  }
}

const OPENROUTER_ORIGIN = "https://openrouter.ai";

/** OpenRouter stable video generation endpoint */
const OPENROUTER_VIDEO_URL = `${OPENROUTER_ORIGIN}/api/v1/videos`;

function safeVideoErrorText(value: string, apiKey: string): string {
  return redactLogString(apiKey ? value.replaceAll(apiKey, "[REDACTED]") : value);
}

function videoApiErrorSummary(body: string, apiKey: string): string {
  try {
    const parsed = z
      .object({
        error: z.union([z.string(), z.object({ message: z.string() })]).optional(),
        message: z.string().optional(),
      })
      .parse(JSON.parse(body));
    return safeVideoErrorText(
      typeof parsed.error === "string"
        ? parsed.error
        : (parsed.error?.message ?? parsed.message ?? "Provider request failed"),
      apiKey,
    );
  } catch {
    return "Provider request failed";
  }
}

export async function fetchOpenRouterVideoApi(url: string, init: RequestInit): Promise<Response> {
  const target = new URL(url);
  if (
    target.origin !== OPENROUTER_ORIGIN ||
    target.username ||
    target.password ||
    (init.method !== "GET" && init.method !== "POST") ||
    (init.body != null && typeof init.body !== "string")
  )
    throw new Error("Invalid OpenRouter video API request");
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  try {
    const raw = await externalHttpRequest(
      url,
      init.method,
      headers,
      { maxBodyBytes: MAX_API_RESPONSE_BYTES, abortSignal: init.signal ?? undefined },
      init.body ?? undefined,
    );
    return new Response([204, 205, 304].includes(raw.status) ? null : new Uint8Array(raw.bodyBuffer), {
      status: raw.status,
      headers: raw.headers,
    });
  } catch (error) {
    throw new Error(
      safeVideoErrorText(
        error instanceof Error ? error.message : "Video API transport failed",
        new Headers(init.headers).get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "",
      ),
    );
  }
}

/** Polling interval for OpenRouter video jobs (30 seconds, per OpenRouter docs) */
const POLL_INTERVAL_MS = 30_000;

/** Maximum poll attempts before timeout (~10 minutes at 30s intervals) */
const MAX_POLL_ATTEMPTS = 20;

/** Shape of the OpenRouter video job creation response */
export const openRouterVideoJobSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/),
  polling_url: z.string().optional(),
  status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled", "expired"]),
  generation_id: z.string().nullish(),
  unsigned_urls: z.array(z.string()).optional(),
  error: z.string().nullish(),
  usage: z.object({ cost: z.number().finite().nonnegative().nullish(), is_byok: z.boolean().optional() }).nullish(),
});
type OpenRouterVideoSubmitResponse = z.infer<typeof openRouterVideoJobSchema>;

/** Shape of the OpenRouter video job poll response (confirmed via live API) */
type OpenRouterVideoPollResponse = z.infer<typeof openRouterVideoJobSchema>;

/**
 * Generate a video using OpenRouter's stable video generation API.
 *
 * Flow:
 *   1. POST to /api/v1/videos with model, prompt, and parameters
 *   2. Receive a job ID with "pending" status
 *   3. Poll every 30s via GET /api/v1/videos/:jobId until "completed" or "failed"
 *   4. Download the MP4 from the unsigned_urls or content endpoint
 *
 * Supported models are discovered from OpenRouter's dedicated video model catalog.
 *
 * @param request - Video generation request with apiKey, model, prompt, and optional parameters
 * @returns Raw MP4 video data as a Buffer, or null values on failure
 */
export async function generateOpenRouterNativeVideo(
  request: ProviderNativeVideoGenerationRequest,
): Promise<ProviderNativeVideoGenerationResult> {
  const capabilities = await getOrFetchOpenRouterVideoModelCapabilities(request.model);
  const options = normalizeOpenRouterVideoOptions(request, capabilities);
  request.abortSignal?.throwIfAborted();
  const hold = await beginProviderRequest({
    apiKey: request.apiKey,
    path: "/videos",
    body: buildOpenRouterVideoRequestBody(request, options, capabilities),
  });
  let completed = false;
  try {
    if (request.abortSignal?.aborted) {
      hold?.reportCost(0);
      request.abortSignal.throwIfAborted();
    }
    const result = await generateVideo(request, hold);
    completed = true;
    return result;
  } finally {
    hold?.release(completed);
  }
}

async function generateVideo(
  request: ProviderNativeVideoGenerationRequest,
  hold?: ProviderRequestHold,
): Promise<ProviderNativeVideoGenerationResult> {
  const modelCapabilities = await getOrFetchOpenRouterVideoModelCapabilities(request.model);
  const normalizedOptions = normalizeOpenRouterVideoOptions(request, modelCapabilities);
  request.abortSignal?.throwIfAborted();
  // `frame_images` preserves TomoriBot's image-to-video contract: the referenced image is
  // the exact first frame. `input_references` is intentionally not used because the stable
  // API defines it as loose subject/style guidance rather than frame control.
  const body = buildOpenRouterVideoRequestBody(request, normalizedOptions, modelCapabilities);

  log.info(
    `OpenRouter video generation: submitting request (model: ${request.model}, aspectRatio: ${normalizedOptions.aspectRatio}, durationSeconds: ${normalizedOptions.duration}, resolution: ${normalizedOptions.resolution}, hasReferenceImages: ${!!(request.referenceImages && request.referenceImages.length > 0)})`,
  );

  const apiHeaders = {
    Authorization: `Bearer ${request.apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...buildOpenRouterAttributionHeaders(),
  };
  const submitBodyJson = JSON.stringify(body);

  // Submit the generation request via external HTTP helper (bypasses Bun's TLS fingerprint issue)
  const send = fetchOpenRouterVideoApi;
  const submitResponse = await send(OPENROUTER_VIDEO_URL, {
    method: "POST",
    headers: apiHeaders,
    body: submitBodyJson,
    signal: request.abortSignal,
  });
  const submitRaw = {
    status: submitResponse.status,
    bodyBuffer: await readBoundedResponse(submitResponse, MAX_API_RESPONSE_BYTES),
  };

  const submitBodyText = submitRaw.bodyBuffer.toString("utf8");

  if (submitRaw.status < 200 || submitRaw.status >= 300) {
    hold?.reportCost(0);
    log.error(
      `OpenRouter video generation request failed (model: ${request.model}, status: ${submitRaw.status})`,
      new Error(videoApiErrorSummary(submitBodyText, request.apiKey)),
    );
    throw new Error(
      `OpenRouter video generation failed: ${submitRaw.status}: ${videoApiErrorSummary(submitBodyText, request.apiKey)}`,
      { cause: readOpenRouterLimitError(submitRaw.status, submitResponse.headers, submitBodyText) ?? undefined },
    );
  }

  let submitResult: OpenRouterVideoSubmitResponse;
  try {
    submitResult = openRouterVideoJobSchema.parse(JSON.parse(submitBodyText));
  } catch {
    log.error(
      `OpenRouter video generation: submit response is not JSON (status ${submitRaw.status})`,
      new Error("Invalid video submit response"),
    );
    throw new Error("OpenRouter video generation failed: invalid submit response");
  }

  const jobId = submitResult.id;
  hold?.reportCost(submitResult.usage?.cost);
  const rawPollingUrl = submitResult.polling_url;

  if (!jobId || !rawPollingUrl) {
    log.error(
      "OpenRouter video generation returned incomplete response",
      new Error("Missing video job ID or polling URL"),
    );
    throw new Error("OpenRouter video generation returned incomplete response (missing job ID or polling_url)");
  }

  const pollingUrl = resolveOpenRouterPollingUrl(rawPollingUrl);

  log.info(
    `OpenRouter video generation: job submitted, polling for completion (jobId: ${jobId}, pollingUrl: ${pollingUrl})`,
  );

  // Poll for completion using the polling_url returned by the submit response.
  //    The URL format is determined by OpenRouter and may differ from a simple ID-based path.
  const pollHeaders = {
    Authorization: `Bearer ${request.apiKey}`,
    Accept: "application/json",
    ...buildOpenRouterAttributionHeaders(),
  };

  const completedJob = await pollForCompletion<OpenRouterVideoPollResponse>({
    pollFn: async () => {
      const pollResponse = await send(pollingUrl, { method: "GET", headers: pollHeaders, signal: request.abortSignal });
      const pollRaw = {
        status: pollResponse.status,
        bodyBuffer: await readBoundedResponse(pollResponse, MAX_API_RESPONSE_BYTES),
      };
      const pollBodyText = pollRaw.bodyBuffer.toString("utf8");

      if (pollRaw.status < 200 || pollRaw.status >= 300) {
        // Short-circuit on permanent auth errors, so retrying won't help for 401/403
        // Note: 404 is NOT terminal here. OpenRouter's async job system may return 404 briefly
        // after submission due to eventual consistency because the job takes a few seconds to propagate.
        if (pollRaw.status === 401 || pollRaw.status === 403) {
          return {
            done: true,
            error: `OpenRouter video poll: terminal HTTP error (jobId: ${jobId}, status: ${pollRaw.status}): ${videoApiErrorSummary(pollBodyText, request.apiKey)}`,
          };
        }
        log.warn(
          `OpenRouter video poll request failed (jobId: ${jobId}, status: ${pollRaw.status}): ${videoApiErrorSummary(pollBodyText, request.apiKey)}`,
        );
        return { done: false };
      }

      let pollResult: OpenRouterVideoPollResponse;
      try {
        pollResult = openRouterVideoJobSchema.extend({ id: z.literal(jobId) }).parse(JSON.parse(pollBodyText));
      } catch {
        log.warn(`OpenRouter video poll: response is invalid (jobId: ${jobId}, status: ${pollRaw.status})`);
        return { done: false };
      }

      hold?.reportCost(pollResult.usage?.cost);
      switch (pollResult.status) {
        case "completed":
          return { done: true, result: pollResult };
        case "failed":
          return {
            done: true,
            error: `OpenRouter video generation failed: ${safeVideoErrorText(pollResult.error ?? "unknown error", request.apiKey)}`,
          };
        case "cancelled":
          return { done: true, error: "OpenRouter video generation was cancelled" };
        case "expired":
          return { done: true, error: "OpenRouter video generation expired" };
        default:
          return { done: false };
      }
    },
    intervalMs: POLL_INTERVAL_MS,
    maxAttempts: MAX_POLL_ATTEMPTS,
    logLabel: "OpenRouterVideoGeneration",
    abortSignal: request.abortSignal,
  });

  // Download the video
  //    Use unsigned_urls if available, otherwise use the content endpoint.
  //    The video file may not be immediately available after the poll returns "completed"
  //    due to eventual consistency in OpenRouter's storage, so retry a few times on 404.
  const usageReport = { costUsd: completedJob.usage?.cost ?? undefined, providerRequestId: jobId };
  hold?.reportCost(usageReport.costUsd);
  const rawVideoUrl = completedJob.unsigned_urls?.[0] ?? `${OPENROUTER_VIDEO_URL}/${jobId}/content?index=0`;
  const videoUrl = new URL(rawVideoUrl, OPENROUTER_ORIGIN).href;
  log.info(`OpenRouter video generation: downloading video (jobId: ${jobId}, url: ${videoUrl.slice(0, 80)})`);

  const maxDownloadAttempts = 4;
  const downloadRetryDelayMs = 5_000;

  let download = await downloadOpenRouterVideo(videoUrl, request.apiKey, request.abortSignal);
  for (let attempt = 2; attempt <= maxDownloadAttempts && download.status === 404; attempt++) {
    log.warn(
      `OpenRouter video download returned 404, retrying in ${downloadRetryDelayMs / 1000}s (jobId: ${jobId}, attempt: ${attempt}/${maxDownloadAttempts})`,
    );
    await new Promise((resolve) => setTimeout(resolve, downloadRetryDelayMs));
    download = await downloadOpenRouterVideo(videoUrl, request.apiKey, request.abortSignal);
  }

  if (!download.videoData) {
    log.error(`Failed to download OpenRouter video (jobId: ${jobId})`, new Error(download.reason));
    return { videoData: null, mimeType: null, ...usageReport };
  }

  const videoData = download.videoData;

  log.info(`OpenRouter video generation: download complete (jobId: ${jobId}, sizeBytes: ${videoData.length})`);

  return {
    videoData,
    mimeType: "video/mp4",
    durationSeconds: normalizedOptions.duration,
    ...usageReport,
  };
}

/**
 * Downloads a finished video. Only OpenRouter's own origin needs the external helper (for its
 * TLS fingerprint) and receives the API key. Any other host, including a redirect Location from
 * OpenRouter, goes through the bot's pinned downloader: anonymous, SSRF-gated per hop, byte
 * capped and deadline bound. A provider response can never route the key or the helper elsewhere.
 */
export async function downloadOpenRouterVideo(
  videoUrl: string,
  apiKey: string,
  abortSignal: AbortSignal | undefined,
): Promise<{ videoData: Buffer | null; status?: number; reason: string }> {
  const maxBodyBytes = PROVIDER_VIDEO_DOWNLOAD_MAX_MB * 1024 * 1024;
  let anonymousUrl = videoUrl;
  if (new URL(videoUrl).origin === OPENROUTER_ORIGIN) {
    const raw = await externalHttpRequest(
      videoUrl,
      "GET",
      { Authorization: `Bearer ${apiKey}`, ...buildOpenRouterAttributionHeaders() },
      { maxBodyBytes, abortSignal },
    );
    const location = raw.headers.location;
    if (raw.status < 300 || raw.status >= 400 || !location) {
      return raw.status >= 200 && raw.status < 300
        ? { videoData: raw.bodyBuffer, status: raw.status, reason: "" }
        : { videoData: null, status: raw.status, reason: `HTTP ${raw.status}` };
    }
    anonymousUrl = new URL(location, videoUrl).href;
  }
  const result = await safeDownload(anonymousUrl, {
    maxSizeMB: PROVIDER_VIDEO_DOWNLOAD_MAX_MB,
    timeoutMs: VIDEO_DOWNLOAD_TIMEOUT_MS,
    externalSignal: abortSignal,
  });
  if (result.success && result.buffer) return { videoData: result.buffer, status: 200, reason: "" };
  const status = /^HTTP (\d{3})\b/.exec(result.details ?? "")?.[1];
  return {
    videoData: null,
    status: status ? Number(status) : undefined,
    reason: result.details ?? result.error ?? "download failed",
  };
}
