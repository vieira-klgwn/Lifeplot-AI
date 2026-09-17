import { addDays, differenceInMinutes, format, parse } from 'date-fns';
import { zonedToUtc } from '../lib/time.js';

export interface RecurrenceInput {
  byWeekday: number[];
  startTime: string;
  endTime: string;
  startDate: Date;
  endDate: Date;
  timezone: string;
}

export interface Occurrence {
  occurrenceDate: Date;
  startTime: Date;
  endTime: Date;
}

const DATE_FMT = 'yyyy-MM-dd';

export function parseHHmm(value: string): { hours: number; minutes: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new Error(`Invalid time "${value}", expected HH:mm`);
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

export function durationMinutes(startHHmm: string, endHHmm: string): number {
  const base = '2000-01-01';
  const start = parse(`${base} ${startHHmm}`, 'yyyy-MM-dd HH:mm', new Date());
  const end = parse(`${base} ${endHHmm}`, 'yyyy-MM-dd HH:mm', new Date());
  return differenceInMinutes(end, start);
}

/**
 * Materialises every occurrence of a weekly recurring series between its start
 * and end date. Times are wall-clock in the series timezone so DST shifts keep
 * a 9:00 class at 9:00 local.
 */
export function expandOccurrences(rule: RecurrenceInput): Occurrence[] {
  if (rule.byWeekday.length === 0) return [];
  parseHHmm(rule.startTime);
  parseHHmm(rule.endTime);
  if (durationMinutes(rule.startTime, rule.endTime) <= 0) {
    throw new Error('Recurring class must end after it starts');
  }

  const weekdays = new Set(rule.byWeekday);
  const occurrences: Occurrence[] = [];
  const last = format(rule.endDate, DATE_FMT);
  let cursor = new Date(
    Date.UTC(
      rule.startDate.getUTCFullYear(),
      rule.startDate.getUTCMonth(),
      rule.startDate.getUTCDate(),
      12,
    ),
  );

  // Hard cap protects against a pathological end date creating millions of rows.
  for (let guard = 0; guard < 1500; guard += 1) {
    const dateIso = format(cursor, DATE_FMT);
    if (dateIso > last) break;
    if (weekdays.has(cursor.getUTCDay())) {
      occurrences.push({
        occurrenceDate: new Date(`${dateIso}T00:00:00.000Z`),
        startTime: zonedToUtc(dateIso, rule.startTime, rule.timezone),
        endTime: zonedToUtc(dateIso, rule.endTime, rule.timezone),
      });
    }
    cursor = addDays(cursor, 1);
  }

  return occurrences;
}
