import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { setAIProvider } from '../src/modules/ai/index.js';
import { LocalProvider } from '../src/modules/ai/provider/local.js';

export const app: Express = createApp();

export interface TestUser {
  id: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Message", "Conversation", "Reminder", "Event", "RecurrenceRule", "Task", "RefreshToken", "PasswordResetToken", "AnalyticsEvent", "User" RESTART IDENTITY CASCADE',
  );
  setAIProvider(new LocalProvider());
}

let counter = 0;

export async function createUser(
  overrides: { timezone?: string; password?: string } = {},
): Promise<TestUser> {
  counter += 1;
  const email = `student${counter}-${Date.now()}@uni.test`;
  const password = overrides.password ?? 'sup3r-secret-pass';

  const response = await request(app).post('/auth/register').send({
    email,
    password,
    name: `Student ${counter}`,
    timezone: overrides.timezone ?? 'Europe/Paris',
  });

  if (response.status !== 201) {
    throw new Error(`Failed to register test user: ${JSON.stringify(response.body)}`);
  }

  return {
    id: response.body.user.id,
    email,
    accessToken: response.body.accessToken,
    refreshToken: response.body.refreshToken,
  };
}

export const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.accessToken}` });

export function isoDaysFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
