import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import * as ts from "typescript";
import { auditDocProse, DOC_PROSE_DEFAULT_PATHS, DOC_PROSE_RULES_PATH } from "./lib/docProse";
import { isVerboseOutput } from "./lib/gateOutput";

const DEFAULT_PATHS = ["src", "scripts", "tests", "apps", "docs"];
const DEFAULT_EXCEPTIONS_PATH = "scripts/checks/comment-policy-exceptions.json";
const POLICY_DOC_PATH = "docs/en/contributing/policies/comments.md";
const DASH_PATTERN = /—|–| -- /;
const DASH_SCAN_PATTERN = /—|–| -- /g;
const LOCALE_PATH_PATTERN = /(?:^|\/)src\/locales\//;
const NUMBERED_PREFIX_PATTERNS = [
  String.raw`\d+[a-z]?(?:\.\d+[a-z]?)*(?:-\d+[a-z]?)*\.`,
  String.raw`\d+\.\d+[a-z]?`,
  String.raw`\d+[a-z]?(?:\.\d+[a-z]?)*(?:-\d+[a-z]?)*\)`,
];
const NUMBERED_LINE_PATTERN = new RegExp(String.raw`^//\s*(?:${NUMBERED_PREFIX_PATTERNS.join("|")})\s+(?=[A-Z])`);
const RULE_HEAD_PATTERN = /^(?:\/\/|\*)\s*Rule\s*#?\d+(?:\s*(?:,|&|and)\s*#?\d+)*\s*[:,]?/;
const ACTION_HEADS = [
  "Get",
  "Set",
  "Check",
  "Return",
  "Create",
  "Delete",
  "Update",
  "Load",
  "Fetch",
  "Build",
  "Initialize",
  "Validate",
  "Parse",
  "Call",
  "Send",
  "Add",
  "Remove",
  "Convert",
  "Apply",
  "Start",
  "Stop",
  "Handle",
  "Process",
  "Try",
  "Query",
  "Fallback",
  "Exercise",
];
const ACTION_HEAD_PATTERN = new RegExp(String.raw`^//\s*(?:${ACTION_HEADS.join("|")})\b`);
const REASON_SIGNALS = [
  "because",
  "cannot",
  "compatibility",
  "fallback",
  "invariant",
  "must",
  "otherwise",
  "prevents?",
  "so",
  "unless",
  "until",
  "without",
  "workaround",
];
// A summary that says when, after, or before something happens is describing behavior the
// body already shows, so these only exempt a line comment, never a docblock's echoed summary.
const CONDITION_SIGNALS = ["after", "before", "only", "requires?", "when"];
const RATIONALE_PATTERN = new RegExp(
  String.raw`\b(?:${[...REASON_SIGNALS, ...CONDITION_SIGNALS].join("|")})\b|[:(]`,
  "i",
);
// Units are contract information a caller cannot infer from a name or type.
const UNIT_SIGNALS = ["bytes", "characters", "days", "hours", "milliseconds", "minutes", "seconds"];
const REASON_PATTERN = new RegExp(String.raw`\b(?:${[...REASON_SIGNALS, ...UNIT_SIGNALS].join("|")})\b|[:(]`, "i");
// Identifiers abbreviate what prose spells out, so both sides collapse to the long form before
// they are compared.
const IDENTIFIER_ALIASES: Readonly<Record<string, string>> = {
  arg: "argument",
  attr: "attribute",
  cfg: "configuration",
  config: "configuration",
  ctx: "context",
  db: "database",
  env: "environment",
  fn: "function",
  impl: "implementation",
  int: "integer",
  msg: "message",
  num: "number",
  param: "parameter",
  perm: "permission",
  repo: "repository",
  req: "request",
  res: "response",
  str: "string",
  util: "utility",
};
const SUMMARY_STOPWORDS = new Set([
  "all",
  "and",
  "any",
  "are",
  "for",
  "from",
  "given",
  "his",
  "into",
  "its",
  "not",
  "specific",
  "the",
  "their",
  "this",
  "was",
  "with",
]);
const SUMMARY_ADDED_WORD_LIMIT = 2;
const SECTION_DIVIDER_PATTERN = /^\/\/\s*(?:[-=─]{3,}|[-=─]{2,}\s*[^-=─]+\s*[-=─]{2,})\s*$/;
const LICENSE_HEADER_PATTERN =
  /\bCopyright(?:\s+\(c\))?|\bSPDX-License-Identifier\s*:|\bLicensed under the\b|\bPermission is hereby granted\b/i;
// A suppression comment repeats at every site it silences, and each one is a separate lint
// decision rather than rationale copied between call sites.
const INLINE_SUPPRESSION_PATTERN = /biome-ignore|@ts-expect-error|@ts-ignore|eslint-disable|oxlint-disable/;
const TEST_PATH_PATTERN = /(?:^|\/)tests\//;

/**
 * The calibrated limits the audit heuristics run with, and the shape a caller can pass to
 * override them.
 *
 * The defaults live here rather than only behind the environment so the thresholds are a value a
 * caller supplies, not ambient state a helper reads on its own. That keeps a self-test
 * deterministic when a maintainer has exported a recalibration override, and leaves the
 * environment as one entry point at the command line instead of a hidden input to every call.
 */
export interface CommentAuditLimits {
  /** A duplicate must carry at least this many words. */
  duplicateMinWords: number;
  /** A duplicate must carry at least this many characters. */
  duplicateMinChars: number;
  /** A consecutive line-comment block must reach this many rendered lines. */
  longBlockMinLines: number;
}

export const DEFAULT_AUDIT_LIMITS: CommentAuditLimits = {
  // A duplicate has to clear the length floor before it is worth a maintainer's attention: a short
  // fallback note such as `// Fallback: keep last value` is repeated by design, while a
  // sentence-long rationale repeated verbatim is a copy. The character floor keeps a string of
  // identifiers from reaching the word count without carrying a sentence.
  duplicateMinChars: 60,
  duplicateMinWords: 12,
  longBlockMinLines: 11,
};

/**
 * Reads a limit override from the environment.
 *
 * A malformed value falls back to the calibrated default rather than silently disabling the rule,
 * and the whole string has to be a positive integer: `parseInt` would read `12words` as 12 and
 * `2.5` as 2, which is how a typo becomes a threshold nobody chose.
 */
function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = Bun.env[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * The limits the audit runs with, after any environment override.
 *
 * Only the command line calls this. Recalibration overrides live in the environment because they
 * exist to be changed and reverted, not because the heuristics should read ambient state.
 */
export function resolveAuditLimits(): CommentAuditLimits {
  const limits = { ...DEFAULT_AUDIT_LIMITS };
  limits.duplicateMinWords = readPositiveIntEnv("COMMENT_AUDIT_DUPLICATE_MIN_WORDS", limits.duplicateMinWords);
  limits.duplicateMinChars = readPositiveIntEnv("COMMENT_AUDIT_DUPLICATE_MIN_CHARS", limits.duplicateMinChars);
  limits.longBlockMinLines = readPositiveIntEnv("COMMENT_AUDIT_LONG_BLOCK_LINES", limits.longBlockMinLines);
  return limits;
}

export type CommentPolicyRule =
  | "duplicate-comment"
  | "long-comment-block"
  | "orphaned-comment"
  | "jsdoc-restatement"
  | "numbered-narration"
  | "obvious-narration"
  | "prose-dash"
  | "rule-scaffolding"
  | "stale-exception";

export interface CommentPolicyFinding {
  file: string;
  line: number;
  message: string;
  rule: CommentPolicyRule;
  severity: "error" | "warning";
  text: string;
}

export interface CommentPolicyException {
  file: string;
  reason: string;
  rule: Exclude<CommentPolicyRule, "obvious-narration" | "stale-exception">;
  text: string;
}

/**
 * The block heuristics answer repository-wide questions, so they need a scope wider than one
 * file's findings list. Every standalone line comment is collected while scanning and grouped
 * once the corpus is complete.
 */
interface InspectionAuditBlocks {
  blocks: CommentBlock[];
}

export interface CommentPolicyOptions {
  auditLimits?: CommentAuditLimits;
  auditNarration?: boolean;
  changedLines?: ReadonlyMap<string, ReadonlySet<number>>;
  exceptionPath?: string;
  paths?: string[];
  repoRoot?: string;
}

export interface CommentPolicyResult {
  filesChecked: number;
  findings: CommentPolicyFinding[];
  usedExceptions: CommentPolicyException[];
}

interface CommentLine {
  file: string;
  kind: "block" | "line";
  line: number;
  standalone: boolean;
  text: string;
}

interface CommentToken {
  kind: "block" | "line";
  line: number;
  standalone: boolean;
  /** The trailing comment sits after code on its line, so it annotates that line only. */
  inline: boolean;
  text: string;
}

interface CommentBlock {
  file: string;
  startLine: number;
  /** Prose lines after dropping empty `//` paragraph separators. */
  lines: string[];
  words: number;
  chars: number;
  normalized: string;
}

interface ParsedArguments {
  auditNarration: boolean;
  baseRef?: string;
  docProse: boolean;
  verboseOutput: boolean;
  paths: string[];
  staged: boolean;
}

interface RawExceptionFile {
  exceptions?: unknown;
}

/**
 * Audits repository comments against TomoriBot's deterministic policy and optional narration ratchet.
 */
export async function checkCommentPolicy(options: CommentPolicyOptions = {}): Promise<CommentPolicyResult> {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const paths = options.paths?.length ? options.paths : DEFAULT_PATHS;
  const exceptionPath = resolve(repoRoot, options.exceptionPath ?? DEFAULT_EXCEPTIONS_PATH);
  const exceptions = await loadExceptions(exceptionPath);
  const files = await discoverTypeScriptFiles(repoRoot, paths);
  const scannedFiles = new Set(files.map((file) => normalizePath(relative(repoRoot, file))));
  const findings: CommentPolicyFinding[] = [];
  const usedExceptionKeys = new Set<string>();
  const auditBlocks: InspectionAuditBlocks = { blocks: [] };
  const auditLimits = options.auditLimits ?? DEFAULT_AUDIT_LIMITS;

  const applyExceptions = (candidates: CommentPolicyFinding[]): CommentPolicyFinding[] =>
    candidates.filter((finding) => {
      const exception = exceptions.find((entry) => exceptionKey(entry) === findingKey(finding));
      if (!exception) return true;
      usedExceptionKeys.add(exceptionKey(exception));
      return false;
    });

  for (const absolutePath of files) {
    const file = normalizePath(relative(repoRoot, absolutePath));
    const source = await Bun.file(absolutePath).text();

    if (isMarkdownPath(absolutePath)) {
      for (const finding of applyExceptions(collectMarkdownDashFindings(source, file))) {
        findings.push(finding);
      }
      continue;
    }

    assertParseable(source, file);
    // The block heuristics collect their own view of the file so a JSDoc block never enters the
    // duplicate or length comparison, and the whole corpus is grouped in one place.
    if (options.auditNarration) {
      auditBlocks.blocks.push(...collectCommentBlocks(source, file));
    }
    const fileFindings = [
      ...collectCommentLines(source, file).flatMap((line) => inspectCommentLine(line, options)),
      ...collectStructuralCommentFindings(source, file),
      ...collectJsDocFindings(source, file, options),
      ...(options.auditNarration ? collectLongCommentBlockFindings(source, file, auditLimits) : []),
      ...collectLocaleStringFindings(source, file),
    ];

    for (const finding of applyExceptions(fileFindings)) {
      findings.push(finding);
    }
  }

  if (options.auditNarration) {
    findings.push(...findDuplicateCommentBlocks(auditBlocks.blocks, auditLimits));
  }

  for (const exception of exceptions) {
    if (scannedFiles.has(normalizePath(exception.file)) && !usedExceptionKeys.has(exceptionKey(exception))) {
      findings.push({
        file: exception.file,
        line: 0,
        message: `Exception no longer matches a violation: ${exception.reason}`,
        rule: "stale-exception",
        severity: "error",
        text: exception.text,
      });
    }
  }

  return {
    filesChecked: files.length,
    findings: findings.sort(
      (left, right) =>
        left.file.localeCompare(right.file) || left.line - right.line || left.rule.localeCompare(right.rule),
    ),
    usedExceptions: exceptions.filter((entry) => usedExceptionKeys.has(exceptionKey(entry))),
  };
}

/**
 * Inspects one TypeScript source without loading repository exceptions.
 *
 * The block heuristics are audit-only, so `auditNarration` gates the length rule here the same
 * way it gates the command line. The duplicate rule compares blocks across files, so it needs
 * `inspectAuditCorpusSources()` or `findDuplicateCommentBlocks()` instead.
 */
export function inspectCommentPolicySource(
  source: string,
  file = "fixture.ts",
  options: Pick<CommentPolicyOptions, "auditLimits" | "auditNarration" | "changedLines"> = {},
): CommentPolicyFinding[] {
  assertParseable(source, file);
  const limits = options.auditLimits ?? DEFAULT_AUDIT_LIMITS;
  return [
    ...collectLocaleStringFindings(source, file),
    ...collectCommentLines(source, file).flatMap((line) => inspectCommentLine(line, options)),
    ...collectStructuralCommentFindings(source, file),
    ...collectJsDocFindings(source, file, options),
    ...(options.auditNarration ? collectLongCommentBlockFindings(source, file, limits) : []),
  ];
}

/**
 * Runs the full audit over a set of fixtures, which is how the duplicate rule is self-tested:
 * it needs two files to compare and returned findings, not a block list.
 */
export function inspectAuditCorpusSources(
  sources: ReadonlyMap<string, string>,
  limits: CommentAuditLimits = DEFAULT_AUDIT_LIMITS,
): CommentPolicyFinding[] {
  const findings: CommentPolicyFinding[] = [];
  const blocks: CommentBlock[] = [];
  for (const [file, source] of sources) {
    findings.push(...inspectCommentPolicySource(source, file, { auditLimits: limits, auditNarration: true }));
    blocks.push(...collectCommentBlocks(source, file));
  }
  findings.push(...findDuplicateCommentBlocks(blocks, limits));
  return findings;
}

/**
 * Names the locations a duplicate was found at, most recent last, so the reporter can list them
 * on the lines under the finding. A group of two is common enough that it still reads as prose.
 */
function describeDuplicateLocations(blocks: CommentBlock[]): string {
  return blocks.map((block) => `at ${block.file}:${block.startLine}`).join("\n");
}

/**
 * Groups standalone line-comment blocks that say the same thing and turns each group into one
 * warning naming every location.
 *
 * The rule looks for copy-paste, not for repetition a reader would expect, and the word and
 * character floor lets short fallback notes repeat freely. Two shapes report: the same rationale in
 * more than one file, where a comment was copied instead of the code being shared, and the same
 * rationale twice in one file, where the extraction is the obvious fix. The one shape that does not
 * report is the same authored sentence standing in every locale tree, which is how a translated
 * locale tree is built rather than a decision anyone made twice.
 */
export function findDuplicateCommentBlocks(
  blocks: CommentBlock[],
  limits: CommentAuditLimits = DEFAULT_AUDIT_LIMITS,
): CommentPolicyFinding[] {
  const byNormalized = new Map<string, CommentBlock[]>();
  for (const block of blocks) {
    if (!block.normalized) continue;
    const group = byNormalized.get(block.normalized) ?? [];
    group.push(block);
    byNormalized.set(block.normalized, group);
  }

  const findings: CommentPolicyFinding[] = [];
  for (const group of byNormalized.values()) {
    if (group.length < 2) continue;
    const eligible = group.every(
      (block) => block.words >= limits.duplicateMinWords && block.chars >= limits.duplicateMinChars,
    );
    if (!eligible) continue;
    // Each locale tree collapses to one identity, so the same English comment carried into every
    // translated file reads as one authored sentence rather than one repetition per language. A
    // group that spans more than one identity still reports, as does genuine repetition inside a
    // single file, where the extraction is the obvious fix.
    const identities = new Set(group.map((block) => commentScope(block.file)));
    const files = new Set(group.map((block) => block.file));
    if (identities.size === 1 && files.size === group.length) {
      continue;
    }

    // The finding sits on the most recent copy, the line a reviewer changes to delete the
    // repetition, and carries every location so one group is one reviewable item.
    const ordered = [...group].sort(
      (left, right) => left.file.localeCompare(right.file) || left.startLine - right.startLine,
    );
    const anchor = ordered[ordered.length - 1];
    if (!anchor) continue;
    findings.push({
      file: anchor.file,
      line: anchor.startLine,
      message: `This rationale is repeated at ${ordered.length} locations; keep one copy or move it to the code path they share.`,
      rule: "duplicate-comment",
      severity: "warning",
      text: [anchor.lines[0] ?? "", describeDuplicateLocations(ordered)].join("\n"),
    });
  }
  return findings;
}

/**
 * Flags a run of consecutive standalone `//` lines long enough that the surplus is usually
 * narrative rather than constraint.
 *
 * JSDoc is out of scope: a long ordered procedure can be a public contract, and the JSDoc
 * rules answer for it. Tests are out of scope for a different reason: a test comment explains
 * the fixture it sits in, which no function name can carry, and the corpus shows those blocks
 * sit at the threshold by design rather than by drift.
 */
export function collectLongCommentBlockFindings(
  source: string,
  file: string,
  limits: CommentAuditLimits = DEFAULT_AUDIT_LIMITS,
): CommentPolicyFinding[] {
  if (TEST_PATH_PATTERN.test(file)) {
    return [];
  }
  return collectCommentBlocks(source, file)
    .filter((block) => block.lines.length >= limits.longBlockMinLines)
    .map((block) => ({
      file,
      line: block.startLine,
      message: `This comment runs ${block.lines.length} lines; keep the constraint and move the narrative into the code, a named helper, or the commit message.`,
      rule: "long-comment-block" as const,
      severity: "warning" as const,
      text: block.lines[0] ?? "",
    }));
}

async function loadExceptions(path: string): Promise<CommentPolicyException[]> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as RawExceptionFile;
  if (!Array.isArray(parsed.exceptions)) {
    throw new Error(`${path}: exceptions must be an array`);
  }

  const exceptions = parsed.exceptions.map((entry, index) => {
    if (!isCommentPolicyException(entry)) {
      throw new Error(`${path}: invalid exception at index ${index}`);
    }
    return entry;
  });
  const keys = new Set<string>();
  for (const exception of exceptions) {
    const key = exceptionKey(exception);
    if (keys.has(key)) {
      throw new Error(`${path}: duplicate exception for ${exception.file}`);
    }
    keys.add(key);
  }
  return exceptions;
}

function isCommentPolicyException(value: unknown): value is CommentPolicyException {
  if (!value || typeof value !== "object") {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.file === "string" &&
    typeof entry.reason === "string" &&
    typeof entry.text === "string" &&
    (entry.rule === "jsdoc-restatement" ||
      entry.rule === "orphaned-comment" ||
      entry.rule === "numbered-narration" ||
      entry.rule === "prose-dash" ||
      entry.rule === "rule-scaffolding")
  );
}

/** Finds objective damage left by deleting only part of a comment block. */
function collectStructuralCommentFindings(source: string, file: string): CommentPolicyFinding[] {
  const sourceLines = source.split(/\r?\n/);
  const findings: CommentPolicyFinding[] = [];
  const record = (line: number, message: string, text: string): void => {
    findings.push({
      file,
      line,
      message,
      rule: "orphaned-comment",
      severity: "error",
      text: text.trim(),
    });
  };

  for (let index = 0; index < sourceLines.length; index++) {
    const line = sourceLines[index] ?? "";
    const previousIsLineComment = index > 0 && /^\s*\/\//.test(sourceLines[index - 1] ?? "");
    const nextIsLineComment = index + 1 < sourceLines.length && /^\s*\/\//.test(sourceLines[index + 1] ?? "");

    if (/^\s*\/\/[ \t]{2,}\S/.test(line) && !previousIsLineComment) {
      record(
        index + 1,
        "This looks like a continuation whose opening line was removed; restore, rewrite, or normalize the paragraph.",
        line,
      );
    }

    if (/^\s*\/\/\s*$/.test(line) && !(previousIsLineComment && nextIsLineComment)) {
      record(index + 1, "Remove the empty comment left at the boundary of a deleted section banner.", line);
    }
  }

  for (const token of collectCommentTokens(source, file)) {
    if (token.kind !== "block" || !token.text.startsWith("/**")) {
      continue;
    }
    const content = token.text
      .replace(/^\/\*\*/, "")
      .replace(/\*\/$/, "")
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\*\s?/, "").trim())
      .filter(Boolean);
    if (content.length === 0) {
      record(token.line, "Remove the empty JSDoc block left after deleting its summary or tags.", token.text);
    }
  }

  return findings;
}

/**
 * Applies the dash rule to locale string literals, which ship to users as prose and so carry the
 * same restriction as comments. Scanning raw source text rather than the cooked literal value
 * keeps the reported line accurate inside the multi-line templates the help locales are built
 * from, where one literal can span a hundred lines.
 */
function collectLocaleStringFindings(source: string, file: string): CommentPolicyFinding[] {
  if (!LOCALE_PATH_PATTERN.test(file)) {
    return [];
  }

  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const sourceLines = source.split(/\r?\n/);
  const flaggedLines = new Map<number, string>();

  const record = (node: ts.Node): void => {
    const raw = node.getText(sourceFile);
    const start = node.getStart(sourceFile);
    for (const match of raw.matchAll(DASH_SCAN_PATTERN)) {
      if (match.index === undefined) continue;
      const { line } = sourceFile.getLineAndCharacterOfPosition(start + match.index);
      flaggedLines.set(line + 1, (sourceLines[line] ?? "").trim());
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      record(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return Array.from(flaggedLines, ([line, text]) => ({
    file,
    line,
    message: "Replace prose dashes in locale text with punctuation that states the relationship.",
    rule: "prose-dash" as const,
    severity: "error" as const,
    text,
  }));
}

/**
 * Strips the spans of a Markdown line whose dashes are data rather than prose, so only authored
 * sentences reach the dash rule.
 *
 * Each span is blanked in place rather than removed, which keeps every surviving dash at its
 * original column for reporting.
 */
function blankMarkdownDataSpans(line: string): string {
  let masked = line;

  const blank = (pattern: RegExp): void => {
    masked = masked.replace(pattern, (match) => " ".repeat(match.length));
  };

  // Inline code spans hold quoted output, flags, and identifiers copied from another system.
  blank(/`[^`]*`/g);
  // Bare and Markdown-target URLs, where a dash is part of the address.
  blank(/<https?:\/\/[^>]*>/g);
  blank(/\]\([^)]*\)/g);
  blank(/https?:\/\/\S+/g);
  // CLI flags such as `--no-build-isolation` written outside a code span.
  blank(/(?:^|\s)--[A-Za-z0-9][\w-]*/g);
  // Discord's subtext marker, which is syntax at the head of a rendered line.
  blank(/^\s*-#\s/g);
  // A dash alone in a table cell marks "not applicable". It is a typographic convention with no
  // two halves to relate, so the rule has nothing to name; prose in the same cell still reports.
  blank(/(?<=\|)\s*[—–]\s*(?=\|)/g);

  return masked;
}

/**
 * Applies the prose dash rule to Markdown under `docs/`.
 *
 * `CLAUDE.md` names `docs/` in the same breath as comments and locale strings, and translated
 * locales are written from these pages, so an unswept dash here propagates into every language
 * the next translator produces.
 */
export function collectMarkdownDashFindings(source: string, file: string): CommentPolicyFinding[] {
  const findings: CommentPolicyFinding[] = [];
  let fenceMarker: string | null = null;

  source.split(/\r?\n/).forEach((raw, index) => {
    const fence = raw.match(/^\s*(```+|~~~+)/);
    if (fence) {
      if (fenceMarker === null) {
        fenceMarker = fence[1][0];
      } else if (fence[1][0] === fenceMarker) {
        fenceMarker = null;
      }
      return;
    }
    if (fenceMarker !== null) return;

    if (!DASH_PATTERN.test(blankMarkdownDataSpans(raw))) return;

    findings.push({
      file,
      line: index + 1,
      message: "Replace prose dashes in docs with punctuation that states the relationship.",
      rule: "prose-dash" as const,
      severity: "error" as const,
      text: raw.trim(),
    });
  });

  return findings;
}

function inspectCommentLine(
  comment: CommentLine,
  options: Pick<CommentPolicyOptions, "auditNarration" | "changedLines">,
): CommentPolicyFinding[] {
  if (comment.line <= 10 && LICENSE_HEADER_PATTERN.test(comment.text)) {
    return [];
  }

  const findings: CommentPolicyFinding[] = [];
  if (DASH_PATTERN.test(comment.text)) {
    findings.push({
      file: comment.file,
      line: comment.line,
      message: "Replace prose dashes with punctuation that states the relationship.",
      rule: "prose-dash",
      severity: "error",
      text: comment.text.trim(),
    });
  }

  if (comment.kind === "line" && comment.standalone && NUMBERED_LINE_PATTERN.test(comment.text)) {
    findings.push({
      file: comment.file,
      line: comment.line,
      message: "Remove procedural numbering; keep only rationale the code cannot express.",
      rule: "numbered-narration",
      severity: "error",
      text: comment.text.trim(),
    });
  }

  if (RULE_HEAD_PATTERN.test(comment.text.trim())) {
    findings.push({
      file: comment.file,
      line: comment.line,
      message: "Remove prompt-style Rule N scaffolding.",
      rule: "rule-scaffolding",
      severity: "error",
      text: comment.text.trim(),
    });
  }

  if (isNarrationCandidate(comment)) {
    const changed = options.changedLines?.get(comment.file)?.has(comment.line);
    if (options.auditNarration || changed) {
      findings.push({
        file: comment.file,
        line: comment.line,
        message: SECTION_DIVIDER_PATTERN.test(comment.text)
          ? "Replace the section banner with a named function or remove it."
          : "This reads like a translation of the next statement; add rationale or remove it.",
        rule: "obvious-narration",
        severity: changed ? "error" : "warning",
        text: comment.text.trim(),
      });
    }
  }

  return findings;
}

/**
 * Flags `@param`/`@returns` text that only repeats the identifier or the TypeScript
 * type beside it.
 *
 * This class needs its own pass because the line rules cannot see it: the tag text
 * carries no dash, no ordinal, and no action head, so it reads as ordinary prose.
 * It is also the highest-recurrence policy miss, since JSDoc predates TypeScript and
 * a complete `@param` list per parameter is the dominant convention in the corpus
 * models learn from.
 *
 * Matching is exact after normalization, never substring: a description that merely
 * contains the type name usually goes on to add units, nullability, or failure
 * behavior, and those are the tags the policy keeps.
 */
function collectJsDocFindings(
  source: string,
  file: string,
  options: Pick<CommentPolicyOptions, "auditNarration" | "changedLines">,
): CommentPolicyFinding[] {
  const scriptKind = file.toLowerCase().endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
  const sourceLines = source.split(/\r?\n/);
  const findings: CommentPolicyFinding[] = [];

  const record = (tag: ts.JSDocTag, message: string): void => {
    const line = sourceFile.getLineAndCharacterOfPosition(tag.getStart(sourceFile)).line;
    findings.push({
      file,
      line: line + 1,
      message,
      rule: "jsdoc-restatement",
      severity: "error",
      text: (sourceLines[line] ?? "").trim(),
    });
  };

  const recordSummaryEcho = (block: ts.JSDoc, summary: string): void => {
    const start = sourceFile.getLineAndCharacterOfPosition(block.getStart(sourceFile)).line;
    const end = sourceFile.getLineAndCharacterOfPosition(block.getEnd()).line;
    let line = start;
    for (let index = start; index <= end; index++) {
      if (stripJsDocDecoration(sourceLines[index] ?? "")) {
        line = index;
        break;
      }
    }

    const changed = options.changedLines?.get(file)?.has(line + 1);
    if (!options.auditNarration && !changed) {
      return;
    }

    findings.push({
      file,
      line: line + 1,
      message: `This summary restates "${summary}" back from the identifier; add rationale or remove the block.`,
      rule: "obvious-narration",
      severity: changed ? "error" : "warning",
      text: (sourceLines[line] ?? "").trim(),
    });
  };

  const visit = (node: ts.Node): void => {
    const block = (node as ts.Node & { jsDoc?: ts.JSDoc[] }).jsDoc?.[0];
    const identifier = block ? documentedIdentifier(node, sourceFile) : undefined;
    if (block && identifier) {
      const body = (ts.getTextOfJSDocComment(block.comment) ?? "").replace(/\s+/g, " ").trim();
      if (body && !REASON_PATTERN.test(body) && echoesIdentifier(identifier, firstClause(body))) {
        recordSummaryEcho(block, identifier);
      }
    }

    if (ts.isFunctionLike(node)) {
      for (const tag of ts.getAllJSDocTags(node, ts.isJSDocParameterTag)) {
        const described = normalizeJsDocPhrase(ts.getTextOfJSDocComment(tag.comment));
        if (!described) {
          continue;
        }

        const parameterName = tag.name.getText(sourceFile);
        const declared = node.parameters.find((parameter) => parameter.name.getText(sourceFile) === parameterName);
        const declaredType = declared?.type ? normalizeJsDocPhrase(declared.type.getText(sourceFile)) : "";

        if (described === normalizeJsDocPhrase(parameterName)) {
          record(tag, `@param ${parameterName} only restates the parameter name; drop the tag.`);
        } else if (declaredType && described === declaredType) {
          record(tag, `@param ${parameterName} only restates its TypeScript type; drop the tag.`);
        }
      }

      for (const tag of ts.getAllJSDocTags(node, ts.isJSDocReturnTag)) {
        const described = normalizeJsDocPhrase(ts.getTextOfJSDocComment(tag.comment));
        const returnType = node.type ? normalizeJsDocPhrase(node.type.getText(sourceFile)) : "";
        if (described && returnType && described === returnType) {
          record(tag, "@returns only restates the return type; drop the tag.");
        }
      }
    }
    node.forEachChild(visit);
  };

  visit(sourceFile);
  return findings;
}

function documentedIdentifier(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations[0]?.name.getText(sourceFile);
  }
  if (
    ts.isFunctionLike(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  ) {
    return (node as ts.Node & { name?: ts.Node }).name?.getText(sourceFile);
  }
  return undefined;
}

/** The text before the first comma, colon, semicolon, parenthesis, or sentence end. */
function firstClause(body: string): string {
  return body.split(/[,;:(]|\.(?:\s|$)/)[0] ?? body;
}

/**
 * True when the summary repeats every meaningful word of the identifier and adds none of
 * its own signal, which is the JSDoc form of translating a name into English.
 *
 * Stemming is crude on purpose: `Count`/`Counts`/`Counting` must collapse together, and a
 * real stemmer would buy nothing at warning severity.
 */
function echoesIdentifier(identifier: string, summary: string): boolean {
  const tokens = splitIdentifierWords(identifier);
  if (tokens.length < 2) {
    return false;
  }

  const words = summary
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !SUMMARY_STOPWORDS.has(word))
    .map(canonicalWord);
  if (!tokens.every((token) => words.includes(token))) {
    return false;
  }

  // A summary that echoes the name AND carries several words of its own is usually
  // documenting a side effect or an ordering guarantee, which the policy keeps.
  const added = words.filter((word) => !tokens.includes(word));
  return new Set(added).size <= SUMMARY_ADDED_WORD_LIMIT;
}

function splitIdentifierWords(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .map(canonicalWord);
}

/**
 * Dropping the trailing `e` last makes `parse` and `parses` meet: without it the stems are
 * `parse` and `pars`.
 */
function stemWord(word: string): string {
  return word.replace(/(?:es|s|ing|ed)$/, "").replace(/e$/, "");
}

function canonicalWord(word: string): string {
  return stemWord(IDENTIFIER_ALIASES[word] ?? word);
}

/** Removes JSDoc framing so a line yields its prose, or an empty string when it has none. */
function stripJsDocDecoration(line: string): string {
  return line
    .replace(/^\s*\/?\*+\/?/, "")
    .replace(/\*\/\s*$/, "")
    .trim();
}

/** Reduces tag text to comparable form: leading article dropped, then letters and digits only. */
function normalizeJsDocPhrase(value: string | undefined): string {
  return (value ?? "")
    .replace(/^\s*(?:the|a|an)\s+/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isNarrationCandidate(comment: CommentLine): boolean {
  if (comment.kind !== "line" || !comment.standalone || /biome-ignore|@ts-expect-error/.test(comment.text)) {
    return false;
  }
  if (SECTION_DIVIDER_PATTERN.test(comment.text)) {
    return true;
  }
  return ACTION_HEAD_PATTERN.test(comment.text) && !RATIONALE_PATTERN.test(comment.text);
}

function exceptionKey(exception: CommentPolicyException): string {
  return `${exception.rule}\0${normalizePath(exception.file)}\0${exception.text.trim()}`;
}

function findingKey(finding: CommentPolicyFinding): string {
  return `${finding.rule}\0${normalizePath(finding.file)}\0${finding.text.trim()}`;
}

function assertParseable(source: string, file: string): void {
  try {
    const loader = file.toLowerCase().endsWith(".tsx") ? "tsx" : "ts";
    new Bun.Transpiler({ loader }).transformSync(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${file}: TypeScript parse failed: ${message}`);
  }
}

function collectCommentLines(source: string, file: string): CommentLine[] {
  const tokens = collectCommentTokens(source, file);
  return tokens.flatMap((token) => {
    if (token.kind === "line") {
      return [
        {
          file,
          kind: token.kind,
          line: token.line,
          standalone: token.standalone,
          text: token.text,
        },
      ];
    }
    return token.text.split(/\r?\n/).map((text, offset) => ({
      file,
      kind: token.kind,
      line: token.line + offset,
      standalone: token.standalone,
      text: text.trimStart(),
    }));
  });
}

function collectCommentTokens(source: string, file: string): CommentToken[] {
  const scriptKind = file.toLowerCase().endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
  const ranges = new Map<string, ts.CommentRange>();

  const addRanges = (found: ts.CommentRange[] | undefined): void => {
    for (const range of found ?? []) {
      ranges.set(`${range.pos}:${range.end}`, range);
    }
  };
  const addStandaloneMatches = (
    pattern: RegExp,
    kind: ts.SyntaxKind.MultiLineCommentTrivia | ts.SyntaxKind.SingleLineCommentTrivia,
  ): void => {
    for (const match of source.matchAll(pattern)) {
      const text = match[1];
      if (match.index === undefined || text === undefined) {
        continue;
      }
      const pos = match.index + match[0].indexOf(text);
      const end = pos + text.length;
      ranges.set(`${pos}:${end}`, {
        end,
        hasTrailingNewLine: true,
        kind,
        pos,
      });
    }
  };
  const visit = (node: ts.Node): void => {
    addRanges(ts.getLeadingCommentRanges(source, node.getFullStart()));
    addRanges(ts.getTrailingCommentRanges(source, node.getEnd()));
    for (const child of node.getChildren(sourceFile)) {
      visit(child);
    }
  };

  visit(sourceFile);
  addRanges(ts.getLeadingCommentRanges(source, sourceFile.end));
  addStandaloneMatches(/^[\t ]*(\/\/[^\r\n]*)/gm, ts.SyntaxKind.SingleLineCommentTrivia);
  addStandaloneMatches(/^[\t ]*(\/\*(?!\*)[^\r\n]*\*\/)[\t ]*$/gm, ts.SyntaxKind.MultiLineCommentTrivia);
  addStandaloneMatches(/^[\t ]*(\/\*\*[\s\S]*?\*\/)/gm, ts.SyntaxKind.MultiLineCommentTrivia);

  const inlineCommentKeys = collectInlineCommentKeys(source);
  return [...ranges.values()]
    .map((range) => normalizeCommentRange(source, range))
    .filter((range): range is ts.CommentRange => range !== undefined)
    .sort((left, right) => left.pos - right.pos)
    .map((range) => {
      const startLocation = sourceFile.getLineAndCharacterOfPosition(range.pos);
      const lineStart = source.lastIndexOf("\n", Math.max(0, range.pos - 1)) + 1;
      const prefix = source.slice(lineStart, range.pos);
      return {
        kind: range.kind === ts.SyntaxKind.SingleLineCommentTrivia ? "line" : "block",
        line: startLocation.line + 1,
        standalone: prefix.trim().length === 0,
        inline: inlineCommentKeys.has(`${range.pos}:${range.end}`),
        text: source.slice(range.pos, range.end),
      };
    });
}

/**
 * Keys the line comments that follow code on their own line.
 *
 * The comment ranges alone cannot answer this: they are ordered by file position, and a trailing
 * comment and the standalone block below it are indistinguishable once positions are flattened.
 * One scanner pass records whether code preceded the comment on the same line, which is what
 * keeps a trailing note from joining the `//` run under it.
 */
function collectInlineCommentKeys(source: string): Set<string> {
  const keys = new Set<string>();
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
  let codeOnLine = false;
  let pending: string[] = [];

  const flushLine = (): void => {
    for (const key of pending) {
      keys.add(key);
    }
    pending = [];
    codeOnLine = false;
  };

  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    const text = scanner.getTokenText();
    if (kind === ts.SyntaxKind.NewLineTrivia || text.includes("\n")) {
      flushLine();
      continue;
    }
    if (kind === ts.SyntaxKind.WhitespaceTrivia) {
      continue;
    }
    if (kind === ts.SyntaxKind.SingleLineCommentTrivia) {
      if (codeOnLine) {
        const start = scanner.getTokenPos();
        pending.push(`${start}:${start + text.length}`);
      }
      continue;
    }
    if (kind === ts.SyntaxKind.MultiLineCommentTrivia) {
      continue;
    }
    codeOnLine = true;
  }
  flushLine();
  return keys;
}

/**
 * Joins consecutive standalone `//` lines into one block and measures it.
 *
 * A block ends where the comments stop being adjacent, so a paragraph break written as an empty
 * `//` line stays inside the block while an intervening statement splits it. JSDoc never enters:
 * the length rule would otherwise compete with the JSDoc rules over the same text.
 */
function collectCommentBlocks(source: string, file: string): CommentBlock[] {
  const standalone = collectCommentTokens(source, file)
    .filter((token) => token.kind === "line" && token.standalone)
    .sort((left, right) => left.line - right.line);
  const blocks: CommentBlock[] = [];
  let current: { endLine: number; lines: string[]; startLine: number } | null = null;

  const flush = (): void => {
    if (!current) return;
    const key = blockKey(current.lines);
    blocks.push({
      chars: key.prose.length,
      file,
      lines: current.lines,
      normalized: key.prose,
      startLine: current.startLine,
      words: key.words,
    });
    current = null;
  };

  for (const token of standalone) {
    if (token.inline || INLINE_SUPPRESSION_PATTERN.test(token.text)) {
      continue;
    }
    const content = token.text.replace(/^\/\/+/, "").trim();
    if (current && token.line === current.endLine + 1) {
      current.endLine = token.line;
      if (content) {
        current.lines.push(content);
      }
      continue;
    }
    flush();
    current = {
      endLine: token.line,
      lines: content ? [content] : [],
      startLine: token.line,
    };
  }
  flush();
  return blocks;
}

/**
 * Compares blocks on their prose alone. Markers, indentation, and case drop out, and so does the
 * line break, because where a comment was wrapped is a function of the surrounding indent rather
 * than of what it says: the same sentence wrapped at forty columns and at ninety is one rationale,
 * and comparing physical lines would report the pair as unrelated.
 */
function blockKey(lines: string[]): { prose: string; words: number } {
  const prose = lines.join(" ").replace(/\s+/g, " ").trim().toLowerCase();
  return { prose, words: countCommentWords(prose) };
}

/** Counts words in already-normalized prose, so the same text always measures the same. */
function countCommentWords(normalized: string): number {
  return normalized.split(/[^A-Za-z0-9_'’-]+/).filter(Boolean).length;
}

/** Collapses the locale trees into one scope so translated copies never read as duplicates. */
function commentScope(file: string): string {
  return file.replace(/(^|\/)src\/locales\/(?!<locale>)[^/]+\//, "$1src/locales/<locale>/");
}

function normalizeCommentRange(source: string, range: ts.CommentRange): ts.CommentRange | undefined {
  const text = source.slice(range.pos, range.end);
  if (
    (range.kind === ts.SyntaxKind.SingleLineCommentTrivia && text.startsWith("//")) ||
    (range.kind === ts.SyntaxKind.MultiLineCommentTrivia && text.startsWith("/*"))
  ) {
    return range;
  }

  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  const expectedMarker = range.kind === ts.SyntaxKind.SingleLineCommentTrivia ? "//" : "/*";
  for (let tokenKind = scanner.scan(); tokenKind !== ts.SyntaxKind.EndOfFileToken; tokenKind = scanner.scan()) {
    if (scanner.getTokenText().startsWith(expectedMarker)) {
      return {
        ...range,
        end: range.pos + scanner.getTextPos(),
        pos: range.pos + scanner.getTokenPos(),
      };
    }
  }
  return undefined;
}

async function discoverTypeScriptFiles(repoRoot: string, paths: string[]): Promise<string[]> {
  const discovered = new Set<string>();
  for (const input of paths) {
    const absoluteInput = isAbsolute(input) ? input : resolve(repoRoot, input);
    const inputStat = await stat(absoluteInput).catch(() => undefined);

    if (inputStat?.isFile()) {
      if (isScannablePath(absoluteInput)) {
        discovered.add(resolve(absoluteInput));
      }
      continue;
    }
    if (inputStat?.isDirectory()) {
      const glob = new Bun.Glob("**/*.{ts,tsx,md,mdx}");
      for await (const path of glob.scan({
        absolute: true,
        cwd: absoluteInput,
        onlyFiles: true,
      })) {
        if (isScannablePath(path) && !isExcludedPath(path)) {
          discovered.add(resolve(path));
        }
      }
      continue;
    }

    const glob = new Bun.Glob(normalizePath(input));
    for await (const path of glob.scan({
      absolute: true,
      cwd: repoRoot,
      onlyFiles: true,
    })) {
      if (isScannablePath(path) && !isExcludedPath(path)) {
        discovered.add(resolve(path));
      }
    }
  }
  return filterGitIgnoredFiles(repoRoot, [...discovered].sort());
}

function isTypeScriptPath(path: string): boolean {
  return /\.tsx?$/i.test(path) && !/\.d\.ts$/i.test(path);
}

function isMarkdownPath(path: string): boolean {
  return /\.mdx?$/i.test(path);
}

function isScannablePath(path: string): boolean {
  return isTypeScriptPath(path) || isMarkdownPath(path);
}

function isExcludedPath(path: string): boolean {
  return /(?:^|[\\/])(?:\.git|dist|node_modules)(?:[\\/]|$)/.test(path);
}

async function filterGitIgnoredFiles(repoRoot: string, paths: string[]): Promise<string[]> {
  if (paths.length === 0) {
    return paths;
  }
  const relativePaths = paths.map((path) => normalizePath(relative(repoRoot, path)));
  const process = Bun.spawn({
    cmd: ["git", "check-ignore", "--stdin", "-z"],
    cwd: repoRoot,
    stderr: "pipe",
    stdin: "pipe",
    stdout: "pipe",
  });
  process.stdin.write(`${relativePaths.join("\0")}\0`);
  process.stdin.end();
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode === 128) {
    return paths;
  }
  if (exitCode !== 0 && exitCode !== 1) {
    throw new Error(`git check-ignore failed: ${stderr.trim()}`);
  }
  const ignored = new Set(stdout.split("\0").filter(Boolean));
  return paths.filter((_, index) => !ignored.has(relativePaths[index]));
}

async function collectChangedLines(
  repoRoot: string,
  mode: { baseRef?: string; staged: boolean },
  paths: string[],
): Promise<Map<string, Set<number>>> {
  const args = ["git", "diff", "--unified=0", "--no-color"];
  if (mode.staged) {
    args.push("--cached");
  } else if (mode.baseRef) {
    args.push(`${mode.baseRef}...HEAD`);
  }
  args.push("--", ...paths);

  const process = Bun.spawn({
    cmd: args,
    cwd: repoRoot,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`git diff failed: ${stderr.trim()}`);
  }

  const changed = new Map<string, Set<number>>();
  let file: string | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      file = normalizePath(line.slice(6));
      continue;
    }
    if (!file || !line.startsWith("@@")) {
      continue;
    }
    const match = /\+(\d+)(?:,(\d+))?/.exec(line);
    if (!match) {
      continue;
    }
    const start = Number.parseInt(match[1], 10);
    const count = match[2] ? Number.parseInt(match[2], 10) : 1;
    const lines = changed.get(file) ?? new Set<number>();
    for (let offset = 0; offset < count; offset += 1) {
      lines.add(start + offset);
    }
    changed.set(file, lines);
  }
  return changed;
}

function parseArguments(args: string[]): ParsedArguments {
  const parsed: ParsedArguments = {
    auditNarration: false,
    docProse: false,
    verboseOutput: isVerboseOutput(),
    paths: [],
    staged: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--audit") {
      parsed.auditNarration = true;
      continue;
    }
    // Detail level, shared with the other gates so `vl` can forward one flag. Any other
    // dash-prefixed value is a mistake, and accepting it as a path would silently
    // replace the default roots with a nonexistent one and scan nothing at all.
    if (value === "--verbose" || value === "--no-verbose") {
      parsed.verboseOutput = value === "--verbose";
      continue;
    }
    if (value === "--staged") {
      parsed.staged = true;
      continue;
    }
    if (value === "--docs") {
      parsed.docProse = true;
      continue;
    }
    if (value === "--base") {
      const baseRef = args[index + 1];
      if (!baseRef) {
        throw new Error("--base requires a Git ref");
      }
      parsed.baseRef = baseRef;
      index += 1;
      continue;
    }
    if (value.startsWith("--")) {
      throw new Error(`Unknown flag: ${value}`);
    }
    parsed.paths.push(value);
  }
  if (parsed.baseRef && parsed.staged) {
    throw new Error("Use either --base or --staged, not both");
  }
  if (parsed.docProse && (parsed.baseRef || parsed.staged)) {
    throw new Error("--docs scans whole files; it cannot be combined with --base or --staged");
  }
  return parsed;
}

async function runDocProseAudit(repoRoot: string, paths: string[]): Promise<void> {
  const result = await auditDocProse(repoRoot, paths.length ? paths : DOC_PROSE_DEFAULT_PATHS);
  console.log(`Prose rules: ${DOC_PROSE_RULES_PATH}`);
  if (!result.engineRan) {
    console.log("uvx not found, so only the repository patterns ran. Install uv to run slop-guard as well.");
  }
  for (const finding of result.findings) {
    const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    const rule = finding.ruleId ? `${finding.rule}, lint-prose ${finding.ruleId}` : finding.rule;
    console.log(`WARN ${location} [${rule}] ${finding.match}${finding.advice ? ` ${finding.advice}` : ""}`);
  }
  if (result.findings.length > 0) {
    console.error(`Doc prose audit: ${result.findings.length} finding(s) in ${result.filesChecked} file(s).`);
    process.exitCode = 1;
    return;
  }
  console.log(`Doc prose audit passed: ${result.filesChecked} file(s).`);
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const args = parseArguments(process.argv.slice(2));
  if (args.docProse) {
    await runDocProseAudit(repoRoot, args.paths);
    return;
  }
  const paths = args.paths.length ? args.paths : DEFAULT_PATHS;
  const changedLines =
    args.baseRef || args.staged
      ? await collectChangedLines(repoRoot, { baseRef: args.baseRef, staged: args.staged }, paths)
      : undefined;
  const result = await checkCommentPolicy({
    auditLimits: resolveAuditLimits(),
    auditNarration: args.auditNarration,
    changedLines,
    paths,
    repoRoot,
  });

  const errors = result.findings.filter((finding) => finding.severity === "error");
  const warnings = result.findings.length - errors.length;

  // Errors print in full under either mode: they are why anyone runs this. Warnings do
  // not change the exit code, so under quiet mode their count is the whole report and
  // the per-finding listing would be detail nobody can act on yet.
  const printsDetail = errors.length > 0 || warnings === 0 || args.verboseOutput;
  if (printsDetail) {
    console.log(`Comment policy guide: ${POLICY_DOC_PATH}`);

    for (const finding of result.findings) {
      const label = finding.severity === "error" ? "ERROR" : "WARN";
      console.log(`${label} ${finding.file}:${finding.line} [${finding.rule}] ${finding.message}`);
      console.log(`  ${finding.text}`);
    }
  }

  if (errors.length > 0) {
    console.error(
      `Comment policy failed: ${errors.length} error(s), ` +
        `${warnings} warning(s), ${result.filesChecked} file(s) checked.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `Comment policy passed: ${result.filesChecked} file(s), ` +
      `${result.usedExceptions.length} exception(s), ${warnings} warning(s).` +
      (warnings > 0 && !args.verboseOutput ? ` Re-run with \`bun run audit-comments --verbose\` to list them.` : ""),
  );
}

if (import.meta.main) {
  await main();
}
