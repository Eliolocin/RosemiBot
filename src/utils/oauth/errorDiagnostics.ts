const EXCEPTION_CLASSES = [
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "PostgresError",
  "AbortError",
  "TimeoutError",
] as const;

export interface OAuthFailureDiagnostics {
  exceptionClass: (typeof EXCEPTION_CLASSES)[number] | "unknown";
  sqlState?: string;
}

export function oauthFailureDiagnostics(error: unknown): OAuthFailureDiagnostics {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return {
    exceptionClass:
      error instanceof Error ? (EXCEPTION_CLASSES.find((name) => name === error.name) ?? "unknown") : "unknown",
    ...(typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? { sqlState: code } : {}),
  };
}
