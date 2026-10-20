/**
 * Timezone Utility Functions
 * Handles UTC offset-based timezone conversions for TomoriBot
 */

import { UTC_OFFSET_MAX, UTC_OFFSET_MIN, UTC_OFFSET_STEP_HOURS } from "@/constants/utcOffset";
import { resolveSupportedLocale } from "@/utils/text/localizer";

const UTC_OFFSET_PREFIX_PATTERN = /^(?:utc|gmt)\s*/i;
const UTC_OFFSET_DECIMAL_PATTERN = /^[+-]?\d{1,2}(?:\.\d+)?$/;
/** Sign, hours, then minutes, as in "+5:30" or "-3:30". */
const UTC_OFFSET_CLOCK_PATTERN = /^([+-]?)(\d{1,2}):([0-5]\d)$/;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MILLISECONDS_PER_HOUR = 3_600_000;
const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * Validates that a value is a usable UTC offset in hours
 * @param value - The value to validate (accepts quarter-hour offsets like 5.5 for UTC+5:30)
 * @returns True if the value is a quarter-hour multiple within [UTC_OFFSET_MIN, UTC_OFFSET_MAX]
 *
 * @example
 * ```ts
 * isValidUtcOffset(8)     // true
 * isValidUtcOffset(5.75)  // true (UTC+5:45)
 * isValidUtcOffset(5.3)   // false (not on a quarter hour)
 * isValidUtcOffset(20)    // false (out of range)
 * isValidUtcOffset("8")   // false (not a number)
 * ```
 */
export function isValidUtcOffset(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value / UTC_OFFSET_STEP_HOURS) &&
    value >= UTC_OFFSET_MIN &&
    value <= UTC_OFFSET_MAX
  );
}

/**
 * Parses a typed UTC offset in decimal hours ("5.5") or clock form ("+5:30"), with an optional
 * "UTC" or "GMT" prefix so a pasted display value round-trips.
 * @returns The offset in hours, or null when the text is not a valid offset
 *
 * @example
 * ```ts
 * parseUtcOffsetInput("5.5")       // 5.5
 * parseUtcOffsetInput("UTC+5:45")  // 5.75
 * parseUtcOffsetInput("-3:30")     // -3.5
 * parseUtcOffsetInput("5:20")      // null (not on a quarter hour)
 * ```
 */
export function parseUtcOffsetInput(raw: string): number | null {
  const text = raw.trim().replace(UTC_OFFSET_PREFIX_PATTERN, "").replaceAll(" ", "");
  let offset: number | null = null;

  if (UTC_OFFSET_DECIMAL_PATTERN.test(text)) {
    offset = Number(text);
  } else {
    const clock = text.match(UTC_OFFSET_CLOCK_PATTERN);
    if (clock) {
      const [, sign, hours, minutes] = clock;
      offset = (sign === "-" ? -1 : 1) * (Number(hours) + Number(minutes) / 60);
    }
  }

  return isValidUtcOffset(offset) ? offset : null;
}

/** Splits an offset into its sign and whole hours/minutes so formatters never print "5.5". */
function splitUtcOffset(offset: number): { sign: "+" | "-"; hours: number; minutes: number } {
  const totalMinutes = Math.round(Math.abs(offset) * 60);
  return { sign: offset < 0 ? "-" : "+", hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

/**
 * Formats a UTC offset number into a display string
 * @param offset - The UTC offset in hours (e.g., 8, -5, 5.5)
 *
 * @example
 * ```ts
 * formatUTCOffset(8)     // "UTC+8"
 * formatUTCOffset(-5)    // "UTC-5"
 * formatUTCOffset(5.5)   // "UTC+5:30"
 * formatUTCOffset(0)     // "UTC+0"
 * ```
 */
export function formatUTCOffset(offset: number): string {
  return `UTC${formatUtcOffsetInput(offset, true)}`;
}

/**
 * Formats an offset as a modal pre-fill that {@link parseUtcOffsetInput} reads back unchanged.
 * @param forceSign - Prefix "+" on non-negative offsets, as display labels do
 *
 * @example
 * ```ts
 * formatUtcOffsetInput(8)     // "8"
 * formatUtcOffsetInput(-3.5)  // "-3:30"
 * ```
 */
export function formatUtcOffsetInput(offset: number, forceSign = false): string {
  const { sign, hours, minutes } = splitUtcOffset(offset);
  const prefix = sign === "-" ? "-" : forceSign ? "+" : "";
  const minuteSuffix = minutes === 0 ? "" : `:${String(minutes).padStart(2, "0")}`;
  return `${prefix}${hours}${minuteSuffix}`;
}

/**
 * Gets the current time formatted with a UTC offset applied
 * @param offsetHours - The UTC offset in hours to apply
 * @returns Formatted time string in the format "Month Day, Year | Hour:Minutes AM/PM | Weekday"
 *
 * @example
 * ```ts
 * getCurrentTimeWithOffset(8)   // "January 23, 2025 | 3:45 PM | Thursday"
 * getCurrentTimeWithOffset(-5)  // "January 23, 2025 | 2:45 AM | Thursday"
 * ```
 */
export function getCurrentTimeWithOffset(offsetHours: number): string {
  const now = new Date();
  const offsetTime = new Date(now.getTime() + offsetHours * MILLISECONDS_PER_HOUR);

  const weekday = getDayOfWeek(offsetTime);
  const day = offsetTime.getUTCDate();
  const year = offsetTime.getUTCFullYear();
  const month = MONTH_NAMES[offsetTime.getUTCMonth()];

  let hour = offsetTime.getUTCHours();
  const minutes = offsetTime.getUTCMinutes().toString().padStart(2, "0");
  let meridiem = "AM";

  if (hour === 0) {
    hour = 12;
  } else if (hour === 12) {
    meridiem = "PM";
  } else if (hour > 12) {
    hour = hour % 12;
    meridiem = "PM";
  }

  return `${month} ${day}, ${year} | ${hour}:${minutes} ${meridiem} | ${weekday}`;
}

/**
 * Returns a stable integer for the calendar day containing an instant after a
 * fixed UTC offset is applied. Subtract two returned values to get a calendar-
 * day difference without relying on elapsed 24-hour periods.
 */
export function getCalendarDayWithOffset(epochMs: number, offsetHours: number): number {
  const offsetDate = new Date(epochMs + offsetHours * MILLISECONDS_PER_HOUR);
  return Math.floor(
    Date.UTC(offsetDate.getUTCFullYear(), offsetDate.getUTCMonth(), offsetDate.getUTCDate()) / MILLISECONDS_PER_DAY,
  );
}

/** Formats an instant as an English absolute date after a fixed UTC offset. */
export function formatDateWithOffset(epochMs: number, offsetHours: number): string {
  const offsetDate = new Date(epochMs + offsetHours * MILLISECONDS_PER_HOUR);
  const month = MONTH_NAMES[offsetDate.getUTCMonth()];
  return `${month} ${offsetDate.getUTCDate()}, ${offsetDate.getUTCFullYear()}`;
}

/**
 * Gets the day name for a given date
 */
function getDayOfWeek(date: Date): string {
  const dayOfWeek = date.getUTCDay();
  return Number.isNaN(dayOfWeek)
    ? ""
    : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayOfWeek];
}

/**
 * Formats a Date object with a UTC offset applied
 * @param date - The Date object to format
 * @param offsetHours - The UTC offset in hours to apply
 * @param options - Optional Intl.DateTimeFormatOptions for custom formatting
 * @param locale - Resolved through the authored-locale chain so the date's language matches the
 *   localized sentence around it. Model-facing callers omit it and keep English.
 *
 * @example
 * ```ts
 * const date = new Date('2025-09-05T14:30:00Z');
 * formatTimeWithOffset(date, 8);  // Custom formatting in UTC+8
 * ```
 */
export function formatTimeWithOffset(
  date: Date,
  offsetHours: number,
  options?: Intl.DateTimeFormatOptions,
  locale = "en-US",
): string {
  const utcTime = date.getTime();
  const offsetTime = new Date(utcTime + offsetHours * MILLISECONDS_PER_HOUR);

  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC", // Use UTC since we already applied offset
    ...options,
  };

  return offsetTime.toLocaleString(resolveSupportedLocale(locale), defaultOptions);
}

/**
 * Parses a time string in YYYY-MM-DD_HH:MM format with UTC offset applied
 * Converts the time to UTC Date object for database storage
 * @param timeStr - Time string in format "YYYY-MM-DD_HH:MM" (e.g., "2025-09-05_14:30")
 * @param offsetHours - The UTC offset in hours that the time string represents
 * @returns Date object in UTC, or null if parsing fails
 *
 * @example
 * ```ts
 * // Parse "2025-09-05_14:30" in UTC+8 timezone
 * parseTimeWithOffset("2025-09-05_14:30", 8);  // Returns UTC Date
 * ```
 */
export function parseTimeWithOffset(timeStr: string, offsetHours: number): Date | null {
  const timePattern = /^(\d{4})-(\d{2})-(\d{2})_(\d{2}):(\d{2})$/;
  const match = timeStr.match(timePattern);

  if (!match) {
    return null; // Invalid format
  }

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr] = match;
  const year = Number.parseInt(yearStr, 10);
  const month = Number.parseInt(monthStr, 10) - 1; // Months are 0-indexed
  const day = Number.parseInt(dayStr, 10);
  const hour = Number.parseInt(hourStr, 10);
  const minute = Number.parseInt(minuteStr, 10);

  if (month < 0 || month > 11 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null; // Invalid values
  }

  const localDate = Date.UTC(year, month, day, hour, minute, 0, 0);

  const utcDate = new Date(localDate - offsetHours * MILLISECONDS_PER_HOUR);

  return utcDate;
}

/**
 * Gets a descriptive phrase about the current time of day based on the hour
 * @param offsetHours - The UTC offset in hours to apply
 *
 * @example
 * ```ts
 * getTimeOfDayPhrase(8)   // Might return "It's morning"
 * getTimeOfDayPhrase(-5)  // Might return "It's very late at night"
 * ```
 */
export function getTimeOfDayPhrase(offsetHours: number): string {
  const now = new Date();
  const offsetTime = new Date(now.getTime() + offsetHours * MILLISECONDS_PER_HOUR);
  const hour = offsetTime.getUTCHours();

  if (hour >= 0 && hour < 4) {
    return "It's very late at night";
  }
  if (hour >= 4 && hour < 7) {
    return "It's early in the morning";
  }
  if (hour >= 7 && hour < 12) {
    return "It's morning";
  }
  if (hour === 12) {
    return "It's around midday";
  }
  if (hour >= 13 && hour < 17) {
    return "It's afternoon";
  }
  if (hour >= 17 && hour < 20) {
    return "It's evening";
  }
  return "It's late at night";
}
