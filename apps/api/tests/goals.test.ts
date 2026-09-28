import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, auth, createUser, resetDatabase } from './helpers.js';

describe('goals and planning preferences', () => {
  beforeEach(resetDatabase);

  it('persists goals and isolates them between users', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const created = await request(app).post('/goals').set(auth(owner))
      .send({ title: 'Make time for friends', weeklyMinutes: 180 });
    expect(created.status).toBe(201);
    const id = created.body.goal.id;
    expect((await request(app).get('/goals').set(auth(stranger))).body.goals).toEqual([]);
    expect((await request(app).patch(`/goals/${id}`).set(auth(stranger)).send({ progress: 100 })).status).toBe(404);
    expect((await request(app).delete(`/goals/${id}`).set(auth(stranger))).status).toBe(404);
    expect((await request(app).patch(`/goals/${id}`).set(auth(owner)).send({ status: 'PAUSED', progress: 35 })).body.goal.progress).toBe(35);
    expect((await request(app).get('/goals').set(auth(owner))).body.goals[0].status).toBe('PAUSED');
    expect((await request(app).delete(`/goals/${id}`).set(auth(owner))).status).toBe(204);
  });

  it('validates sleep and working hours without saving invalid preferences', async () => {
    const user = await createUser();
    expect((await request(app).patch('/users/me').set(auth(user)).send({ wakeTime: '25:00' })).status).toBe(400);
    expect((await request(app).patch('/users/me').set(auth(user)).send({ workEndTime: '23:30' })).status).toBe(400);
    const saved = await request(app).patch('/users/me').set(auth(user))
      .send({ wakeTime: '06:30', workStartTime: '08:00', protectEvenings: true });
    expect(saved.status).toBe(200);
    expect(saved.body.user).toMatchObject({ wakeTime: '06:30', workStartTime: '08:00', protectEvenings: true });
  });
});
