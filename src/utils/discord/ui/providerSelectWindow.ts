import type { ProviderSelectEntry } from "@/utils/discord/ui/modelRoutingControls";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { localizer } from "@/utils/text/localizer";

export interface ProviderSelectWindowInput {
  entries: readonly ProviderSelectEntry[];
  /** Entry index the window opens on, already resolved against the caller's stored page start. */
  entryStart: number;
  /** Option slots the select can spend, with its leading clear or default entry already deducted. */
  directLimit: number;
  expandedProvider: string | null;
  /** Pages the expanded provider contributed, or 0 when nothing expanded. */
  expandedPageCount: number;
  locale: string;
  capabilityLabel: string;
  /** Locale key for the surface's expanded page placeholder. */
  pagePlaceholderKey: string;
  /** Encodes the advance entry's value for the surface's route codec. */
  encodeAdvanceValue(start: number, expandedProvider: string | null): string;
}

export interface ProviderSelectWindow {
  visibleEntries: ProviderSelectEntry[];
  /** Set when the expanded provider has pages: the selector is looking for them, not its value. */
  placeholderOverride: string | undefined;
  /** Set when the entry list outruns one window, and otherwise null. */
  advanceEntry: ProviderSelectEntry | null;
}

/**
 * A stored page start means the reader paged deliberately, so it outranks the expansion offset,
 * which exists only to keep a freshly expanded provider on screen.
 */
export function resolveProviderEntryStart(storedStart: number, expandedStartIndex: number): number {
  return storedStart || expandedStartIndex;
}

/**
 * The window of a provider select that pages an entry list too long for one payload.
 *
 * A window that does not hold every entry spends one option slot on its own advance entry, so it
 * shrinks by one rather than leaving the last entry of each window unreachable.
 *
 * A route that expands a provider rewrites options inside a selector the reader has already closed,
 * so it must repaint with a receipt; without one the selection reads as a no-op and gets repeated.
 */
export function buildProviderSelectWindow(input: ProviderSelectWindowInput): ProviderSelectWindow {
  const overflows = input.entries.length > input.directLimit;
  const windowSize = overflows ? input.directLimit - 1 : input.directLimit;
  const rangeCount = Math.max(1, Math.ceil(input.entries.length / windowSize));
  const rangeIndex = Math.min(Math.max(0, Math.floor(input.entryStart / windowSize)), rangeCount - 1);
  const visibleEntries = input.entries.slice(rangeIndex * windowSize, rangeIndex * windowSize + windowSize);

  let advanceEntry: ProviderSelectEntry | null = null;
  if (overflows) {
    // Wrapping past the last window is what keeps every entry reachable from any window without a
    // second control: advancing repeatedly always returns to the first.
    const nextRangeIndex = (rangeIndex + 1) % rangeCount;
    advanceEntry = {
      value: input.encodeAdvanceValue(nextRangeIndex * windowSize, input.expandedProvider),
      label: localizer(input.locale, "commands.config.panel.model_provider_more_option", {
        capability: input.capabilityLabel,
        page: nextRangeIndex + 1,
        total: rangeCount,
      }),
    };
  }

  // While expanded the active model is the least useful thing the placeholder could say: the
  // reader has already chosen a provider and is looking for its pages.
  const placeholderOverride =
    input.expandedPageCount > 0 && input.expandedProvider
      ? localizer(input.locale, input.pagePlaceholderKey, {
          capability: input.capabilityLabel,
          provider: getProviderDisplayName(input.expandedProvider, input.locale),
        })
      : undefined;

  return { visibleEntries, placeholderOverride, advanceEntry };
}
