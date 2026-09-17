import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql://postgres:postgres@localhost:5432/uniflow_test?schema=public',
      JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef',
      JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef',
      AI_PROVIDER: 'local',
      REMINDER_WORKER_ENABLED: 'false',
    },
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    hookTimeout: 60_000,
    testTimeout: 30_000,
    pool: 'forks',
    // Every test file truncates the shared test database, so they must not overlap.
    fileParallelism: false,
    maxWorkers: 1,
  },
});
