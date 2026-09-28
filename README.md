# LifePilot AI

A student planner that combines a calendar, goals, tasks, reminders, and a conversational assistant. The Expo client runs on Android and iOS, with a web preview. Express, Prisma, and PostgreSQL own the data and schedule. The assistant can only call validated, user-scoped application tools.

## Local development

Requires Node.js 22.13+, Docker with Compose, and an Android device/emulator or a Mac with Xcode for iOS.

```sh
npm run db:up                          # isolated PostgreSQL on localhost:5433
npm run install:all
cp apps/api/.env.example apps/api/.env
# Replace both JWT secrets with independent values from: openssl rand -base64 48
npm --prefix apps/api run prisma:generate
npm --prefix apps/api run prisma:migrate
npm run api                            # API on localhost:4000
npm run mobile                         # in another terminal; scan Expo QR code
```

For a phone on the same Wi-Fi, Expo replaces `localhost` in `apps/mobile/app.json` with the Metro host. Ensure your firewall permits port 4000. Use an HTTPS API URL for deployed devices. Android emulators and iOS simulators require their usual Expo setup.

`npm test` migrates and uses the isolated `lifepilot_test` database on port 5433. Override with `TEST_DATABASE_URL` if needed. Other checks: `npm run lint`, `npm run typecheck`, `npm run build` (API), and `npm run build:web` (web preview).

## How it works

- Sign up, select a timezone and recurring classes, then add events, deadlines, and goals. Today, Calendar, Chat, Goals, and Settings are the five main tabs. Tasks are accessible from Today.
- **Plan my week** proposes study blocks and weekly goal work around existing events, sleep, work hours, breaks, deadlines, priorities, and protected evenings. The server applies the proposal only after approval. A revision check rejects outdated previews.
- Chat stores conversations in PostgreSQL. Mock mode is the default rule-based assistant. For model-backed chat, enter and test your own OpenAI key in Settings. The key is encrypted on the server and never sent back to the phone; `JWT_REFRESH_SECRET` also derives its encryption key, so changing that secret invalidates stored personal keys. The model cannot run SQL.
- Events and tasks persist on the server. The client keeps the last schedule and goals locally for offline reading. Editing and chat require a connection. Local notifications are scheduled when the app syncs while online; edits and deletions reconcile pending notifications. Notification permission is required, and delivery must be checked on a real device before depending on it. The backend push worker is disabled by default to avoid duplicate delivery.
- Email/password sessions, refresh token rotation, user-scoped queries, account deletion, data export, and optional verified Google/Apple sign-in are provided. Social sign-in needs provider IDs configured before use.

The API's OpenAI server fallback can also be configured with `AI_PROVIDER=openai` and `OPENAI_API_KEY`. The default stays in mock mode without any key. Never commit `.env` or put provider keys in the mobile app.

## Release

See [docs/RELEASE.md](docs/RELEASE.md) for backend deployment and platform builds. The web bundle is a development preview; native notification delivery needs Android/iOS testing.
