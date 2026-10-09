import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectMarkdownDashFindings,
  DEFAULT_AUDIT_LIMITS,
  inspectAuditCorpusSources,
  inspectCommentPolicySource,
  resolveAuditLimits,
} from "./checkCommentPolicy";
import { collectRepoPatternFindings, maskMarkdownCode } from "./lib/docProse";

/**
 * The audit limits are a parameter now, but a maintainer recalibrating the corpus exports the
 * environment variables that the command line reads. Those must not change what these tests
 * assert, so the overrides are removed for the duration of the file and restored afterwards.
 */
const AUDIT_OVERRIDE_KEYS = [
  "COMMENT_AUDIT_DUPLICATE_MIN_WORDS",
  "COMMENT_AUDIT_DUPLICATE_MIN_CHARS",
  "COMMENT_AUDIT_LONG_BLOCK_LINES",
] as const;
const savedAuditOverrides = new Map<string, string | undefined>();

beforeAll(() => {
  for (const key of AUDIT_OVERRIDE_KEYS) {
    savedAuditOverrides.set(key, Bun.env[key]);
    delete Bun.env[key];
  }
});

afterAll(() => {
  for (const [key, value] of savedAuditOverrides) {
    if (value === undefined) {
      delete Bun.env[key];
    } else {
      Bun.env[key] = value;
    }
  }
});

describe("comment policy", () => {
  it("finds authored prose dashes without matching strings or regexes", () => {
    const source = [
      'const prose = "Keep — string";',
      "const matcher = /[—–]/u;",
      "const value = 1; // Keep rationale — callers depend on it",
      "",
    ].join("\n");

    const findings = inspectCommentPolicySource(source);

    expect(findings.map((finding) => finding.rule)).toEqual(["prose-dash"]);
  });

  it("finds prose dashes in locale strings, which ship to users as prose", () => {
    const source = ["export const ja = {", "  note: `ご注意 — TXTファイル`,", "};", ""].join("\n");

    const findings = inspectCommentPolicySource(source, "src/locales/ja/commands/tool.ts");

    expect(findings.map((finding) => finding.rule)).toEqual(["prose-dash"]);
  });

  it("reports the offending line inside a multi-line locale template", () => {
    const source = ["export const en = {", "  help: `First line", "Second line", "tiny — 0.5 GB`,", "};", ""].join(
      "\n",
    );

    const findings = inspectCommentPolicySource(source, "src/locales/en-US/commands/help.ts");

    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(4);
  });

  it("leaves non-locale string literals alone", () => {
    const source = ['const label = "Keep — string";', ""].join("\n");

    expect(inspectCommentPolicySource(source, "src/utils/misc/labels.ts")).toEqual([]);
  });

  it("parses TSX without treating rendered text as a comment", () => {
    const source = [
      "const View = () => (",
      '  <section title="Keep — rendered text">',
      "    {/* Keep rationale — callers depend on this boundary */}",
      "  </section>",
      ");",
    ].join("\n");

    const findings = inspectCommentPolicySource(source, "fixture.tsx");

    expect(findings.map((finding) => finding.rule)).toEqual(["prose-dash"]);
  });

  it("finds numbered narration but leaves JSDoc ordered lists alone", () => {
    const source = [
      "// 1. Parse the value",
      "const value = parseValue();",
      "/**",
      " * Resolution order:",
      " * 1. Cache",
      " * 2. Database",
      " */",
      "export function read(): string {",
      '  return "ok";',
      "}",
      "",
    ].join("\n");

    const findings = inspectCommentPolicySource(source);

    expect(findings.map((finding) => finding.rule)).toEqual(["numbered-narration"]);
  });

  it("finds compound, sub-indexed, and parenthesized narration", () => {
    const source = [
      "// 11a.2. Capture the avatar",
      "// 13.5 Check the fallback",
      "// 2) Process the result",
      "const value = true;",
      "",
    ].join("\n");

    const findings = inspectCommentPolicySource(source);

    expect(findings.filter((finding) => finding.rule === "numbered-narration")).toHaveLength(3);
  });

  it("finds prompt-style rule scaffolding", () => {
    const source = [
      "// Rule 20: Constants at the top",
      "const first = 1;",
      "// Rule #7: Validate the partial data",
      "const second = 2;",
      "// Rule #8 and #9: Normalize the result",
      "const third = 3;",
      "",
    ].join("\n");
    const findings = inspectCommentPolicySource(source);

    expect(findings.map((finding) => finding.rule)).toEqual([
      "rule-scaffolding",
      "rule-scaffolding",
      "rule-scaffolding",
    ]);
  });

  it("reports obvious narration during audits", () => {
    const findings = inspectCommentPolicySource(
      "// Parse and validate composite-key format\nconst value = parseKey();\n",
      "fixture.ts",
      { auditNarration: true },
    );

    expect(findings).toEqual([
      expect.objectContaining({
        rule: "obvious-narration",
        severity: "warning",
      }),
    ]);
  });

  it("promotes new narration to an error", () => {
    const changedLines = new Map([["fixture.ts", new Set([1])]]);
    const findings = inspectCommentPolicySource(
      "// Build the payload\nconst payload = buildPayload();\n",
      "fixture.ts",
      { changedLines },
    );

    expect(findings).toEqual([
      expect.objectContaining({
        rule: "obvious-narration",
        severity: "error",
      }),
    ]);
  });

  it("does not flag action-headed rationale", () => {
    const findings = inspectCommentPolicySource(
      "// Set env vars before lazy imports so module constants see them.\nconst value = true;\n",
      "fixture.ts",
      { auditNarration: true },
    );

    expect(findings).toEqual([]);
  });

  it("reports section banners only when narration auditing is active", () => {
    const source = "// ---------- Helpers ----------\nconst value = true;\n";

    expect(inspectCommentPolicySource(source)).toEqual([]);
    expect(
      inspectCommentPolicySource(source, "fixture.ts", {
        auditNarration: true,
      }).map((finding) => finding.rule),
    ).toEqual(["obvious-narration"]);
  });

  it("finds JSDoc tags that only repeat the identifier or its type", () => {
    const source = [
      "/**",
      " * Resolve one request.",
      " * @param request - Provider native image generation request",
      " */",
      "export function resolve(request: ProviderNativeImageGenerationRequest): void {}",
      "/**",
      " * Find a server.",
      " * @returns Promise<string | null>",
      " */",
      "export function find(name: string): Promise<string | null> {",
      "  return Promise.resolve(name);",
      "}",
      "",
    ].join("\n");

    expect(inspectCommentPolicySource(source).map((finding) => finding.rule)).toEqual([
      "jsdoc-restatement",
      "jsdoc-restatement",
    ]);
  });

  it("reports a JSDoc summary that echoes the identifier only while auditing", () => {
    const source = [
      "/**",
      " * Build system prompt for LLM",
      " */",
      "export function buildSystemPrompt(): string {",
      '  return "";',
      "}",
      "",
    ].join("\n");

    expect(inspectCommentPolicySource(source)).toEqual([]);
    expect(
      inspectCommentPolicySource(source, "fixture.ts", { auditNarration: true }).map((finding) => finding.rule),
    ).toEqual(["obvious-narration"]);
  });

  it("sees through abbreviations, inflections, and condition words when a summary echoes a name", () => {
    const source = [
      "/**",
      " * Parses a positive-integer environment variable, falling back to the given",
      " * default when unset, non-numeric, or non-positive.",
      " */",
      "function parsePositiveIntEnv(name: string, fallback: number): number {",
      "  return fallback;",
      "}",
      "",
    ].join("\n");

    expect(
      inspectCommentPolicySource(source, "fixture.ts", { auditNarration: true }).map((finding) => finding.rule),
    ).toEqual(["obvious-narration"]);
  });

  it("checks type and constant docblocks, and keeps one that states a unit", () => {
    const source = [
      "/** News search result */",
      "export interface NewsResult {}",
      "",
      "/** Timeout in milliseconds for the GitHub API fetch */",
      "const GITHUB_API_TIMEOUT_MS = 10000;",
      "",
    ].join("\n");

    expect(
      inspectCommentPolicySource(source, "fixture.ts", { auditNarration: true }).map((finding) => finding.text),
    ).toEqual(["/** News search result */"]);
  });

  it("keeps a JSDoc summary that documents a side effect beyond the identifier", () => {
    const source = [
      "/**",
      " * Connect to a single guild MCP server and register it in the shared pool.",
      " */",
      "export function connectGuildMcpServer(): void {}",
      "",
    ].join("\n");

    expect(inspectCommentPolicySource(source, "fixture.ts", { auditNarration: true })).toEqual([]);
  });

  it("keeps JSDoc tags that add what the type cannot express", () => {
    const source = [
      "/**",
      " * Join supported modes.",
      " * @param modes - Empty when the provider reports no capabilities",
      " * @returns Comma-joined list, or empty string when no modes are supported",
      " */",
      "export function joinModes(modes: string[]): string {",
      '  return modes.join(",");',
      "}",
      "",
    ].join("\n");

    expect(inspectCommentPolicySource(source)).toEqual([]);
  });

  it("finds a continuation left without its opening comment", () => {
    const findings = inspectCommentPolicySource(
      "const value = true;\n//    because the deleted opener carried the subject.\n",
    );

    expect(findings).toEqual([
      expect.objectContaining({
        rule: "orphaned-comment",
        severity: "error",
      }),
    ]);
  });

  it("allows an indented continuation when its opening line remains", () => {
    const source = [
      "// Keep the first line because it supplies the subject,",
      "//    and indent the continuation to make wrapping visible.",
      "const value = true;",
      "",
    ].join("\n");

    expect(inspectCommentPolicySource(source)).toEqual([]);
  });

  it("finds empty boundary comments but allows paragraph separators", () => {
    const orphaned = inspectCommentPolicySource("const value = true;\n//\n// Rationale remains.\n");
    expect(orphaned.map((finding) => finding.rule)).toEqual(["orphaned-comment"]);

    const paragraphBreak = "// First rationale paragraph.\n//\n// Second rationale paragraph.\nconst value = true;\n";
    expect(inspectCommentPolicySource(paragraphBreak)).toEqual([]);
  });

  it("finds empty JSDoc left after partial cleanup", () => {
    const findings = inspectCommentPolicySource("/**\n *\n */\nexport function value(): void {}\n");

    expect(findings.map((finding) => finding.rule)).toEqual(["orphaned-comment"]);
  });
});

describe("audit block signals", () => {
  // Long enough to clear the duplicate word and character floors, and distinct enough that a
  // copy is unmistakable.
  const SUBSTANTIVE = [
    "The provider returns a partial payload when the stream closes early, so the",
    "recovered keys stay merged into the accumulator instead of replacing it.",
  ].join("\n");

  const source = (comment: string): string =>
    [...comment.split("\n").map((line) => (line ? `// ${line}` : "//")), "const value = true;", ""].join("\n");

  it("reports one finding per duplicate across two files", () => {
    const shared = "First line of the shared note.\nSecond line of the shared note.";
    const findings = inspectAuditCorpusSources(
      new Map([
        ["src/alpha.ts", source(shared)],
        ["src/beta.ts", source(shared)],
      ]),
    ).filter((finding) => finding.rule === "duplicate-comment");

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      file: "src/beta.ts",
      severity: "warning",
    });
    expect(findings[0]?.text).toContain("at src/alpha.ts:1");
    expect(findings[0]?.text).toContain("at src/beta.ts:1");
  });

  it("matches duplicates after normalizing comment markers, wrapping, and indentation", () => {
    const findings = inspectAuditCorpusSources(
      new Map([
        [
          "src/alpha.ts",
          [
            "// Discord rejects a second acknowledgement, so modal branches return",
            "// before deferral and the interaction stays unanswered.",
            "const value = true;",
            "",
          ].join("\n"),
        ],
        [
          "src/beta.ts",
          [
            "    //   discord rejects a second acknowledgement, so modal branches return",
            "    //     before deferral and the interaction stays unanswered.",
            "    const other = false;",
            "",
          ].join("\n"),
        ],
      ]),
    ).filter((finding) => finding.rule === "duplicate-comment");

    expect(findings).toHaveLength(1);
    expect(findings[0]?.text).toContain("at src/alpha.ts:1");
  });

  it("matches the same sentence reflowed onto different line breaks", () => {
    // The two files carry the same sentence, wrapped at different columns. Line breaks are a
    // function of the surrounding indent, so treating them as content would miss the pair.
    const findings = inspectAuditCorpusSources(
      new Map([
        [
          "src/alpha.ts",
          [
            "// Discord rejects a second acknowledgement",
            "// for the same interaction, so modal branches",
            "// return before deferral and the interaction",
            "// stays unanswered.",
            "const value = true;",
            "",
          ].join("\n"),
        ],
        [
          "src/beta.ts",
          [
            "// Discord rejects a second acknowledgement for the same",
            "// interaction, so modal branches return before deferral",
            "// and the interaction stays unanswered.",
            "const other = false;",
            "",
          ].join("\n"),
        ],
      ]),
    ).filter((finding) => finding.rule === "duplicate-comment");

    expect(findings).toHaveLength(1);
  });

  it("leaves a repeated one-liner alone", () => {
    const short = "Fallback: keep the last good value.";
    const findings = inspectAuditCorpusSources(
      new Map([
        ["src/alpha.ts", source(short)],
        ["src/beta.ts", source(short)],
        ["src/gamma.ts", source(short)],
      ]),
    ).filter((finding) => finding.rule.startsWith("duplicate"));

    expect(findings).toEqual([]);
  });

  it("leaves one long unique rationale block alone", () => {
    const findings = inspectAuditCorpusSources(
      new Map([
        [
          "src/alpha.ts",
          source(
            [
              "The provider returns a partial payload when the stream closes early, so the",
              "recovered keys stay merged into the accumulator instead of replacing it.",
              "Dropping the merge would lose every argument the model already emitted.",
            ].join("\n"),
          ),
        ],
      ]),
    ).filter((finding) => finding.rule === "duplicate-comment");

    expect(findings).toEqual([]);
  });

  it("leaves an authored sentence standing in every locale tree alone", () => {
    const findings = inspectAuditCorpusSources(
      new Map([
        ["src/locales/en-US/commands/legal.ts", source(SUBSTANTIVE)],
        ["src/locales/ja/commands/legal.ts", source(SUBSTANTIVE)],
        ["src/locales/pt-BR/commands/legal.ts", source(SUBSTANTIVE)],
      ]),
    ).filter((finding) => finding.rule === "duplicate-comment");

    expect(findings).toEqual([]);
  });

  it("reports a duplicate inside one locale tree against the source tree", () => {
    const findings = inspectAuditCorpusSources(
      new Map([
        ["src/locales/en-US/commands/legal.ts", source(SUBSTANTIVE)],
        ["src/locales/ja/commands/legal.ts", source(SUBSTANTIVE)],
        ["src/utils/legal.ts", source(SUBSTANTIVE)],
      ]),
    ).filter((finding) => finding.rule === "duplicate-comment");

    expect(findings).toHaveLength(1);
  });

  it("reports repetition inside a single file", () => {
    const source = [
      "// The write path has to record the cause here, because the route only reports that the",
      "// write failed and the failure reason is dropped before it reaches the caller.",
      "const first = true;",
      "// The write path has to record the cause here, because the route only reports that the",
      "// write failed and the failure reason is dropped before it reaches the caller.",
      "const second = true;",
      "",
    ].join("\n");

    const findings = inspectAuditCorpusSources(new Map([["src/alpha.ts", source]])).filter(
      (finding) => finding.rule === "duplicate-comment",
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.text).toContain("at src/alpha.ts:4");
  });

  it("ignores suppression comments, which repeat once per suppressed site", () => {
    const suppression = [
      "// biome-ignore lint/style/noNonNullAssertion: the lookup above guarantees the row exists",
      "const value = record!;",
    ].join("\n");
    const findings = inspectAuditCorpusSources(
      new Map([
        ["src/alpha.ts", `${suppression}\n`],
        ["src/beta.ts", `${suppression}\n`],
      ]),
    ).filter((finding) => finding.rule === "duplicate-comment");

    expect(findings).toEqual([]);
  });

  it("reports a long consecutive line-comment block only during audits", () => {
    const source = [
      "// Paragraph one records how the incident was found and what it cost.",
      "//",
      "// Paragraph two records the measurement that led to the current guard.",
      "// Paragraph three records the fallback the first fix left behind.",
      "// Paragraph four records the operator response the guard expects now.",
      "// Paragraph five records the ordering the retry path must preserve.",
      "// Paragraph six records the cancellation behavior callers depend on.",
      "// Paragraph seven records the compatibility window still supported.",
      "// Paragraph eight records the security boundary the guard enforces.",
      "// Paragraph nine records the units the threshold is expressed in.",
      "// Paragraph ten records the configuration knob that widens it.",
      "// Paragraph eleven records the metric that reports a trip.",
      "const value = true;",
      "",
    ].join("\n");

    expect(inspectCommentPolicySource(source)).toEqual([]);
    expect(
      inspectCommentPolicySource(source, "fixture.ts", {
        auditLimits: DEFAULT_AUDIT_LIMITS,
        auditNarration: true,
      }).map((finding) => finding.rule),
    ).toEqual(["long-comment-block"]);
  });

  it("keeps a long JSDoc block out of the length rule", () => {
    const source = [
      "/**",
      " * Resolution order is part of the exported contract, so the list stays ordered:",
      " * first the in-process cache, then the shared cache, then the database,",
      " * then a network refresh, then the compiled defaults, then the caller value.",
      " * Each step is documented because plugins override the chain by name.",
      " * A plugin that returns early skips every later step in this list.",
      " * The order is asserted by the resolution order contract test.",
      " * That test is the reason the order cannot be simplified.",
      " * It runs on every provider registration in the suite.",
      " * The list is long on purpose and the policy keeps it.",
      " */",
      "export function resolveValue(): string {",
      '  return "ok";',
      "}",
      "",
    ].join("\n");

    expect(
      inspectCommentPolicySource(source, "fixture.ts", {
        auditLimits: DEFAULT_AUDIT_LIMITS,
        auditNarration: true,
      }),
    ).toEqual([]);
  });

  it("reports the length rule as a warning that never fails the command", () => {
    const source = [
      "// Paragraph one records how the incident was found and what it cost.",
      "//",
      "// Paragraph two records the measurement that led to the current guard.",
      "// Paragraph three records the fallback the first fix left behind.",
      "// Paragraph four records the operator response the guard expects now.",
      "// Paragraph five records the ordering the retry path must preserve.",
      "// Paragraph six records the cancellation behavior callers depend on.",
      "// Paragraph seven records the compatibility window still supported.",
      "// Paragraph eight records the security boundary the guard enforces.",
      "// Paragraph nine records the units the threshold is expressed in.",
      "// Paragraph ten records the configuration knob that widens it.",
      "// Paragraph eleven records the metric that reports a trip.",
      "const value = true;",
      "",
    ].join("\n");

    const findings = inspectCommentPolicySource(source, "fixture.ts", {
      auditLimits: DEFAULT_AUDIT_LIMITS,
      auditNarration: true,
    });

    expect(findings).toEqual([
      expect.objectContaining({
        line: 1,
        rule: "long-comment-block",
        severity: "warning",
      }),
    ]);
  });
});

describe("markdown prose dashes", () => {
  const linesFlagged = (...lines: string[]): number[] =>
    collectMarkdownDashFindings(lines.join("\n"), "docs/en/example.md").map((finding) => finding.line);

  it("flags authored prose", () => {
    expect(linesFlagged("The cache is lazy — nothing sweeps it.")).toEqual([1]);
  });

  it("skips fenced blocks, which hold output copied from another system", () => {
    expect(linesFlagged("```bash", "tomori — help", "```", "Prose — here")).toEqual([4]);
  });

  it("skips inline code, links, and CLI flags, where a dash is part of the value", () => {
    expect(
      linesFlagged(
        "Pass `--flag — value` verbatim.",
        "Run pip install --no-build-isolation now.",
        "See [the guide](https://example.com/a — b) first.",
        "Read https://example.com/a—b for context.",
      ),
    ).toEqual([]);
  });

  it("skips Discord's subtext marker but not prose on the same line", () => {
    expect(linesFlagged("-# Subtext only")).toEqual([]);
    expect(linesFlagged("-# Subtext — with prose")).toEqual([1]);
  });

  it("skips a lone dash marking an empty table cell but not prose beside it", () => {
    expect(linesFlagged("| Env var | `RUN_ENV` | — | production only |")).toEqual([]);
    expect(linesFlagged("| Relay | Bidirectional — images and files |")).toEqual([1]);
  });
});

describe("audit limit overrides", () => {
  const withOverrides = <T>(overrides: Record<string, string>, body: () => T): T => {
    const saved = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(overrides)) {
      saved.set(key, Bun.env[key]);
      Bun.env[key] = value;
    }
    try {
      return body();
    } finally {
      for (const [key, value] of saved) {
        if (value === undefined) {
          delete Bun.env[key];
        } else {
          Bun.env[key] = value;
        }
      }
    }
  };

  it("defaults to the calibrated limits", () => {
    expect(resolveAuditLimits()).toEqual(DEFAULT_AUDIT_LIMITS);
  });

  it("reads a whole positive integer override", () => {
    const limits = withOverrides(
      {
        COMMENT_AUDIT_DUPLICATE_MIN_CHARS: "30",
        COMMENT_AUDIT_DUPLICATE_MIN_WORDS: "4",
        COMMENT_AUDIT_LONG_BLOCK_LINES: "5",
      },
      resolveAuditLimits,
    );

    expect(limits).toEqual({
      duplicateMinChars: 30,
      duplicateMinWords: 4,
      longBlockMinLines: 5,
    });
  });

  it("falls back per variable when a value is only partly numeric", () => {
    const limits = withOverrides(
      {
        COMMENT_AUDIT_DUPLICATE_MIN_CHARS: "60.5",
        COMMENT_AUDIT_DUPLICATE_MIN_WORDS: "12words",
        COMMENT_AUDIT_LONG_BLOCK_LINES: "0",
      },
      resolveAuditLimits,
    );

    expect(limits).toEqual(DEFAULT_AUDIT_LIMITS);
  });
});

describe("audit command line", () => {
  // The fixture lives outside the repository so `git check-ignore` filtering in file discovery
  // cannot swallow it, and so a failing run cannot leave scratch files in the working tree.
  const LONG_BLOCK = [
    "// Detect speaker transitions: the model is generating another character's turn.",
    "// Both Kayra and GLM need this: Kayra has no API stop sequences, and GLM",
    "// does not emit user tokens in completions mode, so it just starts",
    "// writing a name and a colon instead of a control token.",
    "//",
    "// Kayra treats a dinkus as a scene break, so the model considers its turn",
    "// complete once it emits one and the adapter stops there instead of letting",
    "// the next narrative zone bleed into the same response.",
    "//",
    "// The known-name form only fires for speakers the adapter collected from",
    "// dialogue history, which keeps mid-sentence proper nouns from tripping it.",
    "//",
    "// The colon form accepts any label, because an unknown speaker label still",
    "// means the model left its own turn behind.",
    "const value = true;",
    "",
  ].join("\n");

  /**
   * Strips the audit override variables a maintainer may have exported for recalibration. A child
   * that inherits them would answer a different question than the assertion asks, and the test
   * would fail for a reason that has nothing to do with the code.
   */
  const withoutAuditOverrides = (extra: Record<string, string> = {}): Record<string, string> => {
    const env = Object.fromEntries(
      Object.entries(Bun.env).filter(([key, value]) => !key.startsWith("COMMENT_AUDIT_") && value !== undefined),
    ) as Record<string, string>;
    return { ...env, ...extra };
  };

  const runChecker = async (
    args: string[],
    env: Record<string, string> = {},
  ): Promise<{ stderr: string; stdout: string; code: number }> => {
    const directory = await mkdtemp(join(tmpdir(), "comment-policy-"));
    try {
      const fixture = join(directory, "longBlock.ts");
      await writeFile(fixture, LONG_BLOCK, "utf8");
      const process = Bun.spawn({
        cmd: ["bun", "run", "scripts/checks/checkCommentPolicy.ts", ...args, fixture],
        cwd: join(import.meta.dir, "..", ".."),
        env: withoutAuditOverrides(env),
        stderr: "pipe",
        stdout: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ]);
      return { code, stderr, stdout };
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  };

  it("reports block signals as warnings only under --audit", async () => {
    const audited = await runChecker(["--audit", "--verbose"]);
    expect(audited.stdout).toContain("[long-comment-block]");
    expect(audited.code).toBe(0);

    const plain = await runChecker([]);
    expect(plain.stdout).not.toContain("[long-comment-block]");
    expect(plain.code).toBe(0);
  });

  it("prints only the count without --verbose", async () => {
    const quiet = await runChecker(["--audit"]);

    expect(quiet.stdout).not.toContain("[long-comment-block]");
    expect(quiet.stdout).toContain("1 warning(s)");
    expect(quiet.code).toBe(0);
  });

  it("falls back to the calibrated limits when an override is malformed", async () => {
    // `12words` and `5.5` would both pass a bare `parseInt` (`5.5` becomes 5), so a typo would
    // silently become a threshold nobody chose. The fixture is 11 rendered lines, so the
    // calibrated default reports it while a parsed `5` would not.
    const malformed = await runChecker(["--audit", "--verbose"], {
      COMMENT_AUDIT_DUPLICATE_MIN_WORDS: "12words",
      COMMENT_AUDIT_LONG_BLOCK_LINES: "5.5",
    });

    expect(malformed.stdout).toContain("This comment runs 11 lines");
    expect(malformed.code).toBe(0);
  });

  it("keeps the documented audit command reviewable", async () => {
    // The plan's review step is `bun run audit-comments`, so that invocation itself has to print
    // the locations. A count-only report would make the command useless for its stated purpose.
    const packageJson = (await Bun.file(join(import.meta.dir, "..", "..", "package.json")).json()) as {
      scripts?: Record<string, string>;
    };
    const script = packageJson.scripts?.["audit-comments"] ?? "";
    expect(script).toContain("--verbose");

    const process = Bun.spawn({
      cmd: ["bun", "run", "audit-comments"],
      cwd: join(import.meta.dir, "..", ".."),
      env: withoutAuditOverrides(),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [code, stdout] = await Promise.all([process.exited, new Response(process.stdout).text()]);

    expect(stdout).toMatch(/^WARN .*\[duplicate-comment\]/m);
    expect(stdout).toMatch(/^at /m);
    expect(code).toBe(0);
  }, 180_000);
});

describe("doc prose repository patterns", () => {
  it("reports filler on its own line and ignores code", () => {
    const source = [
      "Run `in order to` literally.",
      "```ts",
      "// utilize the cache",
      "```",
      "Call it in order to warm the cache.",
    ].join("\n");

    const findings = collectRepoPatternFindings("doc.md", source);

    expect(findings.map(({ line, match, ruleId }) => ({ line, match, ruleId }))).toEqual([
      { line: 5, match: "in order to", ruleId: 20 },
    ]);
  });

  it("keeps offsets stable while masking", () => {
    const source = "a `code` b\n```\nx\n```\nc";
    expect(maskMarkdownCode(source).length).toBe(source.length);
    expect(maskMarkdownCode(source).split("\n")).toHaveLength(source.split("\n").length);
  });
});
