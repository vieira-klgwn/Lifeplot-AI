import { describe, expect, it } from 'vitest';
import { durationMinutes, expandOccurrences, parseHHmm } from '../src/services/recurrence.js';

describe('recurrence expansion', () => {
  it('creates one occurrence per selected weekday', () => {
    const occurrences = expandOccurrences({
      byWeekday: [1, 3, 5],
      startTime: '09:00',
      endTime: '10:15',
      startDate: new Date('2026-03-02T00:00:00.000Z'),
      endDate: new Date('2026-03-15T00:00:00.000Z'),
      timezone: 'Europe/Paris',
    });

    expect(occurrences).toHaveLength(6);
    expect(occurrences[0]?.startTime.toISOString()).toBe('2026-03-02T08:00:00.000Z');
    expect(occurrences[0]?.endTime.toISOString()).toBe('2026-03-02T09:15:00.000Z');
  });

  it('keeps the local wall-clock time across a DST boundary', () => {
    const occurrences = expandOccurrences({
      byWeekday: [1],
      startTime: '09:00',
      endTime: '10:00',
      startDate: new Date('2026-03-23T00:00:00.000Z'),
      endDate: new Date('2026-04-06T00:00:00.000Z'),
      timezone: 'Europe/Paris',
    });

    // Paris moves to UTC+2 on 29 March 2026.
    expect(occurrences[0]?.startTime.toISOString()).toBe('2026-03-23T08:00:00.000Z');
    expect(occurrences[1]?.startTime.toISOString()).toBe('2026-03-30T07:00:00.000Z');
  });

  it('rejects malformed times and inverted ranges', () => {
    expect(() => parseHHmm('9:00')).toThrow();
    expect(durationMinutes('09:00', '10:15')).toBe(75);
    expect(() =>
      expandOccurrences({
        byWeekday: [1],
        startTime: '10:00',
        endTime: '09:00',
        startDate: new Date('2026-03-02T00:00:00.000Z'),
        endDate: new Date('2026-03-09T00:00:00.000Z'),
        timezone: 'UTC',
      }),
    ).toThrow(/end after/);
  });
});
