import { execFileSync } from 'node:child_process';

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/uniflow_test?schema=public';

/** Applies migrations to the test database once before the suite runs. */
export default function setup(): void {
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL },
  });
}
