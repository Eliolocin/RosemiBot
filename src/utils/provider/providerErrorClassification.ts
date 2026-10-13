import type { ProviderError } from "@/types/stream/interfaces";

const MODEL_ERROR_PATTERNS: RegExp[] = [
  /\bunsupported\s+model\b/i,
  /\b(?:invalid|unknown|unrecognized)\s+model\b/i,
  /\bmodel\s+[`"'A-Za-z0-9_.:/-]{1,160}\s+(?:is\s+)?(?:not\s+supported|unsupported|not\s+found|unavailable|invalid)\b/i,
  /\bmodel\s+(?:not\s+found|does\s+not\s+exist|is\s+not\s+available)\b/i,
  /\bno\s+such\s+model\b/i,
  /\bmodel_not_found\b/i,
  // A deprecated/retired model is a model-availability problem (e.g. OpenRouter 404
  // "Grok 4.1 Fast is deprecated"), so present it as a model error and steer the user to
  // pick a different model rather than showing the generic API-error copy.
  /\bdeprecated\b/i,
  // NVIDIA NIM answers a retired model with 410 "has reached its end of life" and a model the
  // account cannot reach with 404 "Function '<uuid>': Not found for account"; neither names the
  // model in a shape the patterns above match, so both fell through to API-key advice.
  /\breached\s+its\s+end\s+of\s+life\b/i,
  /\bnot\s+found\s+for\s+account\b/i,
];

export function isProviderModelError(error: ProviderError): boolean {
  if (error.type === "model_error") {
    return true;
  }

  return collectProviderErrorMessages(error).some(isProviderModelErrorMessage);
}

// A prompt whose input + reserved output exceeds the model's hard context window.
// Example (OpenRouter 400): "This endpoint's maximum context length is 16384 tokens.
// However, you requested about 22581 tokens ... use the context-compression plugin".
const CONTEXT_LENGTH_ERROR_PATTERNS: RegExp[] = [
  /\bmaximum\s+context\s+length\b/i,
  /\bcontext\s+length\s+(?:is|of|exceeded)\b/i,
  /\bcontext_length_exceeded\b/i,
  /\bcontext\s+window\s+(?:is\s+)?exceeded\b/i,
  /\breduce\s+the\s+length\s+of\b/i,
  /\btoo\s+much\s+context\b/i,
];

// The account cannot afford the request at the requested max_tokens: a credit
// ceiling, not a context-window ceiling. Example (OpenRouter 402): "This request
// requires more credits, or fewer max_tokens. You requested up to 16384 tokens,
// but can only afford 7783."
const CREDIT_AFFORDABILITY_ERROR_PATTERNS: RegExp[] = [
  /\brequires\s+more\s+credits\b/i,
  /\bcan\s+only\s+afford\b/i,
  /\bfewer\s+max_tokens\b/i,
  /\binsufficient\s+credits\b/i,
];

// The account has no spendable balance at all, so no request of any size can succeed.
// Separate from the affordability ceiling above, where a smaller max_tokens still fits the
// remaining credit. Matching these against the affordability patterns would hand the user a
// `reduce_output_tokens` tip that cannot possibly work.
const ACCOUNT_BALANCE_EXHAUSTED_PATTERNS: RegExp[] = [
  /\binsufficient\s+balance\b/i,
  /\bbalance\s+is\s+insufficient\b/i,
  /\bno\s+resource\s+package\b/i,
  /\bplease\s+recharge\b/i,
  /\binsufficient_user_quota\b/i,
  /\bexceeded\s+your\s+current\s+quota\b/i,
  /\bbilling\s+hard\s+limit\s+has\s+been\s+reached\b/i,
];

/**
 * Detects an exhausted account balance (the provider will reject every request until a
 * human adds funds). Distinct from a credit-affordability ceiling: trimming the request
 * cannot help, so the only useful advice is to top up or switch providers.
 * @param error - The normalized provider error.
 * @returns True when any collected message signals a zero or negative balance.
 */
export function isAccountBalanceExhaustedError(error: ProviderError): boolean {
  return collectProviderErrorMessages(error).some((message) =>
    matchesAnyPattern(message, ACCOUNT_BALANCE_EXHAUSTED_PATTERNS),
  );
}

/**
 * Detects NVIDIA NIM refusing the credential itself.
 *
 * NIM answers a mistyped key, an expired key, and a key without inference access with the same
 * `403 {"detail":"Authorization failed"}`, so expiry can only be offered as a possibility. Scoped
 * to NVIDIA because expiry is not a known cause of the same status on other providers.
 */
export function isNvidiaCredentialRejected(providerName: string, error: ProviderError): boolean {
  return providerName === "nvidia" && error.type === "api_error" && error.code === "403";
}

/**
 * Detects a hard context-window overflow (input + reserved output exceeds the
 * model's maximum context length). Distinct from a credit ceiling: here,
 * trimming the request (shorter message, less history, lower output tokens)
 * actually resolves it.
 * @param error - The normalized provider error.
 * @returns True when any collected message signals a context-length overflow.
 */
export function isContextLengthError(error: ProviderError): boolean {
  return collectProviderErrorMessages(error).some((message) =>
    matchesAnyPattern(message, CONTEXT_LENGTH_ERROR_PATTERNS),
  );
}

/**
 * Detects a credit-affordability ceiling (the account cannot pay for the
 * requested max_tokens). Distinct from a context overflow: adding history back
 * does not help, so the fix is more credits or fewer output tokens.
 * @param error - The normalized provider error.
 * @returns True when any collected message signals a credit-affordability limit.
 */
export function isCreditAffordabilityError(error: ProviderError): boolean {
  return collectProviderErrorMessages(error).some((message) =>
    matchesAnyPattern(message, CREDIT_AFFORDABILITY_ERROR_PATTERNS),
  );
}

// Adapters write `code` in their own vocabulary: HTTP statuses, Google status names, Anthropic error
// types, Vertex's own config codes, and the OpenAI-compatible composites. Each entry names a
// failure the server's own key, account, or endpoint causes, or one that clears on its own.
const NON_INCIDENT_PROVIDER_CODES = new Set([
  "401",
  "402",
  "403",
  "404",
  "429_balance",
  "429_plan_access",
  "ECONNREFUSED",
  "PERMISSION_DENIED",
  "UNAUTHENTICATED",
  "authentication_error",
  "billing_error",
  "permission_error",
  "not_found_error",
  // Anthropic's mid-stream SSE error event arrives as a non-retryable api_error whatever its cause.
  "rate_limit_error",
  // NovelAI's adapter already records this at error level with the raw tool-call block, which
  // cannot ride on the ProviderError because the embed would show it to the user as "Details".
  "tool_call_parse_error",
  "vertex_auth_error",
  "vertex_config_error",
]);

// Google answers a bad key and a billing problem with a plain 400, and some providers report a
// moderation refusal the same way, so these are only distinguishable by message. Bun's fetch words
// its connection failures without the errno text the adapters look for ("Unable to connect", "The
// socket connection was closed unexpectedly"), so those arrive as `unknown` and would file every
// message to a server's dead custom endpoint as an incident.
const NON_INCIDENT_MESSAGE_PATTERNS: RegExp[] = [
  /\bunable\s+to\s+connect\b/i,
  /\bconnection\s+refused\b/i,
  /\bsocket\s+connection\s+was\s+closed\s+unexpectedly\b/i,
  /\b(?:ENOTFOUND|ECONNRESET|EHOSTUNREACH|ENETUNREACH)\b/,
  /\bapi[\s_-]?key\s+(?:is\s+)?(?:not\s+valid|invalid|expired|revoked)\b/i,
  /\b(?:invalid|incorrect|expired)\s+api[\s_-]?key\b/i,
  /\bPERMISSION_DENIED\b/,
  /\bUNAUTHENTICATED\b/,
  /\bbilling\b/i,
  /\bfree\s+tier\b/i,
  /\bcontent[\s_-]?(?:filter|policy|management)\b/i,
  /\bmoderation\b/i,
  /\bflagged\b/i,
];

/**
 * Decides whether a provider failure belongs in `error_logs`, which production reads as the
 * operator's incident feed.
 *
 * Transient failures and anything the server can repair itself (its key, balance, model choice,
 * conversation length, or content) stay at warn level: on a public instance they arrive constantly
 * and only that server can act on them. What remains is mostly a request TomoriBot built wrong or a
 * failure no classifier recognized, and those need the raw provider text to diagnose.
 */
export function isOperatorActionableProviderError(error: ProviderError): boolean {
  if (error.retryable || (error.type !== "api_error" && error.type !== "unknown")) {
    return false;
  }
  if (error.code !== undefined && NON_INCIDENT_PROVIDER_CODES.has(String(error.code))) {
    return false;
  }
  if (
    isProviderModelError(error) ||
    isContextLengthError(error) ||
    isCreditAffordabilityError(error) ||
    isAccountBalanceExhaustedError(error)
  ) {
    return false;
  }
  return !collectProviderErrorMessages(error).some((message) =>
    matchesAnyPattern(message, NON_INCIDENT_MESSAGE_PATTERNS),
  );
}

/**
 * Detects a timeout from error text, for classifiers that have no status code to go on.
 *
 * Bun's fetch abandons a server that has sent nothing for 300 seconds with "The operation timed
 * out.", which has no "timeout" substring. A slow local backend processing a long prompt hits that
 * ceiling, and matching only "timeout" told the user to check their API key.
 */
export function isProviderTimeoutMessage(message: string): boolean {
  return /timeout|timed\s+out/i.test(message);
}

/**
 * Tests a message against a set of patterns after collapsing whitespace.
 * @param message - Candidate message (nullable).
 * @returns True when the normalized message matches any pattern.
 */
function matchesAnyPattern(message: string | null | undefined, patterns: RegExp[]): boolean {
  if (!message) {
    return false;
  }
  const normalized = message.replace(/\s+/g, " ").trim();
  return patterns.some((pattern) => pattern.test(normalized));
}

export function isProviderModelErrorMessage(message: string | null | undefined): boolean {
  if (!message) {
    return false;
  }

  const normalized = message.replace(/\s+/g, " ").trim();
  return MODEL_ERROR_PATTERNS.some((pattern) => pattern.test(normalized));
}

const DISPLAYABLE_ERROR_CODE_PATTERNS = [/^\d{3}(?:_[a-z]+)*$/, /^[A-Z]+(?:_[A-Z]+)*$/, /^[a-z]+(?:_[a-z]+)*$/];

/**
 * Error codes can come from a response body, so a hostile endpoint can return its received bearer
 * value as the code. Only HTTP statuses (including re-coded ones such as `429_balance`) and
 * single-case enum words are shown, which excludes the digits and mixed case keys carry.
 */
export function formatProviderErrorCodeForDisplay(code: string | number | null | undefined): string {
  const value = code === null || code === undefined ? "" : String(code);
  return value.length <= 40 && DISPLAYABLE_ERROR_CODE_PATTERNS.some((pattern) => pattern.test(value))
    ? value
    : "unknown";
}

/**
 * Raw upstream text for restricted operator logs. Endpoints can echo request headers here, so it
 * never belongs in a channel, an interaction reply, or model context.
 */
export function getProviderErrorDetail(error: ProviderError): string | null {
  const messages = collectProviderErrorMessages(error);
  return messages.find((message) => message.trim().length > 0) ?? null;
}

function collectProviderErrorMessages(error: ProviderError): string[] {
  // The raw provider message and original payload come first because they name the actual cause
  // (e.g. "Unsupported model X. Supported IDs: ...") for the operator reading the log.
  const messages: string[] = [];
  appendMessage(messages, error.message);
  appendMessage(messages, extractUnknownErrorMessage(error.originalError));
  appendMessage(messages, error.userMessage);
  return Array.from(new Set(messages));
}

function extractUnknownErrorMessage(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value !== "object") {
    return String(value);
  }

  const record = value as Record<string, unknown>;
  const directMessage = getString(record.message) ?? getString(record.detail);
  if (directMessage) {
    return directMessage;
  }

  const nestedError = record.error;
  if (nestedError && typeof nestedError === "object") {
    const nestedRecord = nestedError as Record<string, unknown>;
    const nestedMessage = getString(nestedRecord.message) ?? getString(nestedRecord.detail);
    if (nestedMessage) {
      return nestedMessage;
    }
  }

  const body = getString(record.body);
  if (body) {
    return extractJsonMessage(body) ?? body;
  }

  return null;
}

function extractJsonMessage(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const nestedError =
      parsed.error && typeof parsed.error === "object" ? (parsed.error as Record<string, unknown>) : parsed;
    return (
      getString(nestedError.message) ??
      getString(nestedError.detail) ??
      getString(parsed.message) ??
      getString(parsed.detail)
    );
  } catch {
    return null;
  }
}

function appendMessage(messages: string[], value: string | null | undefined): void {
  if (value?.trim()) {
    messages.push(value.trim());
  }
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
