import { config as loadDotEnv } from "dotenv";
import { parseSupporterBillingConfigJson, type SupporterBillingConfig } from "@/modules/supporter-billing";

export interface ParsedArgs {
  flags: Set<string>;
  values: Map<string, string>;
}

loadDotEnv({ quiet: true });

export function parseArgs(argv: readonly string[] = process.argv.slice(2)): ParsedArgs {
  const flags = new Set<string>();
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const nextArg = argv[index + 1];
    if (nextArg && !nextArg.startsWith("--")) {
      values.set(key, nextArg);
      index += 1;
    } else {
      flags.add(key);
    }
  }

  return { flags, values };
}

export function getOptionalString(args: ParsedArgs, key: string): string | null {
  const value = args.values.get(key)?.trim();
  return value ? value : null;
}

export function getOptionalNumber(args: ParsedArgs, key: string): number | null {
  const value = getOptionalString(args, key);
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`--${key} must be an integer`);
  }

  return parsed;
}

export function requireSupporterConfig(options: { validateSecrets?: boolean } = {}): SupporterBillingConfig {
  return parseSupporterBillingConfigJson(process.env.TOMORI_SUPPORTER_CONFIG_JSON, {
    env: process.env,
    validateReferencedSecrets: options.validateSecrets ?? true,
  });
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function requireIdentifier(args: ParsedArgs, keys: readonly string[]): void {
  if (keys.some((key) => getOptionalString(args, key) !== null)) {
    return;
  }

  throw new Error(`One of ${keys.map((key) => `--${key}`).join(", ")} is required`);
}
