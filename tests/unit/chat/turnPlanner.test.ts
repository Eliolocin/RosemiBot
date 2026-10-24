import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { Client, Message } from "discord.js";
import { PrivacyLevel, savedProviderConfigSchema, userSavedProviderConfigSchema } from "@/types/db/schema";
import { DatabaseUnavailableError } from "@/types/errors";
import * as credentials from "@/utils/provider/credentialResolver";
import * as textModels from "@/utils/provider/textModelSelection";
import * as embeds from "@/utils/discord/embedHelper";
import * as guards from "@/utils/chat/admissionGuards";
import * as userCache from "@/utils/cache/userCache";
import * as triggers from "@/utils/chat/triggerProcessor";
import * as replyDecision from "@/utils/chat/replyDecision";
import { userNamingRepository } from "@/utils/db/repositories/UserNamingRepository";
import { normalizeChatInvocation } from "@/utils/chat/admission";
import type { LockedChatTurn } from "@/utils/chat/types";
import { claimCredentialRefusalNotice, cleanupTextQuotaTriggerStates } from "@/utils/chat/textQuotaState";
import { createPersona, createUserRow } from "../../helpers/fixtures";
import { createScopedModuleMocker, stubLogMembers } from "../../helpers/mockSurface";

let resolutions: Array<credentials.ResolvedCredentials | Error> = [];
const send = mock(async () => undefined);
const resolve = mock(async () => {
  const result = resolutions.shift();
  if (result instanceof Error) throw result;
  if (!result) throw new Error("Unexpected credential resolution");
  return result;
});
const scoped = createScopedModuleMocker(mock, {
  "@/utils/provider/credentialResolver": credentials,
  "@/utils/provider/textModelSelection": textModels,
  "@/utils/discord/embedHelper": embeds,
});
scoped.module("@/utils/provider/credentialResolver", () => ({
  ...credentials,
  resolveCapabilityCredentials: resolve,
  resolvePersonalCapabilityCredentials: async () => {
    const next = resolutions[0];
    return next instanceof Error || next?.source === "personal" ? resolve() : null;
  },
}));
scoped.module("@/utils/provider/textModelSelection", () => ({
  ...textModels,
  resolveServerTextModel: async (state: Parameters<typeof textModels.resolveServerTextModel>[0]) =>
    state.persona_llm ?? state.llm,
}));
scoped.module("@/utils/discord/embedHelper", () => ({ ...embeds, sendStandardEmbed: send }));
stubLogMembers({ info: () => undefined, warn: () => undefined });
const { planChatTurns, resolveTextCredentialPolicy } = await import("@/utils/chat/turnPlanner");

function resolved(source: "server" | "personal"): credentials.ResolvedCredentials {
  const row = {
    provider: "openrouter",
    llm_disabled_params: [],
    llm_logit_biases: [],
    fallback_model_refs: [],
    api_key: Buffer.from("fixture-encrypted-key"),
    llm_id: 1,
    diffusion_model_id: null,
    embedding_model_id: null,
    nai_diffusion_model_id: null,
    nai_preset_name: null,
  };
  return {
    source,
    provider: "openrouter",
    apiKey: "fixture-key",
    keyVersion: 1,
    savedConfig:
      source === "server"
        ? savedProviderConfigSchema.parse({ ...row, server_id: 1 })
        : userSavedProviderConfigSchema.parse({
            ...row,
            user_id: 1,
            enabled_capabilities: ["text"],
            assigned_capabilities: ["text"],
          }),
  };
}

const user = createUserRow();
const personas = [createPersona(), createPersona({ persona_id: 2, persona_lineage_id: 102, is_alter: true })];
let sequence = 0;
function lockedTurn(): LockedChatTurn {
  const client = { user: { id: "fixture-bot" } } as Client;
  const channel = { id: "fixture-channel", isThread: () => false };
  const message = {
    id: `fixture-trigger-${sequence++}`,
    channel,
    client,
    author: { id: user.user_disc_id, username: "Juno", bot: false },
    content: "Mirri, Juno",
    webhookId: null,
    guild: null,
  } as unknown as Message;
  const incoming = normalizeChatInvocation({ client, message, isFromQueue: false });
  return {
    channelId: channel.id,
    lockedAt: Date.now(),
    queueDepth: 0,
    skipLock: false,
    admission: {
      incoming,
      disposition: "run",
      client,
      message,
      channel: message.channel,
      locale: "en-US",
      isDMChannel: false,
      tomoriState: personas[0],
      allPersonas: personas,
      referencedMessage: null,
    },
  };
}

const restores: Array<{ mockRestore(): void }> = [];
beforeEach(() => {
  resolve.mockClear();
  send.mockClear();
  resolutions = [];
  restores.push(
    spyOn(userCache, "getCachedUserRow").mockResolvedValue(user),
    spyOn(userCache, "getCachedBlacklistStatus").mockResolvedValue(false),
    spyOn(userCache, "getCachedPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL),
    spyOn(guards, "validateDirectChatTrigger").mockResolvedValue({
      shouldContinue: true,
      isReplyToBot: false,
      replyPersona: null,
      isBotMentioned: true,
      isDirectUserIntent: true,
      isUserImpersonation: false,
    }),
    spyOn(guards, "evaluateChatAccess").mockResolvedValue({
      whitelistStatus: null,
      personalSpotlightStatus: null,
      allowedPersonaIds: null,
      blockedPersonaIds: new Set(),
      rejectedByWhitelist: false,
    }),
    spyOn(guards, "enforceGlobalRateLimit").mockResolvedValue(true),
    spyOn(guards, "enforceServerTriggerCooldownForAdmission").mockResolvedValue(true),
    spyOn(guards, "checkTextQuotaForAdmission").mockResolvedValue({ allowed: true, state: null }),
    spyOn(triggers, "determineMatchingPersonas").mockReturnValue(personas),
    spyOn(replyDecision, "shouldBotReply").mockReturnValue(true),
    spyOn(userNamingRepository, "loadPreferences").mockResolvedValue(new Map()),
  );
});
afterEach(() => {
  for (const spy of restores.splice(0).reverse()) spy.mockRestore();
});

function policyParams() {
  const turn = lockedTurn();
  return {
    tomoriState: personas[0],
    userRow: user,
    channel: turn.admission.channel,
    locale: "en-US",
    isDMChannel: false,
    isSelfMessage: false,
    isPersonaJob: false,
    isManuallyTriggered: false,
    isUserImpersonation: false,
    borrowsTriggerMessage: false,
    shouldSurfaceUserErrors: true,
    refusalNoticeKey: turn.admission.message.id,
  };
}

describe("text credential admission", () => {
  it("preserves resolved personal and server routes", async () => {
    for (const source of ["personal", "server"] as const) {
      resolutions.push(resolved(source));
      expect(await resolveTextCredentialPolicy(policyParams())).toMatchObject({
        source,
        personalRoutingUserId: user.user_id,
        personalTextProvider: source === "personal" ? "openrouter" : null,
      });
    }
  });

  it("suppresses personal routing for self replies but keeps it for deliberate jobs", async () => {
    for (const job of [false, true]) {
      resolutions.push(resolved("server"));
      expect(
        await resolveTextCredentialPolicy({ ...policyParams(), isSelfMessage: true, isPersonaJob: job }),
      ).toMatchObject({ personalRoutingUserId: job ? user.user_id : null });
    }
  });

  it("shows one credential refusal per trigger across failure categories and personas", async () => {
    for (const error of [
      new DatabaseUnavailableError("fixture-unavailable"),
      new credentials.PersonalProviderRequiredError("text"),
      new credentials.CredentialUnavailableError("openrouter", "text", "no_saved_config"),
      new credentials.CredentialUnavailableError("openrouter", "text", "decryption_failed", "personal"),
    ]) {
      const params = policyParams();
      const before = send.mock.calls.length;
      resolutions.push(error, error);
      expect(await resolveTextCredentialPolicy(params)).toBeNull();
      expect(await resolveTextCredentialPolicy({ ...params, tomoriState: personas[1] })).toBeNull();
      expect(send.mock.calls.length - before).toBe(1);
    }
  });

  it("does not claim the notice for passive failures", async () => {
    const params = policyParams();
    const error = new credentials.PersonalProviderRequiredError("text");
    resolutions.push(error, error);
    expect(await resolveTextCredentialPolicy({ ...params, shouldSurfaceUserErrors: false })).toBeNull();
    expect(send).not.toHaveBeenCalled();
    expect(await resolveTextCredentialPolicy(params)).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("expires credential notices with trigger state cleanup", () => {
    const key = policyParams().refusalNoticeKey;
    const now = Date.now();
    const clock = spyOn(Date, "now").mockReturnValue(now);
    try {
      expect(claimCredentialRefusalNotice(key)).toBe(true);
      expect(claimCredentialRefusalNotice(key)).toBe(false);
      clock.mockReturnValue(now + 10 * 60 * 1000);
      cleanupTextQuotaTriggerStates();
      expect(claimCredentialRefusalNotice(key)).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });
});

describe("per-persona planning", () => {
  it("skips an unavailable persona and retains the next persona's own route", async () => {
    resolutions.push(new credentials.PersonalProviderRequiredError("text"), resolved("personal"));
    const plan = await planChatTurns(lockedTurn());
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(plan.turns.map((turn) => turn.persona.persona_id)).toEqual([personas[1].persona_id]);
    expect(plan.turns[0]).toMatchObject({ textCredentialSource: "personal", shouldApplyTextQuota: false });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retains each admitted persona's route and checks the server guard once", async () => {
    resolutions.push(resolved("personal"), resolved("server"));
    const plan = await planChatTurns(lockedTurn());
    expect(plan.turns.map((turn) => [turn.textCredentialSource, turn.shouldApplyTextQuota])).toEqual([
      ["personal", false],
      ["server", true],
    ]);
    expect(guards.enforceServerTriggerCooldownForAdmission).toHaveBeenCalledTimes(1);
  });

  it("limits refused quota notices across matched personas", async () => {
    const quota = spyOn(guards, "checkTextQuotaForAdmission").mockResolvedValue({ allowed: false, state: null });
    try {
      resolutions.push(resolved("server"), resolved("server"));
      expect((await planChatTurns(lockedTurn())).turns).toEqual([]);
      expect(quota.mock.calls.map(([params]) => params.notifyUser)).toEqual([true, false]);
    } finally {
      quota.mockRestore();
    }
  });
});
