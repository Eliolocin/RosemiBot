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
  decisionSource,
  insertRows,
  report,
  seenKey,
  sourceAdvisories,
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
  it("offers every valid Decision entry, including new families, aliases, and free variants", async () => {
    const source = await Bun.file(fixture).json();
    const payload = await Bun.file(new URL("../../fixtures/openrouterDecisionDrift.json", import.meta.url)).json();
    source["openrouter-decisions"] = decisionSource(payload);
    const { candidates, free } = findCandidates(source, [], frozenCatalog);
    const decisions = candidates.filter((row) => row.table === "decisionSections");
    const expected = Object.keys(source["openrouter-decisions"].models).filter((id) => id !== "typesafe/jev-1.13");
    expect(decisions.map((row) => row.codename).sort()).toEqual(expected.sort());
    expect(decisions.some((row) => row.codename.endsWith(":free"))).toBe(true);
    expect(decisions.some((row) => row.codename.startsWith("~"))).toBe(true);
    expect(free.some((row) => row.table === "decisionSections")).toBe(false);
    expect(candidates.some((row) => row.table === "llmSections" && expected.includes(row.codename))).toBe(false);

    const seen: SeenEntry[] = decisions.map((row) => ({
      provider: row.provider,
      table: row.table,
      codename: row.codename,
      releaseDate: null,
      offeredAt: "2026-01-01",
    }));
    expect(findCandidates(source, seen, frozenCatalog).candidates.some((row) => row.table === "decisionSections")).toBe(
      false,
    );
    const advisories = sourceAdvisories(source);
    expect(advisories.rejectedDecisions?.sort()).toEqual([
      "respan/span-01",
      "respan/span-01-lite",
      "respan/span-01-lite:free",
    ]);
    const body = report(decisions, [], advisories);
    for (const id of advisories.rejectedDecisions ?? []) expect(body).toContain(id);

    const inserted = insertRows(await Bun.file(catalog).text(), decisions);
    const compiled = ts.transpileModule(inserted, { reportDiagnostics: true });
    expect(compiled.diagnostics).toHaveLength(0);
    const drafts = inserted.slice(inserted.indexOf("export const decisionSections"));
    for (const row of decisions) {
      const start = drafts.lastIndexOf(`codename: ${JSON.stringify(row.codename)}`);
      const end = drafts.indexOf(`desc: "${MODEL_DRIFT_TODO}"`, start);
      const text = drafts.slice(start, end);
      expect(text).toContain(`inputTokenLimit: ${row.model.limit?.input}`);
      expect(text).toContain(`inputPricePerMillion: ${row.model.cost?.input}`);
      expect(text).toContain(`outputPricePerMillion: ${row.model.cost?.output}`);
      expect(text.includes("\n        seesImages: true,")).toBe(
        row.model.modalities?.input?.includes("image") === true,
      );
      expect(text).not.toContain("isFree");
    }

    const rejected = payload.data.find((row: { id: string }) => row.id === "respan/span-01");
    rejected.context_length = 32768;
    source["openrouter-decisions"] = decisionSource(payload);
    expect(
      findCandidates(source, seen, frozenCatalog).candidates.some(
        (row) => row.codename === rejected.id && row.table === "decisionSections",
      ),
    ).toBe(true);
  });

  it("does not reoffer carried or declined Decision models but still offers new ones", async () => {
    const source = await Bun.file(fixture).json();
    source["openrouter-decisions"] = decisionSource(
      await Bun.file(new URL("../../fixtures/openrouterDecisionDrift.json", import.meta.url)).json(),
    );
    const seen: SeenEntry[] = await Bun.file(
      new URL("../../../scripts/data/modelDriftSeen.json", import.meta.url),
    ).json();
    const uncarried = findCandidates(source, []).candidates.filter((row) => row.table === "decisionSections");
    expect(uncarried.length).toBeGreaterThan(0);
    const declinedKeys = new Set(seen.filter((entry) => entry.table === "decisionSections").map(seenKey));
    for (const row of uncarried) expect(declinedKeys.has(seenKey(row))).toBe(true);
    expect(findCandidates(source, seen).candidates.some((row) => row.table === "decisionSections")).toBe(false);
    // Use a synthetic model ID: Jev 1.14 is now in the curated catalog.
    const freshModel = "typesafe/jev-fixture-new";
    source["openrouter-decisions"].models[freshModel] = {
      ...source["openrouter-decisions"].models["typesafe/jev-1.13"],
      id: freshModel,
    };
    expect(
      findCandidates(source, seen)
        .candidates.filter((row) => row.table === "decisionSections")
        .map((row) => row.codename),
    ).toEqual([freshModel]);
    expect(() => decisionSource({ error: "unavailable" })).toThrow();
  });

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
    expect(candidates.some((item) => item.provider === "vertex" && item.table === "videoSections")).toBe(false);
  });

  it("drafts Gemini image models for Google and Vertex and inserts them into their own sections", async () => {
    const source = await Bun.file(fixture).json();
    const models: SourceModel[] = [
      { id: "gemini-nano-banana-2.1", modalities: { output: ["text", "image"] } },
      { id: "gemini-3.1-flash-lite-image", modalities: { output: ["text", "image"] } },
      { id: "imagen-4.0-generate-001", modalities: { output: ["image"] } },
      { id: "gemini-3.8-flash", modalities: { output: ["text"] } },
      { id: "veo-3.1-generate", modalities: { output: ["video"] } },
    ];
    for (const key of ["google", "google-vertex"]) {
      source[key].models = Object.fromEntries(models.map((model) => [model.id, model]));
    }
    const candidates = findCandidates(source, [], frozenCatalog).candidates.filter(
      (row) => (row.provider === "google" || row.provider === "vertex") && row.table === "imageSections",
    );
    for (const provider of ["google", "vertex"]) {
      expect(
        candidates
          .filter((row) => row.provider === provider)
          .map((row) => row.codename)
          .sort(),
      ).toEqual(["gemini-3.1-flash-lite-image", "gemini-nano-banana-2.1"]);
    }
    const inserted = insertRows(await Bun.file(catalog).text(), candidates);
    const file = ts.createSourceFile("models.ts", inserted, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const candidate of candidates) {
      let found = false;
      function visit(node: ts.Node): void {
        if (ts.isObjectLiteralExpression(node)) {
          const fields = new Map(
            node.properties
              .filter(ts.isPropertyAssignment)
              .map((property) => [property.name.getText(file), property.initializer]),
          );
          const desc = fields.get("desc");
          if (
            desc &&
            ts.isStringLiteral(desc) &&
            desc.text === MODEL_DRIFT_TODO &&
            fields.get("codename")?.getText(file) === JSON.stringify(candidate.codename) &&
            fields.get("provider")?.getText(file) === JSON.stringify(candidate.provider)
          ) {
            const section = node.parent.parent.parent;
            const comment = section.getText(file).match(/comment: "([^"]+)"/)?.[1];
            expect(comment).toBe(
              candidate.provider === "google"
                ? "Google Gemini Image Generation Models"
                : "Vertex AI Gemini Image Generation Models",
            );
            found = true;
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(file);
      expect(found).toBe(true);
    }
    const advisories = sourceAdvisories(source).unsupportedMedia;
    expect(advisories.some((item) => item.includes("gemini-nano-banana-2.1"))).toBe(false);
    expect(advisories.some((item) => item.includes("gemini-3.1-flash-lite-image"))).toBe(false);
    expect(advisories.some((item) => item.includes("imagen-4.0-generate-001"))).toBe(true);
    expect(advisories.some((item) => item.includes("veo-3.1-generate"))).toBe(true);
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
