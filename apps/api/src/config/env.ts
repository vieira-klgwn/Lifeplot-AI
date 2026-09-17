import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z.string().default(''),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  GOOGLE_CLIENT_IDS: z.string().default(''),
  APPLE_CLIENT_IDS: z.string().default(''),
  AI_PROVIDER: z.enum(['openai', 'local']).default('local'),
  AI_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  EXPO_PUSH_URL: z.string().url().default('https://exp.host/--/api/v2/push/send'),
  REMINDER_WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const data = parsed.data;

export const env = {
  ...data,
  corsOrigins: data.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  googleClientIds: data.GOOGLE_CLIENT_IDS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  appleClientIds: data.APPLE_CLIENT_IDS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  isProduction: data.NODE_ENV === 'production',
  isTest: data.NODE_ENV === 'test',
};

export type Env = typeof env;
