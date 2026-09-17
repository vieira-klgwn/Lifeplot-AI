import { addDays, addMinutes, format, startOfDay } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

/** Converts a wall-clock date/time in a given IANA timezone to an absolute instant. */
export function zonedToUtc(dateIso: string, timeHHmm: string, timezone: string): Date {
  return fromZonedTime(`${dateIso}T${timeHHmm}:00`, timezone);
}

/** Formats an instant as the user sees it in their timezone. */
export function formatInZone(instant: Date, timezone: string, pattern: string): string {
  return format(toZonedTime(instant, timezone), pattern);
}

/** "2026-03-04" for the calendar day the instant falls on in the user's timezone. */
export function zonedDateKey(instant: Date, timezone: string): string {
  return formatInZone(instant, timezone, 'yyyy-MM-dd');
}

/** Absolute bounds [start, end) of a local calendar day. */
export function dayBoundsUtc(dateIso: string, timezone: string): { start: Date; end: Date } {
  const start = zonedToUtc(dateIso, '00:00', timezone);
  const nextDay = format(addDays(new Date(`${dateIso}T12:00:00Z`), 1), 'yyyy-MM-dd');
  return { start, end: zonedToUtc(nextDay, '00:00', timezone) };
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function localStartOfDay(instant: Date, timezone: string): Date {
  return fromZonedTime(startOfDay(toZonedTime(instant, timezone)), timezone);
}

export { addMinutes, addDays };
