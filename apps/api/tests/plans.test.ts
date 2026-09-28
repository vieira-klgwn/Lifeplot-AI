import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, auth, createUser, isoDaysFromNow, resetDatabase } from './helpers.js';

describe('schedule proposals', () => {
  beforeEach(resetDatabase);

  it('keeps commitments and protected evenings while requiring approval', async () => {
    const user = await createUser();
    const date = isoDaysFromNow(2);
    await request(app).patch('/users/me').set(auth(user)).send({
      wakeTime: '07:00', bedTime: '22:00', workStartTime: '09:00',
      workEndTime: '21:00', protectEvenings: true, breakMinutes: 15,
    });
    await request(app).post('/events').set(auth(user)).send({
      title: 'Fixed class', date, startTime: '09:00', endTime: '10:00', category: 'CLASS',
    });
    await request(app).post('/tasks').set(auth(user)).send({
      title: 'Calculus', deadlineDate: date, deadlineTime: '18:00', estimatedMinutes: 90,
    });
    await request(app).post('/tasks').set(auth(user)).send({
      title: 'Reading', deadlineDate: date, deadlineTime: '18:00', estimatedMinutes: 45,
    });

    const preview = await request(app).post('/plans/preview').set(auth(user)).send({ date });
    expect(preview.status).toBe(200);
    expect(preview.body.plan.sessions).toHaveLength(2);
    expect(preview.body.plan.sessions[0].startTime).toBeDefined();
    const sorted = preview.body.plan.sessions.map((session: { startTime: string; endTime: string }) => ({
      start: new Date(session.startTime).getTime(), end: new Date(session.endTime).getTime(),
    })).sort((a: { start: number }, b: { start: number }) => a.start - b.start);
    expect(sorted[1].start - sorted[0].end).toBeGreaterThanOrEqual(15 * 60_000);
    const before = await request(app).get('/events').set(auth(user)).query({ from: date, to: date });
    expect(before.body.events).toHaveLength(1);

    const applied = await request(app).post('/plans/apply').set(auth(user))
      .send({ date, revision: preview.body.plan.revision });
    expect(applied.status).toBe(200);
    expect(applied.body.added).toBe(2);
    expect((await request(app).get('/events').set(auth(user)).query({ from: date, to: date })).body.events).toHaveLength(3);
    expect((await request(app).post('/plans/apply').set(auth(user))
      .send({ date, revision: preview.body.plan.revision })).status).toBe(409);
  });

  it('reports tasks that cannot fit and rejects stale previews', async () => {
    const user = await createUser();
    const date = isoDaysFromNow(2);
    await request(app).post('/tasks').set(auth(user)).send({
      title: 'Impossible workload', deadlineDate: date, deadlineTime: '09:01', estimatedMinutes: 300,
    });
    const preview = await request(app).post('/plans/preview').set(auth(user)).send({ date });
    expect(preview.body.plan.unscheduled).toHaveLength(1);
    await request(app).post('/events').set(auth(user)).send({
      title: 'New commitment', date, startTime: '12:00', endTime: '13:00',
    });
    expect((await request(app).post('/plans/apply').set(auth(user))
      .send({ date, revision: preview.body.plan.revision })).status).toBe(409);
  });

  it('reserves time for active goals without scheduling the same commitment twice', async () => {
    const user = await createUser();
    const date = isoDaysFromNow(2);
    const active = await request(app).post('/goals').set(auth(user))
      .send({ title: 'Startup prototype', weeklyMinutes: 120, priority: 3 });
    await request(app).post('/goals').set(auth(user))
      .send({ title: 'Paused goal', weeklyMinutes: 120, status: 'PAUSED' });
    const preview = await request(app).post('/plans/preview').set(auth(user)).send({ date });
    expect(preview.body.plan.sessions).toHaveLength(2);
    expect(preview.body.plan.sessions.every((item: { goalId: string }) => item.goalId === active.body.goal.id)).toBe(true);
    expect((await request(app).post('/plans/apply').set(auth(user))
      .send({ date, revision: preview.body.plan.revision })).status).toBe(200);
    const again = await request(app).post('/plans/preview').set(auth(user)).send({ date });
    expect(again.body.plan.sessions).toHaveLength(0);
  });

  it('rejects linking a task to another user goal', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const goal = await request(app).post('/goals').set(auth(owner)).send({ title: 'Private project' });
    const response = await request(app).post('/tasks').set(auth(stranger))
      .send({ title: 'Spy task', goalId: goal.body.goal.id });
    expect(response.status).toBe(404);
  });
});
