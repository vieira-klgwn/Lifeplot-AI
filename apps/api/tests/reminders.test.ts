import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { dispatchDueReminders } from '../src/services/reminderWorker.js';
import { app, auth, createUser, isoDaysFromNow, resetDatabase } from './helpers.js';

describe('reminders and notifications', () => {
  beforeEach(resetDatabase);
  afterEach(() => vi.restoreAllMocks());

  it('uses a per-category default when configured', async () => {
    const user = await createUser();
    await request(app)
      .patch('/users/me')
      .set(auth(user))
      .send({ defaultReminderMinutes: 15, categoryReminderMinutes: { EXAM: 60 } });

    const exam = await request(app)
      .post('/events')
      .set(auth(user))
      .send({ title: 'Midterm', date: isoDaysFromNow(7), startTime: '09:00', category: 'EXAM' });
    const study = await request(app)
      .post('/events')
      .set(auth(user))
      .send({ title: 'Revision', date: isoDaysFromNow(7), startTime: '14:00', category: 'STUDY' });

    const examReminder = await prisma.reminder.findFirst({ where: { eventId: exam.body.event.id } });
    const studyReminder = await prisma.reminder.findFirst({ where: { eventId: study.body.event.id } });
    expect(examReminder?.minutesBefore).toBe(60);
    expect(studyReminder?.minutesBefore).toBe(15);
  });

  it('replaces a reminder when the student sets a custom offset', async () => {
    const user = await createUser();
    const event = await request(app)
      .post('/events')
      .set(auth(user))
      .send({ title: 'Seminar', date: isoDaysFromNow(2), startTime: '11:00' });

    const custom = await request(app)
      .post('/reminders')
      .set(auth(user))
      .send({ eventId: event.body.event.id, minutesBefore: 30 });
    expect(custom.status).toBe(201);

    const reminders = await prisma.reminder.findMany({ where: { eventId: event.body.event.id } });
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.minutesBefore).toBe(30);
  });

  it('keeps reminders aligned to wall-clock time after a timezone change', async () => {
    const user = await createUser({ timezone: 'Europe/Paris' });
    const event = await request(app)
      .post('/events')
      .set(auth(user))
      .send({ title: 'Standup', date: isoDaysFromNow(3), startTime: '09:00' });

    await request(app).patch('/users/me').set(auth(user)).send({ timezone: 'America/New_York' });

    const reminder = await prisma.reminder.findFirst({ where: { eventId: event.body.event.id } });
    const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.body.event.id } });
    expect(reminder?.fireAt.getTime()).toBe(stored.startTime.getTime() - 10 * 60_000);
  });

  it('dispatches due reminders through the push service exactly once', async () => {
    const user = await createUser();
    await request(app)
      .put('/users/me/push-token')
      .set(auth(user))
      .send({ pushToken: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' });

    const event = await request(app)
      .post('/events')
      .set(auth(user))
      .send({ title: 'Meeting', date: isoDaysFromNow(1), startTime: '08:00' });

    const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.body.event.id } });
    await prisma.reminder.updateMany({
      where: { eventId: stored.id },
      data: { fireAt: new Date(Date.now() - 60_000) },
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ status: 'ok' }] }), { status: 200 }),
    );

    const first = await dispatchDueReminders();
    expect(first.sent).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await dispatchDueReminders();
    expect(second.sent).toBe(0);
  });

  it('never sends to a student who disabled notifications', async () => {
    const user = await createUser();
    await request(app)
      .put('/users/me/push-token')
      .set(auth(user))
      .send({ pushToken: 'ExponentPushToken[yyyyyyyyyyyyyyyyyyyyyy]' });
    await request(app).patch('/users/me').set(auth(user)).send({ notificationsEnabled: false });

    const event = await request(app)
      .post('/events')
      .set(auth(user))
      .send({ title: 'Quiet', date: isoDaysFromNow(1), startTime: '08:00' });
    await prisma.reminder.updateMany({
      where: { eventId: event.body.event.id },
      data: { fireAt: new Date(Date.now() - 60_000) },
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const result = await dispatchDueReminders();
    expect(result.sent).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
