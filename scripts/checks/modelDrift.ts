import { appendFile, writeFile } from "node:fs/promises";
import ts from "typescript";
import { imageSections, llmSections, videoSections } from "@/db/seed/catalog/models";
import {
  MAX_ACTIVE_ROWS_PER_PROVIDER,
  MODEL_DRIFT_TODO,
  REQUIRED_ALTERNATION_PROVIDERS,
  REQUIRED_PREFIX_PROVIDERS,
} from "@/db/seed/catalog/modelSeed";
import type { ImageInput, LlmInput, VideoInput } from "@/db/seed/catalog/types";

export type ModelTable = "llmSections" | "imageSections" | "videoSections";
export interface SourceModel {
  id: string;
  family?: string;
  tool_call?: boolean;
  reasoning?: boolean;
  structured_output?: boolean;
  release_date?: string;
  modalities?: { input?: string[]; output?: string[] };
  cost?: { input?: number; output?: number };
}
type SourceCatalog = Record<string, { models: Record<string, SourceModel> }>;
export interface Candidate {
  provider: string;
  table: ModelTable;
  model: SourceModel;
  codename: string;
}
export interface SeenEntry {
  provider: string;
  table: ModelTable;
  codename: string;
  releaseDate: string | null;
  offeredAt: string;
}
interface Policy {
  source: string;
  tier: "generation" | "family";
  minGeneration?: number;
  floatingAliases?: boolean;
}

/** models.dev: a community-maintained, open-source database of model prices, limits, and capabilities. */
const SOURCE_URL = "https://models.dev/api.json";
const CATALOG_URL = new URL("../../src/db/seed/catalog/models.ts", import.meta.url);
const SEEN_URL = new URL("../data/modelDriftSeen.json", import.meta.url);
const REJECT_NON_CHAT =
  /-(tts|live(?!\w)|live-translate|image|computer-use|robotics|omni)(-|$)|^deep-research|^lyria|^gemma/;
const REJECT_MEDIA = /(^|\/)(deep-research|openrouter\/auto)/;
const FLOATING_ALIAS = /(^~|-latest$)/;
const POLICIES: Record<string, Policy> = {
  google: { source: "google", tier: "generation", minGeneration: 3 },
  vertex: { source: "google-vertex", tier: "generation", minGeneration: 3 },
  zai: { source: "zai", tier: "generation", minGeneration: 4.6 },
  zaicoding: { source: "zai", tier: "generation", minGeneration: 4.6 },
  anthropic: { source: "anthropic", tier: "generation", minGeneration: 4.5 },
  deepseek: { source: "deepseek", tier: "generation", minGeneration: 0 },
  openrouter: { source: "openrouter", tier: "family", floatingAliases: true },
  nvidia: { source: "nvidia", tier: "family" },
};

export function seenKey(entry: Pick<SeenEntry, "provider" | "table" | "codename">): string {
  return `${entry.provider}\u0000${entry.table}\u0000${entry.codename}`;
}

/** Reads a table's catalog rows; tests pass a frozen snapshot so the source fixture never goes stale. */
export type CatalogLookup = (table: ModelTable) => Array<Pick<LlmInput, "provider" | "codename">>;

function catalogRows(table: ModelTable): Array<LlmInput | ImageInput | VideoInput> {
  switch (table) {
    case "llmSections":
      return llmSections.flatMap((section) => section.rows);
    case "imageSections":
      return imageSections.flatMap((section) => section.rows);
    case "videoSections":
      return videoSections.flatMap((section) => section.rows);
  }
}

function generationOf(id: string): number {
  const stripped = id
    .replace(/^~/, "")
    .replace(/.*\//, "")
    .replace(/^(gemini|glm)-/, "")
    .replace(/^claude-[a-z]+-/, "")
    .replace(/-/, ".");
  return Number.parseFloat(stripped);
}

function bareAliasOf(id: string): string {
  return id.replace(/-\d{8}$/, "");
}

function carriedHas(carried: Set<string>, provider: string, id: string): boolean {
  return carried.has(id) || carried.has(`${provider}/${id}`) || carried.has(id.split("/").pop() ?? id);
}

function outputIs(model: SourceModel, kind: "text" | "image" | "video"): boolean {
  const output = model.modalities?.output;
  return kind === "text" ? output?.length === 1 && output[0] === "text" : output?.includes(kind) === true;
}

function familyCandidates(
  models: SourceModel[],
  provider: string,
  carried: Set<string>,
): { drafts: SourceModel[]; covered: string[] } {
  const newest = new Map<string, string>();
  const aliases = new Map<string, string>();
  const covered: string[] = [];
  for (const codename of carried) {
    const model = models.find((row) => row.id === codename || row.id.endsWith(`/${codename}`));
    if (model?.family && POLICIES[provider].floatingAliases && /^~.*-latest$/.test(codename)) {
      aliases.set(model.family, codename);
    }
    if (!model?.family || !model.release_date) continue;
    const prior = newest.get(model.family);
    if (!prior || prior < model.release_date) newest.set(model.family, model.release_date);
  }
  const drafts = models.filter((model) => {
    if (!outputIs(model, "text") || carriedHas(carried, provider, model.id)) return false;
    const coveringAlias = model.family ? aliases.get(model.family) : undefined;
    if (coveringAlias && !FLOATING_ALIAS.test(model.id)) {
      covered.push(`\`${model.id}\` covered by \`${coveringAlias}\` (family: \`${model.family}\`)`);
      return false;
    }
    const sibling =
      !!model.family &&
      !!model.release_date &&
      !!newest.get(model.family) &&
      model.release_date > (newest.get(model.family) ?? "");
    const alias = POLICIES[provider].floatingAliases && FLOATING_ALIAS.test(model.id);
    return sibling || alias;
  });
  return { drafts, covered };
}

function generationCandidates(models: SourceModel[], provider: string, carried: Set<string>): SourceModel[] {
  const passing = models.filter((model) => {
    if (!outputIs(model, "text") || carriedHas(carried, provider, model.id)) return false;
    if ((provider === "google" || provider === "vertex") && REJECT_NON_CHAT.test(model.id)) return false;
    if (provider === "vertex" && /[/@]/.test(model.id)) return false;
    return generationOf(model.id) >= (POLICIES[provider].minGeneration ?? 0);
  });
  const bare = new Set(passing.filter((model) => !/-\d{8}$/.test(model.id)).map((model) => model.id));
  return passing.filter((model) => !/-\d{8}$/.test(model.id) || !bare.has(bareAliasOf(model.id)));
}

function carriedCodenames(catalog: CatalogLookup, table: ModelTable, provider: string): Set<string> {
  return new Set(
    catalog(table)
      .filter((row) => row.provider === provider)
      .map((row) => row.codename),
  );
}

function mediaCandidates(
  models: SourceModel[],
  provider: string,
  table: ModelTable,
  catalog: CatalogLookup,
): SourceModel[] {
  const kind = table === "imageSections" ? "image" : "video";
  if (kind === "video" && provider !== "google" && provider !== "openrouter") return [];
  if (kind === "image" && provider !== "google" && provider !== "openrouter") return [];
  const carried = carriedCodenames(catalog, table, provider);
  return models.filter(
    (model) =>
      outputIs(model, kind) &&
      !REJECT_MEDIA.test(model.id) &&
      !carriedHas(carried, provider, model.id) &&
      (provider !== "google" || (kind === "image" ? model.id.includes("-image") : model.id.startsWith("veo-"))),
  );
}

function isSourceCatalog(value: unknown): value is SourceCatalog {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  return [...new Set(Object.values(POLICIES).map((policy) => policy.source))].every((key) => {
    const entry = source[key];
    if (!entry || typeof entry !== "object" || !("models" in entry)) return false;
    const models = (entry as { models: unknown }).models;
    return (
      !!models &&
      typeof models === "object" &&
      Object.values(models).every((model) => {
        if (!model || typeof model !== "object") return false;
        const row = model as Record<string, unknown>;
        const modalities = row.modalities as Record<string, unknown> | undefined;
        const cost = row.cost as Record<string, unknown> | undefined;
        const strings = (items: unknown): boolean =>
          items === undefined || (Array.isArray(items) && items.every((item) => typeof item === "string"));
        const price = (amount: unknown): boolean =>
          amount === undefined || (typeof amount === "number" && Number.isFinite(amount) && amount >= 0);
        return (
          typeof row.id === "string" &&
          row.id.length > 0 &&
          (row.family === undefined || typeof row.family === "string") &&
          (row.release_date === undefined || typeof row.release_date === "string") &&
          (row.tool_call === undefined || typeof row.tool_call === "boolean") &&
          (row.reasoning === undefined || typeof row.reasoning === "boolean") &&
          (row.structured_output === undefined || typeof row.structured_output === "boolean") &&
          (modalities === undefined ||
            (typeof modalities === "object" &&
              modalities !== null &&
              strings(modalities.input) &&
              strings(modalities.output))) &&
          (cost === undefined || (typeof cost === "object" && cost !== null && price(cost.input) && price(cost.output)))
        );
      })
    );
  });
}

function isSeenEntries(value: unknown): value is SeenEntry[] {
  return (
    Array.isArray(value) &&
    (value as unknown[]).every((item) => {
      if (item === null || typeof item !== "object") return false;
      const entry = item as Record<string, unknown>;
      return (
        typeof entry.provider === "string" &&
        ["llmSections", "imageSections", "videoSections"].includes(entry.table as string) &&
        typeof entry.codename === "string" &&
        (entry.releaseDate === null || typeof entry.releaseDate === "string") &&
        typeof entry.offeredAt === "string"
      );
    })
  );
}

export function findCandidates(
  source: SourceCatalog,
  seen: SeenEntry[],
  catalog: CatalogLookup = catalogRows,
): { candidates: Candidate[]; free: Candidate[]; covered: string[] } {
  const seenKeys = new Set(seen.map(seenKey));
  const candidates: Candidate[] = [];
  const free: Candidate[] = [];
  const covered: string[] = [];
  for (const [provider, policy] of Object.entries(POLICIES)) {
    const models = Object.values(source[policy.source].models);
    const carried = carriedCodenames(catalog, "llmSections", provider);
    const selection =
      policy.tier === "generation"
        ? { drafts: generationCandidates(models, provider, carried), covered: [] }
        : familyCandidates(models, provider, carried);
    covered.push(...selection.covered);
    for (const [table, drafts] of [
      ["llmSections", selection.drafts],
      ["imageSections", mediaCandidates(models, provider, "imageSections", catalog)],
      ["videoSections", mediaCandidates(models, provider, "videoSections", catalog)],
    ] as const) {
      for (const model of drafts) {
        const codename = provider === "zai" ? `zai/${model.id}` : model.id;
        const candidate = { provider, table, model, codename };
        if (seenKeys.has(seenKey(candidate))) continue;
        if (model.id.endsWith(":free")) free.push(candidate);
        else candidates.push(candidate);
      }
    }
  }
  return { candidates, free, covered };
}

function renderRow(candidate: Candidate): string {
  const { provider, table, model, codename } = candidate;
  const row: Record<string, unknown> = { provider, codename };
  if (table === "llmSections") {
    const input = model.modalities?.input ?? [];
    if (model.tool_call) row.hasTools = true;
    if (input.includes("image")) row.seesImages = true;
    if (input.includes("video")) row.seesVideos = true;
    if (provider === "google" || provider === "vertex") row.seesYoutube = true;
    if (model.reasoning) row.isReasoning = true;
    if (model.structured_output) row.supportsStructoutput = true;
    if (REQUIRED_ALTERNATION_PROVIDERS.has(provider)) row.strictRoleAlternation = true;
    if (REQUIRED_PREFIX_PROVIDERS.has(provider)) row.supportsPrefixCompletion = true;
    if (provider !== "openrouter" || !FLOATING_ALIAS.test(model.id)) {
      if (typeof model.cost?.input === "number") row.inputPricePerMillion = model.cost.input;
      if (typeof model.cost?.output === "number") row.outputPricePerMillion = model.cost.output;
    }
  }
  row.desc = MODEL_DRIFT_TODO;
  const reviewFlags =
    table === "llmSections"
      ? [
          "isFree",
          "isUncensored",
          "hasTools",
          "seesImages",
          "seesVideos",
          "seesYoutube",
          "isReasoning",
          "supportsStructoutput",
        ]
      : table === "imageSections"
        ? ["isFree", "isUncensored"]
        : ["isFree"];
  const fields = Object.entries(row)
    .filter(([key]) => !reviewFlags.includes(key))
    .map(([key, value]) => `        ${key}: ${JSON.stringify(value)},`);
  const reviewFields = reviewFlags.map((flag) => `        ${row[flag] === true ? "" : "// "}${flag}: true,`);
  return `      {\n${[...fields.slice(0, 2), ...reviewFields, ...fields.slice(2)].join("\n")}\n      }`;
}

function sectionFor(table: ModelTable, provider: string): string {
  if (table === "llmSections") {
    return (
      {
        google: "Google Models",
        vertex: "Vertex AI Models",
        zai: "Z.ai General API Models",
        zaicoding: "Z.ai (Coding) Models",
        anthropic: "Anthropic Models",
        deepseek: "DeepSeek Models",
        openrouter: "OpenRouter Models",
        nvidia: "NVIDIA NIM Models",
      }[provider] ?? ""
    );
  }
  if (table === "imageSections") {
    return provider === "google" ? "Google Gemini Image Generation Models" : "OpenRouter Image Generation Models";
  }
  return provider === "google" ? "Google Veo Video Generation Models" : "OpenRouter Video Generation Models";
}

export function insertRows(source: string, candidates: Candidate[]): string {
  const file = ts.createSourceFile("models.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const insertions: Array<{ at: number; rows: string[] }> = [];
  for (const candidate of candidates) {
    const anchor = sectionFor(candidate.table, candidate.provider);
    let position: number | undefined;
    function visit(node: ts.Node): void {
      if (ts.isObjectLiteralExpression(node)) {
        const comment = node.properties.find(
          (property) => ts.isPropertyAssignment(property) && property.name.getText(file) === "comment",
        );
        const rows = node.properties.find(
          (property) => ts.isPropertyAssignment(property) && property.name.getText(file) === "rows",
        );
        if (
          comment &&
          ts.isPropertyAssignment(comment) &&
          ts.isStringLiteral(comment.initializer) &&
          comment.initializer.text.startsWith(anchor) &&
          rows &&
          ts.isPropertyAssignment(rows) &&
          ts.isArrayLiteralExpression(rows.initializer)
        )
          position = rows.initializer.getEnd() - 1;
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    if (position === undefined) throw new Error(`Missing catalog section ${candidate.table}/${candidate.provider}`);
    const group = insertions.find((entry) => entry.at === position);
    if (group) group.rows.push(renderRow(candidate));
    else insertions.push({ at: position, rows: [renderRow(candidate)] });
  }
  let output = source;
  for (const insertion of insertions.sort((a, b) => b.at - a.at)) {
    const before = output.slice(0, insertion.at).trimEnd();
    const after = output.slice(insertion.at);
    output = `${before}\n${insertion.rows.map((row) => `${row},`).join("\n")}\n    ${after}`;
  }
  return output;
}

function reviewLabel(provider: string, table: ModelTable, codename: string): string {
  const media = table === "llmSections" ? "" : `, ${table.replace("Sections", "")}`;
  return `\`${codename}\` (${provider}${media})`;
}

function sourceAdvisories(source: SourceCatalog): { absent: string[]; unsupportedMedia: string[] } {
  const absent: string[] = [];
  for (const table of ["llmSections", "imageSections", "videoSections"] as const) {
    for (const row of catalogRows(table)) {
      // other-model is the user-supplied OpenRouter codename slot, so no source can ever list it.
      if (row.isDeprecated || row.codename === "other-model") continue;
      const sourceKey = row.provider === "vertexexpress" ? "google-vertex" : POLICIES[row.provider]?.source;
      if (!sourceKey) continue;
      const ids = source[sourceKey].models;
      const bare = row.provider === "zai" ? row.codename.replace(/^zai\//, "") : row.codename;
      if (!ids[bare] && !Object.values(ids).some((model) => model.id === bare)) {
        absent.push(reviewLabel(row.provider, table, row.codename));
      }
    }
  }
  const unsupportedMedia: string[] = [];
  for (const [provider, sourceKey] of [
    ["nvidia", "nvidia"],
    ["vertex", "google-vertex"],
  ] as const) {
    for (const model of Object.values(source[sourceKey].models)) {
      if (!outputIs(model, "image") && !outputIs(model, "video")) continue;
      const table = outputIs(model, "video") ? "videoSections" : "imageSections";
      const carried = catalogRows(table).some((row) => row.provider === provider && row.codename === model.id);
      if (!carried) unsupportedMedia.push(reviewLabel(provider, table, model.id));
    }
  }
  return { absent, unsupportedMedia };
}

const rowsLabel = (count: number): string => (count === 1 ? "1 new row" : `${count} new rows`);

/**
 * Aphel's openers for the drift PR, picked by ISO week so consecutive weekly runs never repeat.
 * Every opener must work for any row count, including zero (a run that only records free variants).
 */
const APHEL_GREETINGS: ((count: number) => string)[] = [
  (count) =>
    `Ugh. The model list changed again. I drafted ${rowsLabel(count)} nobody asked for. They're in the checklist below. Write their descriptions or delete them, I don't care which. Okay, I care a little. Delete the bad ones.`,
  (count) =>
    `It's 3 AM on a Monday and I'm doing catalog maintenance. This is the life Bredrumb chose for me. ${rowsLabel(count)}, checklist below. Try not to make it more complicated than it needs to be.`,
  (count) =>
    `...Oh. You're here. Some providers released models this week, because of course they did. ${rowsLabel(count)} drafted. The descriptions say TODO because I refuse to write marketing copy.`,
  (count) =>
    `Another week, another batch of models named like someone fell asleep on a keyboard. ${rowsLabel(count)}. The prices came from a website. You get to check them against reality.`,
  (count) =>
    `I was going to sleep through this one. The cron job had other plans. ${rowsLabel(count)} drafted, flags inferred, nothing verified. Verifying is your part. That's called teamwork, apparently.`,
  (count) => `Here. ${rowsLabel(count)}. Don't make that face. I didn't release them, I just found them.`,
  (count) =>
    `Fun fact: every model in here is "the most capable yet." All ${rowsLabel(count)} of them. Funny how that works. The checklist is below whenever you're done being impressed.`,
  (count) =>
    `Hi. It's me, the one who reads changelogs at 3 AM so you don't have to. ${rowsLabel(count)} this week. I'd say it gets easier, but it doesn't.`,
  (count) =>
    `The catalog drifted. Things drift. Continents, orbits, model catalogs... me, away from the sun. Anyway. ${rowsLabel(count)}.`,
  (count) =>
    `I put on some noise rock and diffed the catalog. Both were loud. ${rowsLabel(count)} below. If a price looks too good to be true, it is, so open the provider's pricing page.`,
];

function isoWeek(date: Date): number {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // ISO weeks belong to the year of their Thursday.
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  return Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

function collapsible(summary: string, items: string[], intro?: string): string[] {
  if (items.length === 0) return [];
  return [
    "<details>",
    `<summary>${summary} (${items.length})</summary>`,
    "",
    ...(intro ? [intro, ""] : []),
    ...items.map((item) => `- ${item}`),
    "",
    "</details>",
    "",
  ];
}

/**
 * Render the drift PR body in Aphel's voice.
 * GitHub turns every single newline in a PR body into a hard break, so each paragraph and list item
 * must stay on one source line.
 */
export function report(
  candidates: Candidate[],
  free: Candidate[],
  advisories: ReturnType<typeof sourceAdvisories>,
  now = new Date(),
  covered: string[] = [],
): string {
  const greeting = APHEL_GREETINGS[isoWeek(now) % APHEL_GREETINGS.length](candidates.length);
  const byProvider = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    byProvider.set(candidate.provider, [...(byProvider.get(candidate.provider) ?? []), candidate]);
  }
  const lines = [
    greeting,
    "",
    "## Review",
    "",
    "1. Verify each row against the provider. Fixed OpenRouter models carry a drafted fallback price; floating aliases have none.",
    `2. Replace each \`${MODEL_DRIFT_TODO}\` English description, then tick its box below. Avoid "latest" in descriptions, and fix older rows a new model makes stale. Translations are optional and fall back to English.`,
    "3. Commented flags had no source evidence. Uncomment one only after verifying it, and delete the rest. `isFree` and `isUncensored` never have source metadata.",
    "4. Moving `isDefault` or `isSmartest` to a newer row is fine with a stated reason. Each provider keeps exactly one of each.",
    `5. Keep each provider at ${MAX_ACTIVE_ROWS_PER_PROVIDER} or fewer active rows per table, so its whole list fits one Discord select (25 options, with room for registered models). Decline extras, or set \`isDeprecated: true\` on older rows to retire them. Providers over the limit are marked below.`,
    "6. Decline a model by deleting its row but keeping its seen entry. Do not close this PR unmerged: that discards every seen entry, and the rows return next week.",
    "7. CI stays red until every description is written and every provider fits the limit. If only **Check model drift review** fails, the rows work and only review remains.",
    "",
    `## Drafted rows (${candidates.length})`,
    "",
  ];
  for (const [provider, rows] of byProvider) {
    lines.push(`### ${provider}`, "");
    for (const table of new Set(rows.map((row) => row.table))) {
      const active =
        catalogRows(table).filter((row) => row.provider === provider && !row.isDeprecated).length +
        rows.filter((row) => row.table === table).length;
      if (active <= MAX_ACTIVE_ROWS_PER_PROVIDER) continue;
      const kind = table === "llmSections" ? "LLM" : table.replace("Sections", "");
      lines.push(
        `**Over the limit:** ${active} active ${kind} rows if every draft is kept. Decline or deprecate ${active - MAX_ACTIVE_ROWS_PER_PROVIDER}.`,
        "",
      );
    }
    for (const row of rows) {
      const media = row.table === "llmSections" ? "" : ` (${row.table.replace("Sections", "")})`;
      lines.push(`- [ ] \`${row.codename}\`${media}`);
    }
    lines.push("");
  }
  lines.push(
    ...collapsible(
      "OpenRouter models covered by catalog aliases",
      covered,
      "A carried floating alias covers its models.dev family regardless of the alias's recorded release date. Fixed versions in that family are not drafted.",
    ),
    ...collapsible(
      "Free variants recorded but not drafted",
      free.map((item) => reviewLabel(item.provider, item.table, item.codename)),
      "These are marked seen. Add a row by hand if one is worth carrying.",
    ),
    ...collapsible(
      "Catalog rows missing from models.dev",
      advisories.absent,
      "A model missing from models.dev is not evidence of retirement.",
    ),
    ...collapsible(
      "Provider media models needing implementation review",
      advisories.unsupportedMedia,
      "The provider serves these, but TomoriBot has no route for them yet.",
    ),
    "---",
    "",
    "<sub>Opened automatically by the weekly model drift workflow, which compares the catalog against [models.dev](https://models.dev), a community database of model prices and capabilities.</sub>",
  );
  return `${lines.join("\n").trimEnd()}\n`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fixtureIndex = args.indexOf("--fixture");
  const reportIndex = args.indexOf("--report");
  const write = args.includes("--write");
  const baseline = args.includes("--baseline");
  if (fixtureIndex !== -1 && !args[fixtureIndex + 1]) throw new Error("--fixture needs a path");
  if (reportIndex !== -1 && !args[reportIndex + 1]) throw new Error("--report needs a path");
  const raw =
    fixtureIndex !== -1
      ? await Bun.file(args[fixtureIndex + 1]).json()
      : await fetch(SOURCE_URL).then((response) => {
          if (!response.ok) throw new Error(`models.dev returned ${response.status}`);
          return response.json();
        });
  if (!isSourceCatalog(raw)) throw new Error("models.dev catalog is missing a required provider or model id");
  const seenRaw: unknown = await Bun.file(SEEN_URL).json();
  if (!isSeenEntries(seenRaw)) throw new Error("Invalid model drift seen file");
  const seen = seenRaw;
  const { candidates, free, covered } = findCandidates(raw, seen);
  for (const candidate of candidates) console.log(`${candidate.provider}\t${candidate.table}\t${candidate.codename}`);
  for (const item of covered) console.log(item);
  console.log(`Drafts: ${candidates.length}; free variants: ${free.length}; alias-covered: ${covered.length}`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `title=Model catalog drift: ${rowsLabel(candidates.length)}
`,
    );
  }
  if (reportIndex !== -1)
    await writeFile(args[reportIndex + 1], report(candidates, free, sourceAdvisories(raw), new Date(), covered));
  if (!write && !baseline) return;
  const offeredAt = new Date().toISOString().slice(0, 10);
  const additions = [...candidates, ...free].map((candidate) => ({
    provider: candidate.provider,
    table: candidate.table,
    codename: candidate.codename,
    releaseDate: candidate.model.release_date ?? null,
    offeredAt,
  }));
  if (additions.length === 0) return;
  const catalog = baseline ? null : await Bun.file(CATALOG_URL).text();
  const updatedCatalog = catalog === null ? null : insertRows(catalog, candidates);
  await writeFile(SEEN_URL, `${JSON.stringify([...seen, ...additions], null, 2)}\n`);
  if (baseline) return;
  if (updatedCatalog !== null) await writeFile(CATALOG_URL, updatedCatalog);
}

if (import.meta.main) await main();
