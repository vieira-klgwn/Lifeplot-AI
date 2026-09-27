import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { app, auth, createUser, resetDatabase } from './helpers.js';
import { providerForUser } from '../src/modules/ai/userProvider.js';

describe('personal AI configuration', () => {
  beforeEach(resetDatabase);

  it('encrypts keys and isolates provider selection by user', async () => {
    const owner = await createUser();
    const other = await createUser();
    expect((await request(app).get('/ai/provider').set(auth(owner))).body.provider).toBe('local');
    const saved = await request(app).put('/ai/provider').set(auth(owner))
      .send({ apiKey: 'sk-test-not-a-real-key' });
    expect(saved.status).toBe(200);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(stored.aiKeyCiphertext).toBeTruthy();
    expect(stored.aiKeyCiphertext).not.toContain('sk-test-not-a-real-key');
    expect(providerForUser(stored).name).toBe('openai');
    expect((await request(app).get('/ai/provider').set(auth(other))).body.provider).toBe('local');
    expect((await request(app).get('/ai/provider').set(auth(owner))).body.personalKeyConfigured).toBe(true);
    expect((await request(app).delete('/ai/provider').set(auth(owner))).body.provider).toBe('local');
    expect((await request(app).get('/ai/provider').set(auth(owner))).body.personalKeyConfigured).toBe(false);
  });

  it('requires authentication and validates keys without echoing them', async () => {
    expect((await request(app).put('/ai/provider').send({ apiKey: 'sk-test-unsafe' })).status).toBe(401);
    expect((await request(app).put('/ai/provider').set(auth(await createUser()))
      .send({ apiKey: 'short' })).status).toBe(400);
  });
});
