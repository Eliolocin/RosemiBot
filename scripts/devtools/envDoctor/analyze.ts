import { parseExampleFile } from "./declarations";
import { scanCompose, scanTerraform, scanWorkflow } from "./manifestScan";
import {
  KNOWN_NOTES,
  LIBRARY_CONSUMERS,
  REDACTED,
  REGISTERED_DYNAMIC_READS,
  RELEASE_ONLY_CONSUMERS,
  classifyConsumed,
  isPlatformName,
  isSecretName,
  roleForPath,
} from "./policy";
import { scanPython } from "./pythonScan";
import { scanDockerfile, scanPowerShell, scanShell } from "./shellScan";
import { emptyScanResult } from "./textUtils";
import { scanTypeScript } from "./typescriptScan";
import type {
  Classification,
  ConflictingDefault,
  ConsumerSite,
  DefaultSite,
  DynamicPatternSite,
  EnvDoctorInput,
  EnvDoctorReport,
  Location,
  ScanLanguage,
  ScanResult,
  SourceFile,
  VariableReport,
} from "./types";

export type FileKind = ScanLanguage | "required-example" | "optional-example" | "docs";

/** Routes a repository path to the scanner that understands it, or null to skip it. */
export function fileKindFor(path: string): FileKind | null {
  const normalized = path.replaceAll("\\", "/");
  const base = normalized.split("/").at(-1) ?? normalized;
  if (base === ".env.example") return "required-example";
  if (base === ".env.optional.example") return "optional-example";
  if (/\.(ts|tsx|js|mjs|cjs)$/.test(base) && !base.endsWith(".d.ts")) return "typescript";
  if (base.endsWith(".py")) return "python";
  if (base.endsWith(".sh")) return "shell";
  if (/\.ps[md]?1$/.test(base)) return "powershell";
  if (base === "Dockerfile" || base.endsWith(".Dockerfile") || base.startsWith("Dockerfile.")) return "dockerfile";
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(normalized)) return "workflow";
  if (/^(docker-)?compose[^/]*\.ya?ml$/.test(base) || /^deploy\/.+\.ya?ml$/.test(normalized)) return "compose";
  if (base.endsWith(".tf")) return "terraform";
  if (/\.mdx?$/.test(base) && !/^docs\/(?!en\/)[^/]+\//.test(normalized)) return "docs";
  return null;
}

function mergeInto(target: ScanResult, source: ScanResult): void {
  target.consumers.push(...source.consumers);
  target.declarations.push(...source.declarations);
  target.dynamicPatterns.push(...source.dynamicPatterns);
  target.unresolved.push(...source.unresolved);
  target.aliases.push(...source.aliases);
  target.parseFailures.push(...source.parseFailures);
}

const LIVE_ROLES = new Set(["runtime", "tooling", "infra"]);
const BOOLEAN_WORDS: Record<string, string> = {
  true: "true",
  yes: "true",
  on: "true",
  "1": "true",
  false: "false",
  no: "false",
  off: "false",
  "0": "false",
};

function isLive(site: { role: string }): boolean {
  return LIVE_ROLES.has(site.role);
}

function isReleasePath(path: string): boolean {
  return path.startsWith("deploy/") || path.startsWith("terraform/");
}

/**
 * For comparison only; reports always show the value as written. When every
 * value for one variable is boolean-like, `1` and `0` compare as `true` and `false`, since the
 * Python servers spell a flag default as `"0"` where the example file writes `false`.
 */
function normalizeDefaults(values: string[]): string[] {
  const cleaned = values.map((value) => value.trim().replace(/^["']|["']$/g, ""));
  const allBoolean = cleaned.every((value) => value.toLowerCase() in BOOLEAN_WORDS);
  return cleaned.map((value) => {
    const lower = value.toLowerCase();
    if (allBoolean) return BOOLEAN_WORDS[lower];
    if (lower === "true" || lower === "false") return lower;
    if (["unset", "none", "null", "undefined"].includes(lower)) return "";
    const numeric = value.replaceAll("_", "");
    if (/^-?\d+(\.\d+)?(e\d+)?$/i.test(numeric)) return String(Number(numeric));
    return value;
  });
}

function matchDynamicPattern(name: string, patterns: DynamicPatternSite[]): DynamicPatternSite | undefined {
  let best: DynamicPatternSite | undefined;
  for (const pattern of patterns) {
    const fits =
      name.length > pattern.prefix.length + pattern.suffix.length &&
      name.startsWith(pattern.prefix) &&
      name.endsWith(pattern.suffix);
    if (fits && (!best || pattern.prefix.length + pattern.suffix.length > best.prefix.length + best.suffix.length)) {
      best = pattern;
    }
  }
  return best;
}

/** Runs every scanner over the input files. Exported so tests can inspect raw sites. */
export function scanAll(files: SourceFile[]): {
  scan: ScanResult;
  docs: Map<string, Set<string>>;
  counts: Record<string, number>;
} {
  const scan = emptyScanResult();
  const docs = new Map<string, Set<string>>();
  const counts: Record<string, number> = {};
  const typescriptFiles: SourceFile[] = [];
  for (const file of files) {
    const kind = fileKindFor(file.path);
    if (!kind) continue;
    counts[kind] = (counts[kind] ?? 0) + 1;
    switch (kind) {
      case "required-example":
      case "optional-example":
        scan.declarations.push(...parseExampleFile(file.path, file.text, kind));
        break;
      case "typescript":
        typescriptFiles.push(file);
        break;
      case "python":
        mergeInto(scan, scanPython(file));
        break;
      case "shell":
        mergeInto(scan, scanShell(file));
        break;
      case "powershell":
        mergeInto(scan, scanPowerShell(file));
        break;
      case "dockerfile":
        mergeInto(scan, scanDockerfile(file));
        break;
      case "compose":
        mergeInto(scan, scanCompose(file));
        break;
      case "workflow":
        mergeInto(scan, scanWorkflow(file));
        break;
      case "terraform":
        mergeInto(scan, scanTerraform(file));
        break;
      case "docs":
        docs.set(file.path, new Set(file.text.match(/(?<![A-Za-z0-9_])[A-Z][A-Z0-9_]{2,}(?![A-Za-z0-9_])/g) ?? []));
        break;
    }
  }
  mergeInto(scan, scanTypeScript(typescriptFiles));
  return { scan, docs, counts };
}

/**
 * Builds the inventory and diagnostics. The report is conservative about removal: a variable is
 * `dead` only when no live file reads it by any recognized route, no literal mentions it, every
 * consumer surface was scanned, and no unexplained dynamic read could produce its name.
 */
export function analyze(input: EnvDoctorInput): EnvDoctorReport {
  const { scan, docs, counts } = scanAll(input.files);

  const unresolvedReads = scan.unresolved.map((site) => {
    const registered = REGISTERED_DYNAMIC_READS.find((entry) => entry.file === site.file);
    return registered ? { ...site, registeredReason: registered.reason } : site;
  });
  const shortPatterns = scan.dynamicPatterns.filter((pattern) => pattern.prefix.length < 3);
  for (const pattern of shortPatterns) {
    unresolvedReads.push({
      file: pattern.file,
      line: pattern.line,
      ...(pattern.origin ? { origin: pattern.origin } : {}),
      language: pattern.language,
      role: pattern.role,
      expression: `template name with prefix "${pattern.prefix}"`,
    });
  }
  const patterns = scan.dynamicPatterns.filter((pattern) => pattern.prefix.length >= 3);
  const blockingUnresolved = unresolvedReads.filter((site) => isLive(site) && !site.registeredReason);
  const liveParseFailures = scan.parseFailures.filter((site) => isLive({ role: roleForPath(site.file, "typescript") }));
  const releaseAvailable = input.releaseSource !== null;

  const universe = new Set<string>();
  let platformNamesIgnored = 0;
  const platformSeen = new Set<string>();
  const admit = (name: string): void => {
    if (isPlatformName(name)) {
      if (!platformSeen.has(name)) {
        platformSeen.add(name);
        platformNamesIgnored++;
      }
      return;
    }
    universe.add(name);
  };
  // Workflow and Terraform entries only enrich names found elsewhere: a workflow step variable is
  // not operator configuration, and a Terraform env entry cannot be attributed to the bot's
  // container rather than a sibling container, so neither may create a dead candidate on its own.
  for (const declaration of scan.declarations) {
    if (declaration.layer !== "workflow-env" && declaration.layer !== "terraform-env") admit(declaration.name);
  }
  for (const consumer of scan.consumers) {
    if (consumer.kind !== "literal-reference" && isLive(consumer) && consumer.language !== "workflow")
      admit(consumer.name);
  }

  const consumersByName = groupBy(scan.consumers, (site) => site.name);
  const declarationsByName = groupBy(scan.declarations, (site) => site.name);

  const variables: VariableReport[] = [...universe].sort().map((name) => {
    const declarations = declarationsByName.get(name) ?? [];
    const consumers = (consumersByName.get(name) ?? []).sort(bySite);
    const pattern = consumers.some((site) => site.kind !== "literal-reference")
      ? undefined
      : matchDynamicPattern(name, patterns);
    const dynamicMatches = pattern ? [pattern] : [];
    const optional = declarations.find((site) => site.layer === "optional-example");

    const documentedDefaults: DefaultSite[] = [];
    if (optional?.value) {
      documentedDefaults.push({
        file: optional.file,
        line: optional.line,
        value: optional.value,
        source: "example-value",
      });
    }
    if (optional?.commentDefault !== undefined) {
      documentedDefaults.push({
        file: optional.file,
        line: optional.line,
        value: optional.commentDefault,
        source: "example-comment",
      });
    }
    const codeFallbacks: DefaultSite[] = [];
    const unrecoverableFallbacks: VariableReport["unrecoverableFallbacks"] = [];
    for (const site of consumers) {
      if (!isLive(site) || !site.fallback) continue;
      if ("value" in site.fallback) {
        // An empty fallback (`?? ""`, `${X:-}`, Python None) only means "treat unset as empty";
        // the real default is applied later, so it is not a competing value.
        if (site.fallback.value === "") continue;
        codeFallbacks.push({
          file: site.file,
          line: site.line,
          ...(site.origin ? { origin: site.origin } : {}),
          value: site.fallback.value,
          source: "code",
        });
      } else {
        unrecoverableFallbacks.push({ file: site.file, line: site.line, expression: site.fallback.unrecoverable });
      }
    }

    const aliasGroups = dedupeGroups([
      ...scan.aliases.filter((alias) => alias.names.includes(name)).map((alias) => alias.names),
      ...interpolationRenames(scan, name),
    ]);
    const docsMentions = [...docs]
      .filter(([, tokens]) => tokens.has(name))
      .map(([path]) => path)
      .sort();
    const releaseException = !releaseAvailable ? RELEASE_ONLY_CONSUMERS[name] : undefined;
    const exception = LIBRARY_CONSUMERS[name] ?? releaseException;

    const classification = classify({
      name,
      consumers,
      dynamicMatches,
      optional,
      exception,
      releaseAvailable,
      blockingUnresolved: blockingUnresolved.length,
      liveParseFailures: liveParseFailures.length,
    });
    if (KNOWN_NOTES[name]) classification.reasons.push(KNOWN_NOTES[name]);

    return {
      name,
      secret: isSecretName(name),
      declarations,
      consumers,
      dynamicMatches,
      documentedDefaults,
      codeFallbacks,
      unrecoverableFallbacks,
      aliasGroups,
      docsMentions,
      ...(exception ? { exception } : {}),
      classification,
    };
  });

  const byName = new Map(variables.map((variable) => [variable.name, variable]));
  const isDocumented = (variable: VariableReport) =>
    variable.declarations.some((site) => site.layer === "required-example" || site.layer === "optional-example");
  const hasRead = (variable: VariableReport) =>
    variable.consumers.some((site) => site.role !== "inactive" && site.kind !== "literal-reference") ||
    variable.dynamicMatches.length > 0;

  const declaredUnread = variables
    .filter((variable) =>
      variable.declarations.some((site) => site.layer !== "workflow-env" && site.layer !== "terraform-env"),
    )
    .filter((variable) => !hasRead(variable) && !variable.exception)
    .map((variable) => variable.name);

  const readUndocumented = variables
    .filter((variable) => !isDocumented(variable))
    .filter((variable) =>
      variable.consumers.some(
        (site) => isLive(site) && site.kind !== "literal-reference" && site.kind !== "external-image",
      ),
    )
    .map((variable) => variable.name);

  const conflictingDefaults: ConflictingDefault[] = [];
  for (const variable of variables) {
    const sites = [...variable.documentedDefaults, ...variable.codeFallbacks];
    if (sites.length < 2) continue;
    const normalized = normalizeDefaults(sites.map((site) => site.value));
    const groups = new Map<string, DefaultSite[]>();
    sites.forEach((site, index) => {
      const key = normalized[index];
      groups.set(key, [...(groups.get(key) ?? []), site]);
    });
    if (groups.size > 1) {
      conflictingDefaults.push({
        name: variable.name,
        values: [...groups.values()].map((group) => ({ value: group[0].value, sites: group })),
      });
    }
  }

  const aliasIndex = new Map<string, { names: string[]; sites: Location[] }>();
  for (const alias of scan.aliases) {
    const names = alias.names.filter((name) => byName.has(name));
    if (names.length < 2 || !isLive({ role: roleForPath(alias.file, alias.language) })) continue;
    const key = [...names].sort().join(" + ");
    const entry = aliasIndex.get(key) ?? { names, sites: [] };
    entry.sites.push({ file: alias.file, line: alias.line, ...(alias.origin ? { origin: alias.origin } : {}) });
    aliasIndex.set(key, entry);
  }
  for (const declaration of scan.declarations) {
    for (const source of declaration.interpolates ?? []) {
      if (source === declaration.name || !byName.has(source) || !byName.has(declaration.name)) continue;
      const key = [declaration.name, source].sort().join(" + ");
      const entry = aliasIndex.get(key) ?? { names: [declaration.name, source], sites: [] };
      entry.sites.push({
        file: declaration.file,
        line: declaration.line,
        ...(declaration.origin ? { origin: declaration.origin } : {}),
      });
      aliasIndex.set(key, entry);
    }
  }

  const liveEnvUnconsumed = (input.liveEnvKeys ?? []).filter((name) => {
    if (isPlatformName(name)) return false;
    const variable = byName.get(name);
    return !variable || (!hasRead(variable) && !variable.exception);
  });

  return {
    scanned: counts,
    releaseSource: input.releaseSource,
    platformNamesIgnored,
    variables: variables.map(redactVariable),
    diagnostics: {
      declaredUnread,
      readUndocumented,
      conflictingDefaults: conflictingDefaults.map(redactConflict),
      aliasGroups: [...aliasIndex.values()].sort((a, b) => a.names[0].localeCompare(b.names[0])),
      liveEnvUnconsumed,
      liveEnvStatus: input.liveEnvStatus,
      unresolvedReads: unresolvedReads.filter(isLive),
      parseFailures: liveParseFailures,
      unavailable: input.unavailable,
      exceptionDrift: releaseAvailable ? exceptionDrift(variables) : [],
    },
  };
}

/**
 * Replaces every value of a secret-named variable. Runs after conflict detection, which needs the
 * real values, so no rendering path ever receives one; that includes tracked placeholders and
 * Compose fallbacks, which a reader could otherwise mistake for a usable credential.
 */
function redactVariable(variable: VariableReport): VariableReport {
  if (!variable.secret) return variable;
  const hideFallback = <T extends { fallback?: ConsumerSite["fallback"] }>(site: T): T =>
    site.fallback
      ? { ...site, fallback: "value" in site.fallback ? { value: REDACTED } : { unrecoverable: REDACTED } }
      : site;
  return {
    ...variable,
    declarations: variable.declarations.map((site) => ({
      ...site,
      ...(site.value !== undefined ? { value: REDACTED } : {}),
      ...(site.commentDefault !== undefined ? { commentDefault: REDACTED } : {}),
    })),
    consumers: variable.consumers.map(hideFallback),
    documentedDefaults: variable.documentedDefaults.map((site) => ({ ...site, value: REDACTED })),
    codeFallbacks: variable.codeFallbacks.map((site) => ({ ...site, value: REDACTED })),
    unrecoverableFallbacks: variable.unrecoverableFallbacks.map((site) => ({ ...site, expression: REDACTED })),
  };
}

function redactConflict(conflict: ConflictingDefault): ConflictingDefault {
  if (!isSecretName(conflict.name)) return conflict;
  return {
    ...conflict,
    values: conflict.values.map((entry, index) => ({
      value: `${REDACTED} #${index + 1}`,
      sites: entry.sites.map((site) => ({ ...site, value: REDACTED })),
    })),
  };
}

interface ClassifyInput {
  name: string;
  consumers: ConsumerSite[];
  dynamicMatches: DynamicPatternSite[];
  optional: VariableReport["declarations"][number] | undefined;
  exception: string | undefined;
  releaseAvailable: boolean;
  blockingUnresolved: number;
  liveParseFailures: number;
}

function classify(input: ClassifyInput): Classification {
  const live = input.consumers.filter((site) => isLive(site) && site.kind !== "literal-reference");
  const liveLiterals = input.consumers.filter((site) => isLive(site) && site.kind === "literal-reference");
  const testReads = input.consumers.filter((site) => site.role === "test" && site.kind !== "literal-reference");
  const inactive = input.consumers.filter((site) => site.role === "inactive" && site.kind !== "literal-reference");

  if (live.length > 0 || input.dynamicMatches.length > 0) {
    if (live.length > 0 && live.every((site) => site.kind === "external-image")) {
      return {
        candidate: "deployment",
        confidence: "high",
        reasons: [
          `consumed by a third-party container (${[...new Set(live.map((site) => site.helper))].join(", ")}), not by the bot`,
        ],
      };
    }
    const classification = classifyConsumed(input.name, new Set(live.map((site) => site.language)), input.optional);
    if (live.length === 0) {
      const pattern = input.dynamicMatches[0];
      classification.reasons.push(
        `read only through the dynamic name ${pattern.prefix}*${pattern.suffix} at ${pattern.file}:${pattern.line}`,
      );
      classification.confidence = "low";
    }
    return classification;
  }
  if (testReads.length > 0) {
    const classification = classifyConsumed(
      input.name,
      new Set(testReads.map((site) => site.language)),
      input.optional,
    );
    classification.confidence = "low";
    classification.reasons.push(
      `read only by tests (${testReads
        .slice(0, 2)
        .map((site) => `${site.file}:${site.line}`)
        .join(
          ", ",
        )}); keep it if it configures the test harness, retire it if the test only exercises removed behavior`,
    );
    return classification;
  }
  if (input.exception) {
    const classification = classifyConsumed(input.name, new Set(), input.optional);
    classification.reasons.push(input.exception);
    if (classification.confidence === "high") classification.confidence = "medium";
    return classification;
  }
  if (liveLiterals.length > 0) {
    return {
      candidate: "undecided",
      confidence: "low",
      reasons: [
        `appears only as a string literal (${liveLiterals
          .slice(0, 3)
          .map((site) => `${site.file}:${site.line}`)
          .join(", ")}); confirm whether that string reaches an environment read`,
      ],
    };
  }

  const uncertainty: string[] = [];
  if (!input.releaseAvailable) uncertainty.push("release-only deployment files were unavailable");
  if (input.blockingUnresolved > 0) {
    uncertainty.push(
      `${input.blockingUnresolved} unregistered dynamic read(s) could produce this name (see Uncertainty)`,
    );
  }
  if (input.liveParseFailures > 0) uncertainty.push(`${input.liveParseFailures} file(s) failed to parse cleanly`);
  const testNote =
    inactive.length > 0
      ? [
          `read only by archived code (${inactive
            .map((site) => `${site.file}:${site.line}`)
            .slice(0, 3)
            .join(", ")})`,
        ]
      : [];
  if (uncertainty.length > 0) {
    return {
      candidate: "undecided",
      confidence: "low",
      reasons: ["no live consumer found", ...uncertainty, ...testNote],
    };
  }
  return {
    candidate: "dead",
    confidence: "high",
    reasons: ["no runtime, tooling, or deployment file reads it by any recognized route", ...testNote],
  };
}

/** Compose `environment:` entries that rename a host variable, such as `A: ${B:-x}`. */
function interpolationRenames(scan: ScanResult, name: string): string[][] {
  return scan.declarations
    .filter(
      (site) =>
        site.interpolates?.some((source) => source !== site.name) &&
        (site.name === name || site.interpolates?.includes(name)),
    )
    .map((site) => [site.name, ...(site.interpolates ?? []).filter((source) => source !== site.name)]);
}

/**
 * Compares {@link RELEASE_ONLY_CONSUMERS} against what the release files actually read, so the
 * fallback list used by clones without a release ref cannot silently rot.
 */
function exceptionDrift(variables: VariableReport[]): string[] {
  const drift: string[] = [];
  const byName = new Map(variables.map((variable) => [variable.name, variable]));
  for (const name of Object.keys(RELEASE_ONLY_CONSUMERS)) {
    const variable = byName.get(name);
    const readByRelease =
      variable?.consumers.some((site) => isReleasePath(site.file)) ||
      variable?.declarations.some((site) => isReleasePath(site.file));
    if (!readByRelease) drift.push(`${name} is listed in RELEASE_ONLY_CONSUMERS but no release file reads it`);
  }
  for (const variable of variables) {
    if (variable.name in RELEASE_ONLY_CONSUMERS) continue;
    const live = variable.consumers.filter((site) => isLive(site) && site.kind !== "literal-reference");
    const documented = variable.declarations.some(
      (site) => site.layer === "optional-example" || site.layer === "required-example",
    );
    if (documented && live.length > 0 && live.every((site) => isReleasePath(site.file))) {
      drift.push(`${variable.name} is read only by release files but is missing from RELEASE_ONLY_CONSUMERS`);
    }
  }
  return drift;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    const bucket = map.get(value);
    if (bucket) bucket.push(item);
    else map.set(value, [item]);
  }
  return map;
}

function dedupeGroups(groups: string[][]): string[][] {
  const seen = new Map<string, string[]>();
  for (const group of groups) {
    const unique = [...new Set(group)];
    seen.set([...unique].sort().join("|"), unique);
  }
  return [...seen.values()];
}

function bySite(a: Location, b: Location): number {
  return a.file.localeCompare(b.file) || a.line - b.line;
}
