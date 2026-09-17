import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { app, auth, createUser, isoDaysFromNow, resetDatabase } from './helpers.js';

describe('tasks and deadlines', () => {
  beforeEach(resetDatabase);

  it('creates a task with a deadline reminder and completes it', async () => {
    const user = await createUser();
    const created = await request(app)
      .post('/tasks')
      .set(auth(user))
      .send({ title: 'Essay draft', deadlineDate: isoDaysFromNow(4), deadlineTime: '23:59', estimatedMinutes: 120 });

    expect(created.status).toBe(201);
    const reminders = await prisma.reminder.findMany({ where: { taskId: created.body.task.id } });
    expect(reminders).toHaveLength(1);

    const done = await request(app)
      .patch(`/tasks/${created.body.task.id}`)
      .set(auth(user))
      .send({ status: 'DONE' });
    expect(done.body.task.status).toBe('DONE');

    // Completing a task must stop its reminder from firing.
    const pending = await prisma.reminder.count({
      where: { taskId: created.body.task.id, status: 'PENDING' },
    });
    expect(pending).toBe(0);
  });

  it('supports tasks without a deadline', async () => {
    const user = await createUser();
    const created = await request(app).post('/tasks').set(auth(user)).send({ title: 'Read chapter 4' });
    expect(created.status).toBe(201);
    expect(created.body.task.deadline).toBeNull();
    expect(await prisma.reminder.count({ where: { taskId: created.body.task.id } })).toBe(0);
  });

  it('hides completed tasks unless asked', async () => {
    const user = await createUser();
    const created = await request(app).post('/tasks').set(auth(user)).send({ title: 'Lab report' });
    await request(app).patch(`/tasks/${created.body.task.id}`).set(auth(user)).send({ status: 'DONE' });

    expect((await request(app).get('/tasks').set(auth(user))).body.tasks).toHaveLength(0);
    expect(
      (await request(app).get('/tasks').query({ includeDone: true }).set(auth(user))).body.tasks,
    ).toHaveLength(1);
  });
});
