import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { seedPersonasFromCatalog } from "@/db/seed/catalog/personaSeed";
import { personaSections } from "@/db/seed/catalog/personas";
import type { TomoriPresetRow } from "@/types/db/schema";
import { personaRepository } from "@/utils/db/repositories/PersonaRepository";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

const PROBE_SERVER = "_persona_nsfw_flag_probe";
const catalogRows = personaSections.flatMap((section) => section.rows);
const nsfwRow = catalogRows.find((row) => row.isNsfw === true);
const sfwRow = catalogRows.find((row) => row.isNsfw !== true);

async function loadPreset(lineageId: number, language: string): Promise<TomoriPresetRow> {
  const [row] = await testSql<TomoriPresetRow[]>`
    SELECT * FROM persona_presets WHERE preset_lineage_id = ${lineageId} AND preset_language = ${language}`;
  return row;
}

describe.skipIf(!DB_TESTS_AVAILABLE)("persona NSFW flag", () => {
  beforeAll(async () => {
    if (!nsfwRow || !sfwRow) throw new Error("The persona catalog needs one NSFW and one SFW preset");
    await setupTestDb();
    await testSql`DELETE FROM servers WHERE server_disc_id = ${PROBE_SERVER}`;
  });

  afterAll(async () => {
    if (DB_TESTS_AVAILABLE) {
      await testSql`DELETE FROM servers WHERE server_disc_id = ${PROBE_SERVER}`;
    }
  });

  it("seeds isNsfw and restores it on a re-seed, so the ON CONFLICT update carries the flag", async () => {
    if (!nsfwRow || !sfwRow) return;
    await testSql`
      UPDATE persona_presets SET is_nsfw = false
      WHERE preset_lineage_id = ${nsfwRow.lineageId} AND preset_language = ${nsfwRow.language}`;

    await seedPersonasFromCatalog(testSql);

    expect((await loadPreset(nsfwRow.lineageId, nsfwRow.language)).is_nsfw).toBe(true);
    expect((await loadPreset(sfwRow.lineageId, sfwRow.language)).is_nsfw).toBe(false);
  });

  it("copies the preset flag onto a persona created from it", async () => {
    if (!nsfwRow) return;
    await seedPersonasFromCatalog(testSql);
    const preset = await loadPreset(nsfwRow.lineageId, nsfwRow.language);
    const [server] = await testSql`INSERT INTO servers (server_disc_id) VALUES (${PROBE_SERVER}) RETURNING server_id`;

    const alter = await personaRepository.createPresetPointerAlterPersona({
      serverId: server.server_id,
      nickname: "Mirri",
      preset,
    });

    expect(alter?.is_nsfw).toBe(true);
  });
});
