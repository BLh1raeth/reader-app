/**
 * Data Tab Core A: device-local calendar day helpers.
 *
 * Every "day" in Reading Analytics is a device-local calendar day:
 * the YYYY-MM-DD you see on the iPhone, in its current timezone.
 * This module is the single place that defines that semantic.
 *
 * Rules enforced here (do not work around them elsewhere):
 * - Never derive a local day from a UTC date string
 *   (e.g. `new Date().toISOString().slice(0, 10)` is FORBIDDEN as a day key).
 * - Never hard-code a timezone offset (+8h) or generate calendar days with
 *   86400000 ms arithmetic — DST days are 23/25 hours long.
 * - Never `new Date('2026-09-23')`: JS parses date-only strings as UTC
 *   midnight, which is the wrong local day for most of the world.
 *
 * All helpers are pure TypeScript with no React Native imports, so they can
 * be exercised in Node (TZ env var controls the "device" timezone there).
 */

const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDayKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseDayKey(dayKey: string): { year: number; month: number; day: number } | null {
  const match = DAY_KEY_PATTERN.exec(dayKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Round-trip through the local calendar to reject e.g. 2026-02-30.
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/**
 * Whether `dayKey` is a real `YYYY-MM-DD` local calendar date.
 */
export function isValidDayKey(dayKey: string): boolean {
  return parseDayKey(dayKey) !== null;
}

/**
 * Local day key for an epoch-ms timestamp: the device's local
 * YYYY-MM-DD at that instant.
 */
export function toLocalDayKeyFromMs(timestampMs: number): string {
  const date = new Date(timestampMs);
  return formatDayKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/**
 * Local day key for an ISO-8601 timestamp string, as stored in the SQLite
 * TEXT columns (always UTC, e.g. `2026-09-23T00:30:00.000Z`).
 *
 * Returns null when the string cannot be parsed — the caller must skip the
 * row (see reading-analytics.ts), never invent a day.
 */
export function toLocalDayKey(isoTimestamp: string): string | null {
  if (typeof isoTimestamp !== 'string' || isoTimestamp.length === 0) return null;
  const timestampMs = Date.parse(isoTimestamp);
  if (!Number.isFinite(timestampMs)) return null;
  return toLocalDayKeyFromMs(timestampMs);
}

/**
 * Local midnight of the given date's calendar day, as a Date.
 */
export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Local day key for "now" on this device.
 */
export function todayLocalDayKey(now: Date = new Date()): string {
  return toLocalDayKeyFromMs(now.getTime());
}

/**
 * Add (or subtract) whole calendar days to a day key.
 * Uses `setDate`, so DST transitions and month/year boundaries stay correct.
 * Throws on an invalid day key — that is a programmer error.
 */
export function addLocalCalendarDays(dayKey: string, days: number): string {
  const parsed = parseDayKey(dayKey);
  if (!parsed) throw new Error(`Invalid local day key: ${dayKey}`);
  const date = new Date(parsed.year, parsed.month - 1, parsed.day);
  date.setDate(date.getDate() + days);
  return formatDayKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/**
 * Compare two day keys chronologically: -1 | 0 | 1.
 * Lexicographic comparison is valid because the format is zero-padded.
 */
export function compareLocalDayKeys(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Every local calendar day from `startDay` to `endDay`, both inclusive.
 * Throws on invalid keys or when endDay is before startDay.
 */
export function localDayRange(startDay: string, endDay: string): string[] {
  if (!isValidDayKey(startDay)) throw new Error(`Invalid local day key: ${startDay}`);
  if (!isValidDayKey(endDay)) throw new Error(`Invalid local day key: ${endDay}`);
  if (compareLocalDayKeys(endDay, startDay) < 0) {
    throw new Error(`endDay ${endDay} is before startDay ${startDay}`);
  }
  const days: string[] = [];
  let cursor = startDay;
  for (;;) {
    days.push(cursor);
    if (cursor === endDay) break;
    cursor = addLocalCalendarDays(cursor, 1);
  }
  return days;
}
