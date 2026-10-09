import { describe, expect, it } from "bun:test";
import ts from "typescript";
import {
  MAX_ACTIVE_ROWS_PER_PROVIDER,
  MODEL_DRIFT_TODO,
  collectModelDriftTodoViolations,
  collectProviderRowLimitViolations,
} from "@/db/seed/catalog/modelSeed";
import {
  findCandidates,
  insertRows,
  report,
  seenKey,
  type CatalogLookup,
  type ModelTable,
  type SeenEntry,
  type SourceModel,
} from "../../../scripts/checks/modelDrift";

const fixture = new URL("../../fixtures/modelDrift.json", import.meta.url);
const catalog = new URL("../../../src/db/seed/catalog/models.ts", import.meta.url);
const catalogSnapshot: Record<ModelTable, { provider: string; codename: string }[]> = await Bun.file(
  new URL("../../fixtures/modelDriftCatalog.json", import.meta.url),
).json();
// The source fixture is frozen, so candidates are computed against the catalog as it stood when the
// fixture was taken. The live catalog absorbs these models once a drift PR merges.
const frozenCatalog: CatalogLookup = (table) => catalogSnapshot[table];

describe("model drift", () => {
  it("treats a carried OpenRouter alias as covering its family despite stale release dates", async () => {
    const source = await Bun.file(fixture).json();
    const models: SourceModel[] = [
      { id: "~openai/gpt-sol-latest", family: "gpt-sol", release_date: "2026-01-01" },
      { id: "openai/gpt-6-sol", family: "gpt-sol", release_date: "2026-02-01" },
      { id: "openai/gpt-6.1-sol", family: "gpt-sol", release_date: "2026-03-01" },
      { id: "openai/gpt-luna-old", family: "gpt-luna", release_date: "2026-01-01" },
      { id: "openai/gpt-luna-new", family: "gpt-luna", release_date: "2026-02-01" },
      { id: "~openai/gpt-luna-latest", family: "gpt-luna", release_date: "2026-01-01" },
      { id: "~openai/gpt-unknown-latest" },
      { id: "openai/gpt-unknown-old", family: "unknown", release_date: "2026-01-01" },
      { id: "openai/gpt-unknown-new", family: "unknown", release_date: "2026-02-01" },
    ].map((model) => ({ ...model, modalities: { output: ["text"] } }));
    source.openrouter.models = Object.fromEntries(models.map((model) => [model.id, model]));
    const lookup: CatalogLookup = (table) =>
      table === "llmSections"
        ? ["~openai/gpt-sol-latest", "openai/gpt-luna-old", "~openai/gpt-unknown-latest", "openai/gpt-unknown-old"].map(
            (codename) => ({ provider: "openrouter", codename }),
          )
        : [];
    const { candidates, covered } = findCandidates(source, [], lookup);
    expect(candidates.some((row) => row.model.family === "gpt-sol")).toBe(false);
    expect(covered.some((item) => item.includes("openai/gpt-6.1-sol") && item.includes("~openai/gpt-sol-latest"))).toBe(
      true,
    );
    for (const codename of ["openai/gpt-luna-new", "~openai/gpt-luna-latest", "openai/gpt-unknown-new"]) {
      expect(candidates.some((row) => row.codename === codename)).toBe(true);
    }
    const body = report(candidates, [], { absent: [], unsupportedMedia: [] }, new Date(), covered);
    expect(body).toContain(covered[0]);
    source.nvidia.models = source.openrouter.models;
    const nvidiaLookup: CatalogLookup = (table) => lookup(table).map((row) => ({ ...row, provider: "nvidia" }));
    expect(
      findCandidates(source, [], nvidiaLookup).candidates.some(
        (row) => row.provider === "nvidia" && row.codename === "openai/gpt-6.1-sol",
      ),
    ).toBe(true);
  });

  it("declines one provider row without suppressing another", async () => {
    const source = await Bun.file(fixture).json();
    const first = findCandidates(source, [], frozenCatalog);
    const google = first.candidates.find(
      (item) => item.provider === "google" && item.codename === "gemini-3.1-pro-preview-customtools",
    );
    const vertex = first.candidates.find(
      (item) => item.provider === "vertex" && item.codename === "gemini-3.1-pro-preview-customtools",
    );
    expect(google).toBeDefined();
    expect(vertex).toBeDefined();
    if (!google || !vertex) throw new Error("Fixture candidate missing");
    const seen: SeenEntry = {
      provider: "google",
      table: "llmSections",
      codename: google.codename,
      releaseDate: null,
      offeredAt: "2026-01-01",
    };
    expect(seenKey(seen)).not.toBe(seenKey(vertex));
    const second = findCandidates(source, [seen], frozenCatalog).candidates;
    expect(second.some((item) => item.provider === "google" && item.codename === seen.codename)).toBe(false);
    expect(second.some((item) => item.provider === "vertex" && item.codename === seen.codename)).toBe(true);
  });

  it("does not draft media routes that the provider cannot execute", async () => {
    const source = await Bun.file(fixture).json();
    const { candidates } = findCandidates(source, [], frozenCatalog);
    expect(candidates.some((item) => item.provider === "nvidia" && item.table !== "llmSections")).toBe(false);
    expect(candidates.some((item) => item.provider === "vertex" && item.table !== "llmSections")).toBe(false);
  });

  it("does not reoffer models already in the catalog", async () => {
    const source = await Bun.file(fixture).json();
    expect(source.google.models["gemini-3.1-pro-preview"].modalities.output).toEqual(["text"]);
    expect(source.google.models["gemini-3-pro-image"].modalities.output).toContain("image");
    const { candidates } = findCandidates(source, [], frozenCatalog);
    expect(candidates.some((item) => item.provider === "google" && item.codename === "gemini-3.1-pro-preview")).toBe(
      false,
    );
    expect(candidates.some((item) => item.provider === "google" && item.codename === "gemini-3-pro-image")).toBe(false);
  });

  it("drafts fixed OpenRouter prices but leaves floating aliases unpriced", async () => {
    const source = await Bun.file(fixture).json();
    const candidates = findCandidates(source, [], frozenCatalog).candidates;
    const openrouter = candidates.find(
      (item) => item.provider === "openrouter" && item.codename === "~openai/gpt-latest",
    );
    const fixed = candidates.find((item) => item.provider === "openrouter" && item.codename === "z-ai/glm-5.2");
    const zai = candidates.find((item) => item.provider === "zai" && item.codename === "zai/glm-5.2");
    const google = candidates.find(
      (item) => item.provider === "google" && item.codename === "gemini-3.1-pro-preview-customtools",
    );
    if (!openrouter || !fixed || !google || !zai) throw new Error("Fixture candidates missing");
    expect(openrouter.model.cost?.input).toBeDefined();
    const text = await Bun.file(catalog).text();
    const inserted = insertRows(text, [openrouter, fixed, google, zai]);
    const draftedRow = (codename: string): string => {
      const start = inserted.indexOf(`codename: "${codename}"`);
      if (start < 0) throw new Error(`Drafted row missing: ${codename}`);
      return inserted.slice(start, inserted.indexOf(`desc: "${MODEL_DRIFT_TODO}"`, start));
    };
    expect(draftedRow(openrouter.codename)).not.toContain("inputPricePerMillion");
    expect(draftedRow(openrouter.codename)).not.toContain("outputPricePerMillion");
    expect(draftedRow(fixed.codename)).toContain("inputPricePerMillion");
    expect(draftedRow(fixed.codename)).toContain("outputPricePerMillion");
    expect(draftedRow(google.codename)).toContain("inputPricePerMillion");
    expect(draftedRow(google.codename)).toContain("\n        seesImages: true,");
    expect(draftedRow(google.codename)).toContain("\n        seesVideos: true,");
    expect(draftedRow(zai.codename)).toContain("// seesImages: true,");
    expect(draftedRow(zai.codename)).toContain("// isUncensored: true,");
  });

  it("inserts in the selected section without changing adjacent catalog text", async () => {
    const source = await Bun.file(fixture).json();
    const text = await Bun.file(catalog).text();
    const candidate = findCandidates(source, [], frozenCatalog).candidates.find(
      (item) => item.provider === "google" && item.table === "imageSections",
    );
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error("Fixture candidate missing");
    const inserted = insertRows(text, [candidate]);
    const compiled = ts.transpileModule(inserted, {
      compilerOptions: { target: ts.ScriptTarget.Latest },
      reportDiagnostics: true,
    });
    expect(compiled.diagnostics).toHaveLength(0);
    expect(inserted).toContain(candidate.codename);
    expect(inserted).toContain(MODEL_DRIFT_TODO);
    const draftStart = inserted.indexOf(`codename: "${candidate.codename}"`);
    const draftEnd = inserted.indexOf("},", inserted.indexOf(`desc: "${MODEL_DRIFT_TODO}"`, draftStart));
    expect(inserted.slice(draftStart, draftEnd)).not.toContain("i18n:");
    expect(inserted.slice(0, text.indexOf("export const imageSections"))).toBe(
      text.slice(0, text.indexOf("export const imageSections")),
    );
  });

  it("blocks the generated English placeholder and permits missing translations", () => {
    const row = { provider: "google", codename: "sample", desc: MODEL_DRIFT_TODO };
    expect(collectModelDriftTodoViolations("llms", [row])).toHaveLength(1);
    row.desc = "Reviewed description";
    expect(collectModelDriftTodoViolations("llms", [row])).toEqual([]);
    expect(collectModelDriftTodoViolations("llms", [{ ...row, i18n: { ja: MODEL_DRIFT_TODO } }])).toHaveLength(1);
  });

  it("renders a reviewable body that GitHub will not break into hard line breaks", async () => {
    const { candidates, free } = findCandidates(await Bun.file(fixture).json(), [], frozenCatalog);
    const body = report(candidates, free, { absent: [], unsupportedMedia: [] }, new Date("2026-10-05T03:17:00Z"));
    for (const candidate of candidates) expect(body).toContain(`- [ ] \`${candidate.codename}\``);
    const paragraphs = body.split("\n\n").filter((block) => !/^(#|- |\d+\. |<)/.test(block.trim()));
    for (const paragraph of paragraphs) expect(paragraph.trim()).not.toContain("\n");
  });

  it("rotates Aphel's greeting between consecutive weekly runs", () => {
    const opener = (date: string) =>
      report([], [], { absent: [], unsupportedMedia: [] }, new Date(date)).split("\n")[0];
    expect(opener("2026-10-05T03:17:00Z")).not.toBe(opener("2026-10-12T03:17:00Z"));
  });

  it("caps active rows per provider so one Discord select shows the whole list", () => {
    const rows = (count: number, provider = "openrouter", isDeprecated = false) =>
      Array.from({ length: count }, (_, index) => ({
        provider,
        codename: `${provider}-model-${index}`,
        isDeprecated,
        desc: "Model",
      }));
    expect(collectProviderRowLimitViolations("llms", rows(MAX_ACTIVE_ROWS_PER_PROVIDER))).toEqual([]);
    expect(collectProviderRowLimitViolations("llms", rows(MAX_ACTIVE_ROWS_PER_PROVIDER + 1))).toHaveLength(1);
    expect(
      collectProviderRowLimitViolations("llms", [
        ...rows(MAX_ACTIVE_ROWS_PER_PROVIDER),
        ...rows(5, "openrouter", true).map((row) => ({ ...row, codename: `${row.codename}-old` })),
        ...rows(MAX_ACTIVE_ROWS_PER_PROVIDER, "google"),
      ]),
    ).toEqual([]);
  });
});
