import { addMinutes } from 'date-fns';
import { zonedToUtc } from '../lib/time.js';

export interface Busy {
  startTime: Date;
  endTime: Date;
}

export interface FreeSlot {
  start: Date;
  end: Date;
}

export interface FindFreeTimeOptions {
  /** Local calendar days to search, e.g. ["2026-03-04", "2026-03-05"]. */
  days: string[];
  timezone: string;
  durationMinutes: number;
  /** Local wall-clock window the student is willing to work in. */
  dayStart?: string;
  dayEnd?: string;
  busy: Busy[];
  /** Nothing before this instant is proposed (defaults to now). */
  notBefore?: Date;
  /** Nothing at or after this instant is proposed (e.g. a deadline). */
  notAfter?: Date;
  limit?: number;
  /** Slot candidates are aligned to this granularity in minutes. */
  granularityMinutes?: number;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Returns candidate free slots ordered earliest first. */
export function findFreeSlots(options: FindFreeTimeOptions): FreeSlot[] {
  const {
    days,
    timezone,
    durationMinutes,
    dayStart = '08:00',
    dayEnd = '22:00',
    busy,
    notBefore = new Date(),
    notAfter,
    limit = 5,
    granularityMinutes = 15,
  } = options;

  if (durationMinutes <= 0) return [];

  const sortedBusy = [...busy].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  const slots: FreeSlot[] = [];

  for (const day of days) {
    const windowStart = zonedToUtc(day, dayStart, timezone);
    const windowEnd = zonedToUtc(day, dayEnd, timezone);
    let cursor = windowStart < notBefore ? ceilTo(notBefore, granularityMinutes) : windowStart;

    while (addMinutes(cursor, durationMinutes) <= windowEnd) {
      const candidateEnd = addMinutes(cursor, durationMinutes);
      if (notAfter && candidateEnd > notAfter) break;

      const clash = sortedBusy.find((b) => overlaps(cursor, candidateEnd, b.startTime, b.endTime));
      if (!clash) {
        slots.push({ start: cursor, end: candidateEnd });
        if (slots.length >= limit) return slots;
        cursor = addMinutes(candidateEnd, 0);
      } else {
        cursor = ceilTo(clash.endTime, granularityMinutes);
      }
    }
  }

  return slots;
}

function ceilTo(date: Date, granularityMinutes: number): Date {
  const ms = granularityMinutes * 60_000;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}
