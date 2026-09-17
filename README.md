# UniFlow

An AI-powered schedule assistant for university students. Students talk to their
calendar instead of managing it: "I just got an unexpected meeting with some
important people tonight at 8, add it and remind me 10 minutes before" creates
the event, the default 60-minute block and the reminder in one turn.

```
apps/mobile   Expo + React Native + TypeScript client (iOS, Android, web preview)
apps/api      Node + Express + Prisma + PostgreSQL backend, AI tool layer, reminder worker
```

## Architecture

```
Mobile app ──> API ──> Auth / Scheduling service ──> PostgreSQL
                │
                └──> AI assistant ──> validated scheduling tools ──> Scheduling service
```

The language model never touches the database. It may only emit tool calls
(`create_event`, `update_event`, `delete_event`, `find_free_time`,
`get_schedule`, `create_recurring_event`, `set_reminder`, `remove_reminder`,
`search_events`, `create_task`). Every tool validates its arguments with Zod and
derives ownership from the authenticated user, so a model hallucinating another
student's id cannot read or change their data.

`AI_PROVIDER` selects the provider: `openai` uses OpenAI tool calling,
`local` (also the fallback when no key is configured) uses a deterministic
parser so the app, the tests and offline development still work.

## Requirements

- Node.js 20+ (developed on 24)
- Docker (for PostgreSQL) or any reachable PostgreSQL 14+
- Expo Go, an Android emulator, or an iOS simulator

## Getting started

```bash
npm run db:up                 # PostgreSQL on :5432
npm run install:all
cp apps/api/.env.example apps/api/.env   # then fill in the secrets
npm --prefix apps/api run prisma:migrate
npm run api                   # http://localhost:4000
npm run mobile                # Expo dev server
```

The mobile client reads `expo.extra.apiUrl` from `apps/mobile/app.json`. When it
still points at `localhost`, the Metro host is substituted automatically so a
phone on the same network reaches your machine.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm test` | API unit, integration and security tests (Vitest) |
| `npm run lint` | ESLint for API and mobile |
| `npm run typecheck` | TypeScript for API and mobile |
| `npm run build` | API production build |
| `npm run build:web` | Mobile web bundle (`apps/mobile/dist`) |

Tests need a database; they use `TEST_DATABASE_URL` or
`postgresql://postgres:postgres@localhost:5432/uniflow_test`.

## Features

- Email/password accounts, Google and Apple ID token sign-in, refresh-token rotation
- Onboarding that adds recurring classes for a term
- Today, week and month views with a day detail list
- Conversational scheduling with undo for anything the assistant changed
- Conflict detection and free-time search ("when am I free for 90 minutes?")
- Tasks and deadlines with reminders
- Reminders default to 10 minutes and are delivered through Expo Push by a
  backend worker, so they arrive while the app is closed
- Offline access to the cached schedule; the assistant degrades gracefully
- System/light/dark themes, accessible labels and 48px touch targets

## Security

- bcrypt password hashing, short-lived access tokens, hashed opaque refresh tokens
- Password-reset tokens stored hashed in their own table; reset revokes all sessions
- Google/Apple ID tokens verified against provider JWKS
- Every query scoped by the authenticated user id; request bodies can never
  reassign ownership
- Rate limits on credential and AI endpoints, Helmet, CORS allowlist, 256 KB body cap
- Event text is treated as user data, never as instructions to the model
- Analytics are opt-out and never include event contents

## Release

See [docs/RELEASE.md](docs/RELEASE.md) for App Store and Google Play steps.
