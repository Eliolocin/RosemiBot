/**
 * Shared alter-persona import core.
 *
 * Factored out of the `/persona import` command so that both the slash command
 * and the "Import Now" button (on `/persona generate` and `/persona create`
 * success messages) drive identical business logic. This module is intentionally
 * UI-free: it performs all DB / storage / cache work and returns a structured
 * result, leaving the caller to render the outcome (embed, CV2 container, etc.).
 */

import type { Client, Guild } from "discord.js";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { personaRepository } from "@/utils/db/repositories";
import { presetRepository } from "@/utils/db/repositories/PresetRepository";
import { getMemoryLimits } from "@/utils/misc/memoryLimits";
import { log } from "@/utils/misc/logger";
import { resolvePersonaAvatarPublicUrl, uploadPersonaAvatarToStorage } from "@/utils/storage/avatarStorage";
import { getAllBaseTriggerWords } from "@/utils/text/localizer";
import { selectUnclaimedTriggerWords } from "@/utils/text/triggerWords";
import type { PresetExportData } from "@/types/preset/presetExport";

/**
 * Parameters for {@link importAlterPreset}.
 */
export interface ImportAlterPresetParams {
  /** Discord client, used to resolve a fallback avatar when no image is supplied. */
  client: Client;
  /** Guild the import targets, or null in DM contexts (alter import is guild-only). */
  guild: Guild | null;
  /** Server (or DM) scope ID the persona belongs to. */
  serverDiscId: string;
  /** Already-validated preset payload (e.g. from `validatePresetData`). */
  presetData: PresetExportData;
  /**
   * Lineage behavior: "preserve" keeps the incoming lineage id, "fork" mints a
   * fresh lineage so the alter is treated as an independent character.
   */
  identityMode: "preserve" | "fork";
  /** Raw persona image (PNG) used as the alter avatar, or null to inherit the main avatar. */
  avatarImageBuffer: Buffer | null;
}

/**
 * Discriminated result of {@link importAlterPreset}. On success the caller
 * receives everything needed to render a confirmation; on failure the `reason`
 * maps 1:1 to a localized error in the calling command/handler.
 */
export type ImportAlterPresetResult =
  | {
      ok: true;
      /** Newly created alter persona row id. */
      personaId: number;
      /** Imported persona nickname. */
      nickname: string;
      /** Triggers shown to the user (the unique set this alter owns after dropping overlaps). */
      displayedTriggers: string[];
      /** Count of non-overlapping triggers actually stored on the persona config. */
      uniqueTriggerCount: number;
      /** True when no avatar image was supplied and the main persona avatar was inherited. */
      usedMainAvatarFallback: boolean;
      /** True when the persona was imported without any usable trigger words. */
      hasNoTriggers: boolean;
      /** Nickname of the main persona (for the avatar-fallback notice). */
      mainPersonaNickname: string;
      /** Public display URL of the inherited avatar, when the fallback was used. */
      fallbackAvatarDisplayUrl: string | null;
    }
  | { ok: false; reason: "limit_reached"; current: number; max: number }
  | { ok: false; reason: "name_conflict"; name: string }
  | { ok: false; reason: "no_main_persona" }
  | { ok: false; reason: "config_failed" }
  | { ok: false; reason: "insert_failed" };

/**
 * Detects a Postgres unique-constraint violation so a duplicate persona name can
 * be surfaced as a friendly conflict instead of an unhandled error.
 * Mirrors the private helper in `commands/persona/import.ts`.
 *
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505"
  );
}

/**
 * Imports a preset as a new alter persona for a server.
 *
 * Performs limit/uniqueness validation, inserts the alter persona (as an official
 * preset pointer when one matches, otherwise as a full custom row), stores its
 * trigger words, persists the avatar, and invalidates the Tomori state cache.
 * All side effects are completed before returning; the caller only renders the
 * outcome.
 *
 * @returns A {@link ImportAlterPresetResult} describing success or the failure reason.
 */
export async function importAlterPreset(params: ImportAlterPresetParams): Promise<ImportAlterPresetResult> {
  const { client, guild, serverDiscId, presetData, identityMode, avatarImageBuffer } = params;

  const allPersonas = await personaRepository.loadAllForServer(serverDiscId);
  const personaLimits = getMemoryLimits();

  if (allPersonas.length >= personaLimits.maxPersonasPerServer) {
    return {
      ok: false,
      reason: "limit_reached",
      current: allPersonas.length,
      max: personaLimits.maxPersonasPerServer,
    };
  }

  const existingNames = allPersonas.map((persona) => normalizePersonaName(persona.persona_nickname));
  const importName = normalizePersonaName(presetData.tomori_nickname);
  if (existingNames.includes(importName)) {
    return { ok: false, reason: "name_conflict", name: presetData.tomori_nickname };
  }

  // Gather every trigger already claimed by existing personas so the new
  //    alter never steals an overlapping trigger word. Reserve the base words
  //    ("tomori" etc.) too: they belong to the main persona regardless of locale,
  //    and the loader's single-owner dedup would strip them from an alter anyway.
  const claimedTriggerWords = [
    ...getAllBaseTriggerWords(),
    ...allPersonas.flatMap((persona) => persona.trigger_words ?? []),
  ];

  // Filter the incoming triggers to the unique set this alter actually owns.
  //    This is what we store and display for both custom and official-preset
  //    (pointer) imports; the loader enforces the same ownership at read time.
  const importTriggers = presetData.trigger_words ?? [];
  const uniqueTriggers = selectUnclaimedTriggerWords(importTriggers, claimedTriggerWords, { lowercase: false });
  const matchingOfficialPreset = await presetRepository.findMatchingOfficialPresetForImport(presetData);
  const createdAsPointer = matchingOfficialPreset !== null;
  const displayedTriggers = uniqueTriggers;
  const hasNoTriggers = displayedTriggers.length === 0;

  // Alters copy structural config from the main persona, so it must exist.
  const mainPersona = allPersonas.find((persona) => !persona.is_alter);
  if (!mainPersona) {
    return { ok: false, reason: "no_main_persona" };
  }

  // Resolve avatar fallbacks: a raw reference for persistence (storage URL or
  //    bot avatar) and a public display URL for embeds/thumbnails.
  const fallbackAvatarReference =
    guild?.members.me?.displayAvatarURL({ extension: "png", size: 1024, forceStatic: true }) ??
    mainPersona.webhook_avatar_url ??
    client.user?.displayAvatarURL({ extension: "png", size: 1024, forceStatic: true }) ??
    null;
  const fallbackAvatarDisplayUrl =
    guild?.members.me?.displayAvatarURL({ extension: "png", size: 1024, forceStatic: true }) ??
    resolvePersonaAvatarPublicUrl(mainPersona.webhook_avatar_url) ??
    client.user?.displayAvatarURL({ extension: "png", size: 1024, forceStatic: true }) ??
    null;

  const importedLineageId = presetData.persona_lineage_id ?? null;
  let newAlterRow: { persona_id?: number } | undefined;
  try {
    newAlterRow = matchingOfficialPreset
      ? ((await personaRepository.createPresetPointerAlterPersona({
          serverId: mainPersona.server_id,
          nickname: presetData.tomori_nickname,
          preset: matchingOfficialPreset,
          personaLineageId: identityMode === "preserve" ? importedLineageId : null,
          useFreshLineage: identityMode === "fork",
          triggerWords: uniqueTriggers,
          personaPrompt: typeof presetData.persona_prompt === "string" ? presetData.persona_prompt : null,
        })) ?? undefined)
      : ((await personaRepository.createAlterPersona({
          serverId: mainPersona.server_id,
          nickname: presetData.tomori_nickname,
          attributes: presetData.attribute_list,
          attributePublicFlags: presetData.attribute_public_flags,
          sampleDialoguesIn: presetData.sample_dialogues_in,
          sampleDialoguesOut: presetData.sample_dialogues_out,
          personaLineageId: identityMode === "preserve" ? importedLineageId : null,
          physicalAppearanceTags: presetData.physical_appearance_tags ?? [],
          naiCharRefUrl: presetData.nai_char_ref_url ?? null,
          naiAttgAuthor: presetData.nai_attg_author ?? null,
          naiAttgTitle: presetData.nai_attg_title ?? null,
          naiAttgTags: presetData.nai_attg_tags ?? null,
          naiAttgGenre: presetData.nai_attg_genre ?? null,
          naiAttgStars: presetData.nai_attg_stars ?? null,
          isNsfw: presetData.is_nsfw === true,
        })) ?? undefined);
  } catch (error) {
    // Surface a duplicate-name race as a friendly conflict; rethrow others.
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "name_conflict", name: presetData.tomori_nickname };
    }
    throw error;
  }

  if (!newAlterRow?.persona_id) {
    log.error("Failed to insert alter persona row");
    return { ok: false, reason: "insert_failed" };
  }
  const newTomoriId = newAlterRow.persona_id;

  // Persist the alter's trigger words + optional persona prompt. Pointer rows
  //    already carry their config from the official preset, so skip them.
  const importedPersonaPrompt = typeof presetData.persona_prompt === "string" ? presetData.persona_prompt : null;
  if (!createdAsPointer) {
    const personaConfigUpdated = await personaRepository.setPersonaConfig(
      newTomoriId,
      uniqueTriggers,
      importedPersonaPrompt,
    );
    if (!personaConfigUpdated) {
      return { ok: false, reason: "config_failed" };
    }
  }

  const usedMainAvatarFallback = !avatarImageBuffer && Boolean(fallbackAvatarReference);
  let avatarUrl: string | null;
  if (avatarImageBuffer) {
    avatarUrl = await uploadPersonaAvatarToStorage({
      personaId: newTomoriId,
      serverDiscId,
      label: "alter import",
      buffer: avatarImageBuffer,
    });
  } else {
    avatarUrl = fallbackAvatarReference;
  }

  if (avatarUrl) {
    const avatarUpdated = await personaRepository.setAvatar(newTomoriId, avatarUrl);
    if (!avatarUpdated) {
      log.warn(`Failed to persist imported avatar for alter persona ${newTomoriId}`);
    }
  } else {
    log.warn(`Failed to persist imported avatar for alter persona ${newTomoriId}`);
  }

  // Invalidate cache so the next message rebuilds with the new alter persona.
  invalidateTomoriStateCache(serverDiscId);

  log.success(
    `Successfully imported alter persona "${presetData.tomori_nickname}" with ${uniqueTriggers.length} triggers for ${serverDiscId}`,
  );

  return {
    ok: true,
    personaId: newTomoriId,
    nickname: presetData.tomori_nickname,
    displayedTriggers,
    uniqueTriggerCount: uniqueTriggers.length,
    usedMainAvatarFallback,
    hasNoTriggers,
    mainPersonaNickname: mainPersona.persona_nickname,
    fallbackAvatarDisplayUrl,
  };
}

/**
 * Normalizes a persona nickname for case-insensitive comparison.
 * Mirrors the private helper in `commands/persona/import.ts`.
 *
 * @param name - Raw persona nickname.
 */
function normalizePersonaName(name: string): string {
  return name.trim().toLowerCase();
}
