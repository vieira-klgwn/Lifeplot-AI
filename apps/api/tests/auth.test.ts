import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, auth, createUser, resetDatabase } from './helpers.js';

describe('authentication', () => {
  beforeEach(resetDatabase);

  it('registers, returns a session and rejects duplicate emails', async () => {
    const email = `dup-${Date.now()}@uni.test`;
    const payload = { email, password: 'sup3r-secret-pass', name: 'Dup', timezone: 'Europe/Paris' };

    const created = await request(app).post('/auth/register').send(payload);
    expect(created.status).toBe(201);
    expect(created.body.accessToken).toBeTruthy();
    expect(created.body.user.passwordHash).toBeUndefined();

    const duplicate = await request(app).post('/auth/register').send(payload);
    expect(duplicate.status).toBe(409);
  });

  it('rejects weak passwords', async () => {
    const response = await request(app)
      .post('/auth/register')
      .send({ email: `weak-${Date.now()}@uni.test`, password: 'short', name: 'Weak' });
    expect(response.status).toBe(400);
  });

  it('logs in with valid credentials only', async () => {
    const user = await createUser({ password: 'sup3r-secret-pass' });

    const ok = await request(app).post('/auth/login').send({ email: user.email, password: 'sup3r-secret-pass' });
    expect(ok.status).toBe(200);

    const bad = await request(app).post('/auth/login').send({ email: user.email, password: 'wrong-password-x' });
    expect(bad.status).toBe(401);
    expect(JSON.stringify(bad.body)).not.toMatch(/hash/i);
  });

  it('rotates refresh tokens and invalidates the used one', async () => {
    const user = await createUser();

    const refreshed = await request(app).post('/auth/refresh').send({ refreshToken: user.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refreshToken).not.toBe(user.refreshToken);

    const replay = await request(app).post('/auth/refresh').send({ refreshToken: user.refreshToken });
    expect(replay.status).toBe(401);
  });

  it('resets a password and revokes existing sessions', async () => {
    const user = await createUser({ password: 'sup3r-secret-pass' });

    const requested = await request(app).post('/auth/password-reset/request').send({ email: user.email });
    expect(requested.status).toBe(200);
    const token = requested.body.resetToken as string;

    const confirmed = await request(app)
      .post('/auth/password-reset/confirm')
      .send({ token, password: 'a-brand-new-password' });
    expect(confirmed.status).toBe(204);

    const oldSession = await request(app).post('/auth/refresh').send({ refreshToken: user.refreshToken });
    expect(oldSession.status).toBe(401);

    const login = await request(app)
      .post('/auth/login')
      .send({ email: user.email, password: 'a-brand-new-password' });
    expect(login.status).toBe(200);
  });

  it('does not leak whether an email exists on reset request', async () => {
    const response = await request(app)
      .post('/auth/password-reset/request')
      .send({ email: `ghost-${Date.now()}@uni.test` });
    expect(response.status).toBe(200);
    expect(response.body.token).toBeUndefined();
  });

  it('requires a valid bearer token for protected routes', async () => {
    const user = await createUser();

    expect((await request(app).get('/users/me')).status).toBe(401);
    expect((await request(app).get('/users/me').set('Authorization', 'Bearer nope')).status).toBe(401);
    expect((await request(app).get('/users/me').set(auth(user))).status).toBe(200);
  });

  it('logs out by revoking the refresh token', async () => {
    const user = await createUser();
    expect((await request(app).post('/auth/logout').send({ refreshToken: user.refreshToken })).status).toBe(204);
    expect((await request(app).post('/auth/refresh').send({ refreshToken: user.refreshToken })).status).toBe(401);
  });
});
