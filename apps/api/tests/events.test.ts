import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { app, auth, createUser, isoDaysFromNow, resetDatabase } from './helpers.js';

describe('events', () => {
  beforeEach(resetDatabase);

  it('creates an event in the student local timezone with a default reminder', async () => {
    const user = await createUser({ timezone: 'Europe/Paris' });
    const date = isoDaysFromNow(3);

    const response = await request(app)
      .post('/events')
      .set(auth(user))
      .send({ title: 'Study group', date, startTime: '20:00', durationMinutes: 60, category: 'STUDY' });

    expect(response.status).toBe(201);
    const start = new Date(response.body.event.startTime);
    expect(start.toISOString()).toMatch(new RegExp(`^${date}T(18|19):00`));

    const reminders = await prisma.reminder.findMany({ where: { eventId: response.body.event.id } });
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.minutesBefore).toBe(10);
    expect(reminders[0]?.fireAt.getTime()).toBe(start.getTime() - 10 * 60_000);
  });

  it('reports conflicts without blocking the event', async () => {
    const user = await createUser();
    const date = isoDaysFromNow(4);

    await request(app)
      .post('/events')
      .set(auth(user))
      .send({ title: 'Lecture', date, startTime: '10:00', durationMinutes: 90 });

    const overlapping = await request(app)
      .post('/events')
      .set(auth(user))
      .send({ title: 'Dentist', date, startTime: '10:30', durationMinutes: 60 });

    expect(overlapping.status).toBe(201);
    expect(overlapping.body.conflicts).toHaveLength(1);
    expect(overlapping.body.conflicts[0].title).toBe('Lecture');

    const adjacent = await request(app)
      .post('/events')
      .set(auth(user))
      .send({ title: 'Coffee', date, startTime: '11:30', durationMinutes: 30 });
    expect(adjacent.body.conflicts).toHaveLength(0);
  });

  it('rejects invalid payloads', async () => {
    const user = await createUser();
    const bad = await request(app)
      .post('/events')
      .set(auth(user))
      .send({ title: '', date: '03-04-2026', startTime: '25:00' });
    expect(bad.status).toBe(400);
  });

  it('moves an event and keeps the reminder aligned', async () => {
    const user = await createUser();
    const date = isoDaysFromNow(5);
    const created = await request(app)
      .post('/events')
      .set(auth(user))
      .send({ title: 'Gym', date, startTime: '18:00', durationMinutes: 60 });

    const moved = await request(app)
      .patch(`/events/${created.body.event.id}`)
      .set(auth(user))
      .send({ startTime: '20:00' });

    expect(moved.status).toBe(200);
    const start = new Date(moved.body.event.startTime);
    const reminder = await prisma.reminder.findFirst({ where: { eventId: created.body.event.id } });
    expect(reminder?.fireAt.getTime()).toBe(start.getTime() - 10 * 60_000);
  });

  it('deletes an event and its pending reminders', async () => {
    const user = await createUser();
    const created = await request(app)
      .post('/events')
      .set(auth(user))
      .send({ title: 'Call home', date: isoDaysFromNow(2), startTime: '19:00' });

    const deleted = await request(app).delete(`/events/${created.body.event.id}`).set(auth(user));
    expect(deleted.status).toBe(200);
    expect(await prisma.reminder.count({ where: { eventId: created.body.event.id } })).toBe(0);
    expect((await request(app).get(`/events/${created.body.event.id}`).set(auth(user))).status).toBe(404);
  });

  describe('recurring classes', () => {
    it('materialises weekly occurrences and supports this/future/all edits', async () => {
      const user = await createUser({ timezone: 'Europe/Paris' });
      const created = await request(app)
        .post('/events/recurring')
        .set(auth(user))
        .send({
          title: 'Algorithms',
          courseCode: 'CS201',
          location: 'Room B12',
          byWeekday: [1, 3],
          startTime: '09:00',
          endTime: '10:30',
          startDate: '2026-03-02',
          endDate: '2026-04-27',
          category: 'CLASS',
        });

      expect(created.status).toBe(201);
      expect(created.body.occurrences).toBeGreaterThan(10);

      const list = await request(app)
        .get('/events')
        .query({ from: '2026-03-02', to: '2026-03-08' })
        .set(auth(user));
      expect(list.body.events).toHaveLength(2);

      const single = list.body.events[0];
      const one = await request(app)
        .patch(`/events/${single.id}`)
        .set(auth(user))
        .send({ location: 'Room C1', scope: 'this' });
      expect(one.status).toBe(200);
      expect(one.body.event.location).toBe('Room C1');

      const second = list.body.events[1];
      const future = await request(app)
        .patch(`/events/${second.id}`)
        .set(auth(user))
        .send({ title: 'Algorithms II', scope: 'future' });
      expect(future.status).toBe(200);

      const later = await request(app)
        .get('/events')
        .query({ from: '2026-03-09', to: '2026-03-15' })
        .set(auth(user));
      expect(later.body.events.every((event: { title: string }) => event.title === 'Algorithms II')).toBe(true);

      const removedSeries = await request(app)
        .delete(`/events/${second.id}`)
        .query({ scope: 'all' })
        .set(auth(user));
      expect(removedSeries.body.deleted).toBeGreaterThan(1);
    });
  });

  it('finds free time that avoids existing events', async () => {
    const user = await createUser({ timezone: 'Europe/Paris' });
    const date = isoDaysFromNow(6);

    await request(app)
      .post('/events')
      .set(auth(user))
      .send({ title: 'Lab', date, startTime: '09:00', durationMinutes: 240 });

    const free = await request(app)
      .get('/events/free-time')
      .query({ from: date, to: date, durationMinutes: 120, earliest: '08:00', latest: '20:00' })
      .set(auth(user));

    expect(free.status).toBe(200);
    expect(free.body.slots.length).toBeGreaterThan(0);
    const lab = await request(app)
      .get('/events')
      .query({ from: date, to: date })
      .set(auth(user));
    const labEnd = new Date(lab.body.events[0].endTime).getTime();
    expect(new Date(free.body.slots[0].start).getTime()).toBeGreaterThanOrEqual(labEnd);
  });

  it('searches events by title', async () => {
    const user = await createUser();
    await request(app)
      .post('/events')
      .set(auth(user))
      .send({ title: 'Thermodynamics revision', date: isoDaysFromNow(1), startTime: '14:00' });

    const found = await request(app).get('/events').query({ from: isoDaysFromNow(0), to: isoDaysFromNow(9), search: 'thermo' }).set(auth(user));
    expect(found.body.events).toHaveLength(1);
  });
});
