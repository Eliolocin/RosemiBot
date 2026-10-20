/** UTC-12 through UTC+14, matching real-world timezones and the database CHECK constraints. */
export const UTC_OFFSET_MIN = -12;
export const UTC_OFFSET_MAX = 14;
/** Quarter hours, because real zones such as Nepal (+5:45) and Chatham (+12:45) sit on 45-minute marks. */
export const UTC_OFFSET_STEP_HOURS = 0.25;
