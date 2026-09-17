import {
  addDays,
  endOfMonth,
  format,
  isSameDay,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

export const DATE_FORMAT = 'yyyy-MM-dd';

export function toDateKey(date: Date): string {
  return format(date, DATE_FORMAT);
}

export function timeLabel(iso: string): string {
  return format(parseISO(iso), 'HH:mm');
}

export function rangeLabel(startIso: string, endIso: string): string {
  return `${timeLabel(startIso)} – ${timeLabel(endIso)}`;
}

export function dayLabel(date: Date): string {
  return format(date, 'EEEE d MMMM');
}

export function weekDays(anchor: Date, weekStartsOn: 0 | 1): Date[] {
  const start = startOfWeek(anchor, { weekStartsOn });
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function monthGrid(anchor: Date, weekStartsOn: 0 | 1): Date[] {
  const start = startOfWeek(startOfMonth(anchor), { weekStartsOn });
  const cells: Date[] = [];
  const monthEnd = endOfMonth(anchor);
  let cursor = start;
  while (cursor <= monthEnd || cells.length % 7 !== 0) {
    cells.push(cursor);
    cursor = addDays(cursor, 1);
    if (cells.length > 42) break;
  }
  return cells;
}

export function sameDay(iso: string, date: Date): boolean {
  return isSameDay(parseISO(iso), date);
}

export function minutesBetween(startIso: string, endIso: string): number {
  return Math.round((parseISO(endIso).getTime() - parseISO(startIso).getTime()) / 60_000);
}
