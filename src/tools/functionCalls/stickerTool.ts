import { BaseTool, type ToolContext, type ToolResult, type ToolParameterSchema } from "@/types/tool/interfaces";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";
import { projectStickerCandidates, type StickerCandidate } from "@/utils/discord/stickerCandidates";
import { normalizeStickerNameForExact, normalizeStickerNameForLoose } from "@/utils/text/stickerNames";
import { log } from "@/utils/misc/logger";

export class StickerTool extends BaseTool {
  name = "select_sticker_for_response";
  description =
    "Sends one of the server's available stickers right now, as its own message, at this point in your reply. Choose a sticker whose name or description matches the emotion or reaction you want to show. Any text you wrote before the call is already posted, so you can react before speaking, between thoughts, or after your text, and you may keep writing once the result returns. One sticker per reply: a sent sticker cannot be replaced or removed.";
  category = "discord" as const;
  requiresFeatureFlag = "sticker_usage";
  requiresPermissions = ["SEND_MESSAGES"];
  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      sticker_name: {
        type: "string",
        description:
          "The sticker name to send (case-insensitive). Use the names from the provided list; do not include IDs.",
      },
      sticker_id: {
        type: "string",
        description: "Deprecated: The sticker ID. Use sticker_name instead (kept for compatibility).",
      },
    },
    required: ["sticker_name"],
  };

  private static levenshteinDistance(a: string, b: string): number {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    const current = new Array<number>(b.length + 1);
    for (let i = 1; i <= a.length; i++) {
      current[0] = i;
      for (let j = 1; j <= b.length; j++) {
        current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + Number(a[i - 1] !== b[j - 1]));
      }
      for (let j = 0; j <= b.length; j++) previous[j] = current[j];
    }
    return previous[b.length];
  }

  private static fuzzyScore(query: string, candidate: string): number {
    if (!query || !candidate) return 0;
    if (query === candidate) return 1;
    if (candidate.includes(query) || query.includes(candidate)) {
      return 0.9 + (Math.min(query.length, candidate.length) / Math.max(query.length, candidate.length)) * 0.08;
    }
    return 1 - StickerTool.levenshteinDistance(query, candidate) / Math.max(query.length, candidate.length);
  }

  isAvailableFor(provider: string): boolean {
    // NovelAI cannot reliably emit CJK sticker names as tool arguments.
    return provider !== "novelai";
  }

  protected isEnabled(context: ToolContext): boolean {
    return context.tomoriState.config.sticker_usage_enabled;
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    if (!this.isEnabled(context) || !this.isAvailableFor(context.provider) || context.isUserImpersonation) {
      return {
        success: false,
        error: "Sticker selection unavailable",
        message: "Sticker selection is unavailable for this turn.",
      };
    }
    if (!("guild" in context.channel) || !context.channel.guild) {
      return {
        success: false,
        error: "Stickers not available in DMs",
        message: "Stickers are not available in Direct Messages.",
      };
    }
    const guild = context.channel.guild;
    const name = typeof args.sticker_name === "string" ? normalizeStickerNameForExact(args.sticker_name.trim()) : "";
    const id = typeof args.sticker_id === "string" ? args.sticker_id.trim() : "";
    try {
      // Execution reloads whitelist state rather than trusting a prompt assembled before generation.
      const [customs, metadata] = await Promise.all([
        serverRepository.loadCustomExpressions(context.tomoriState.server_id),
        serverRepository.loadStickersByInternalId(context.tomoriState.server_id),
      ]);
      const canUseExternal =
        !!context.client.user && !!context.channel.permissionsFor(context.client.user)?.has("UseExternalStickers");
      const candidates = () =>
        projectStickerCandidates(
          guild,
          context.activePersonaId ?? context.tomoriState.persona_id ?? 0,
          metadata,
          customs,
          canUseExternal,
        );
      let available = candidates();
      let ambiguous: StickerCandidate[] = [];
      let suggestions: Array<{ candidate: StickerCandidate; score: number }> = [];
      const lookup = (): StickerCandidate | null => {
        ambiguous = [];
        suggestions = [];
        if (!name) return available.find((candidate) => candidate.id === id) ?? null;
        const loose = normalizeStickerNameForLoose(name);
        const exact = available.filter((candidate) => normalizeStickerNameForExact(candidate.name) === name);
        const relaxed = loose
          ? available.filter((candidate) => normalizeStickerNameForLoose(candidate.name) === loose)
          : [];
        // An exact spelling cannot choose between a native/custom normalized-name collision.
        if (relaxed.length > 1 && relaxed.some((candidate) => candidate.selection.kind === "custom")) {
          ambiguous = relaxed;
          return null;
        }
        const newest = (items: StickerCandidate[]) =>
          items.sort((a, b) => b.createdTimestamp - a.createdTimestamp || a.id.localeCompare(b.id))[0];
        if (exact.length) return newest(exact);
        if (relaxed.length) return newest(relaxed);
        if (!loose) return null;
        const scored = available
          .map((candidate) => ({
            candidate,
            score: StickerTool.fuzzyScore(loose, normalizeStickerNameForLoose(candidate.name)),
          }))
          .filter((entry) => entry.score > 0)
          .sort(
            (a, b) =>
              b.score - a.score ||
              b.candidate.createdTimestamp - a.candidate.createdTimestamp ||
              a.candidate.id.localeCompare(b.candidate.id),
          );
        suggestions = scored.slice(0, 5);
        const threshold = loose.length <= 4 ? 0.96 : loose.length <= 7 ? 0.88 : loose.length <= 12 ? 0.78 : 0.72;
        const best = scored[0];
        if (!best || best.score < threshold) return null;
        if (scored[1]?.score >= threshold && best.score - scored[1].score < 0.08) {
          ambiguous = scored.filter((entry) => entry.score >= threshold).map((entry) => entry.candidate);
          return null;
        }
        return best.candidate;
      };
      let selected = name || id ? lookup() : null;
      if (!selected && (name || id) && !ambiguous.length) {
        await guild.stickers.fetch().catch(() => undefined);
        available = candidates();
        selected = lookup();
      }
      if (selected) {
        // The tool loop sends the selection and replaces this result with the delivery outcome.
        return {
          success: true,
          message: "Sticker resolved",
          stickerSelection: selected.selection,
          data: { sticker_name: selected.name },
        };
      }
      const visible = (candidate: StickerCandidate) => ({
        name: candidate.name,
        description: candidate.description || "No description available",
      });
      const availableStickers = available.slice(0, 15).map(visible);
      const hint = availableStickers.length
        ? " Available stickers: " +
          availableStickers.map((candidate) => JSON.stringify(candidate.name)).join(", ") +
          ". Call select_sticker_for_response again with one exact name, or do not use a sticker."
        : " No stickers are available in this server.";
      const missing = !name && !id;
      const isAmbiguous = ambiguous.length > 1;
      const reason =
        (missing
          ? "Missing sticker_name, please retry with a specific name."
          : isAmbiguous
            ? "Sticker name is ambiguous. A server manager must resolve conflicting names."
            : "Sticker not found.") + hint;
      return {
        success: false,
        error: missing ? "Missing sticker_name" : isAmbiguous ? "Sticker name is ambiguous" : "Sticker not found",
        message: reason,
        data: {
          status: missing ? "sticker_name_missing_retry" : isAmbiguous ? "sticker_name_ambiguous" : "sticker_not_found",
          reason,
          availableStickers,
          possibleMatches: ambiguous.slice(0, 3).map(visible),
          closeMatches: suggestions
            .filter((entry) => entry.score >= 0.6)
            .slice(0, 3)
            .map((entry) => ({ ...visible(entry.candidate), score: Number(entry.score.toFixed(3)) })),
        },
      };
    } catch (error) {
      log.warn("Sticker selection failed", error, { serverId: context.tomoriState.server_id });
      return {
        success: false,
        error: "Sticker selection failed",
        message: "Failed to select the requested sticker. Please try again.",
      };
    }
  }
}
