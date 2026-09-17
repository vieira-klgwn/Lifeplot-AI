import { describe, expect, it } from 'vitest';
import { findFreeSlots } from '../src/services/freeTime.js';

const tz = 'Europe/Paris';

describe('free time search', () => {
  it('skips busy blocks and returns the earliest fitting slot', () => {
    const slots = findFreeSlots({
      days: ['2026-03-04'],
      timezone: tz,
      durationMinutes: 120,
      dayStart: '08:00',
      dayEnd: '18:00',
      notBefore: new Date('2026-03-04T06:00:00.000Z'),
      busy: [
        { startTime: new Date('2026-03-04T07:00:00.000Z'), endTime: new Date('2026-03-04T10:00:00.000Z') },
      ],
      limit: 2,
    });

    expect(slots[0]?.start.toISOString()).toBe('2026-03-04T10:00:00.000Z');
    expect(slots[0]?.end.toISOString()).toBe('2026-03-04T12:00:00.000Z');
  });

  it('never proposes a slot past a deadline', () => {
    const slots = findFreeSlots({
      days: ['2026-03-04'],
      timezone: tz,
      durationMinutes: 180,
      notBefore: new Date('2026-03-04T06:00:00.000Z'),
      notAfter: new Date('2026-03-04T08:00:00.000Z'),
      busy: [],
    });

    expect(slots).toHaveLength(0);
  });

  it('returns nothing when the day is fully booked', () => {
    const slots = findFreeSlots({
      days: ['2026-03-04'],
      timezone: tz,
      durationMinutes: 60,
      dayStart: '08:00',
      dayEnd: '12:00',
      notBefore: new Date('2026-03-04T00:00:00.000Z'),
      busy: [
        { startTime: new Date('2026-03-04T07:00:00.000Z'), endTime: new Date('2026-03-04T11:00:00.000Z') },
      ],
    });

    expect(slots).toHaveLength(0);
  });
});
