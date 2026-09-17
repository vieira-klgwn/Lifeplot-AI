import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { app, auth, createUser, isoDaysFromNow, resetDatabase } from './helpers.js';

describe('authorization and data isolation', () => {
  beforeEach(resetDatabase);

  it('never exposes another student data through any resource route', async () => {
    const owner = await createUser();
    const intruder = await createUser();

    const event = await request(app)
      .post('/events')
      .set(auth(owner))
      .send({ title: 'Private exam', date: isoDaysFromNow(3), startTime: '09:00' });
    const task = await request(app).post('/tasks').set(auth(owner)).send({ title: 'Private task' });
    const reminder = await prisma.reminder.findFirstOrThrow({ where: { eventId: event.body.event.id } });

    const eventId = event.body.event.id as string;
    const taskId = task.body.task.id as string;

    expect((await request(app).get(`/events/${eventId}`).set(auth(intruder))).status).toBe(404);
    expect((await request(app).patch(`/events/${eventId}`).set(auth(intruder)).send({ title: 'hacked' })).status).toBe(404);
    expect((await request(app).delete(`/events/${eventId}`).set(auth(intruder))).status).toBe(404);
    expect((await request(app).get(`/tasks/${taskId}`).set(auth(intruder))).status).toBe(404);
    expect((await request(app).delete(`/reminders/${reminder.id}`).set(auth(intruder))).status).toBe(404);

    const list = await request(app)
      .get('/events')
      .query({ from: isoDaysFromNow(0), to: isoDaysFromNow(9) })
      .set(auth(intruder));
    expect(list.body.events).toHaveLength(0);

    const stillThere = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(stillThere.title).toBe('Private exam');
  });

  it('cannot reassign an event to another user through the API', async () => {
    const owner = await createUser();
    const other = await createUser();
    const event = await request(app)
      .post('/events')
      .set(auth(owner))
      .send({ title: 'Mine', date: isoDaysFromNow(1), startTime: '10:00', userId: other.id });

    const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.body.event.id } });
    expect(stored.userId).toBe(owner.id);
  });

  it('does not return password hashes or tokens in user payloads', async () => {
    const user = await createUser();
    const me = await request(app).get('/users/me').set(auth(user));
    const body = JSON.stringify(me.body);
    expect(body).not.toMatch(/passwordHash|\$2[aby]\$/);
    expect(body).not.toMatch(/refreshToken/);
  });

  it('stores refresh and reset tokens hashed, never in plaintext', async () => {
    const user = await createUser();
    const stored = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).not.toBe(user.refreshToken);
    expect(stored[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects unauthenticated access to every protected router', async () => {
    for (const path of ['/users/me', '/events?from=2026-01-01&to=2026-01-02', '/tasks', '/reminders', '/ai/conversation']) {
      expect((await request(app).get(path)).status).toBe(401);
    }
    expect((await request(app).post('/ai/chat').send({ message: 'hi' })).status).toBe(401);
  });

  it('treats SQL-looking input as plain text', async () => {
    const user = await createUser();
    const title = "Robert'); DROP TABLE \"Event\";--";
    const created = await request(app)
      .post('/events')
      .set(auth(user))
      .send({ title, date: isoDaysFromNow(2), startTime: '12:00' });

    expect(created.status).toBe(201);
    const search = await request(app)
      .get('/events')
      .query({ from: isoDaysFromNow(0), to: isoDaysFromNow(9), search: "DROP TABLE" })
      .set(auth(user));
    expect(search.body.events).toHaveLength(1);
    expect(await prisma.event.count()).toBe(1);
  });

  it('deleting an account removes all of its schedule data', async () => {
    const user = await createUser();
    await request(app).post('/events').set(auth(user)).send({ title: 'Gone', date: isoDaysFromNow(1), startTime: '10:00' });

    expect((await request(app).delete('/auth/account').set(auth(user))).status).toBe(204);
    expect(await prisma.event.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
  });
});
