# Release guide

## Backend

1. Provision PostgreSQL and set the production environment (see `apps/api/.env.example`).
   `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must be unique 32+ character random strings.
2. `npm --prefix apps/api ci && npm --prefix apps/api run build`
3. `npx prisma migrate deploy`
4. Run `node dist/index.js` behind TLS. Keep `REMINDER_WORKER_ENABLED=true` on exactly
   one instance so push reminders are delivered once.
5. Set `CORS_ORIGINS` to your app domains only, and `AI_PROVIDER=openai` with
   `OPENAI_API_KEY` if you want model-backed understanding.

## Mobile

1. `npm i -g eas-cli && eas login`
2. `eas init` in `apps/mobile`, then replace the placeholder `extra.eas.projectId`.
3. Point `extra.apiUrl` at the production API URL (HTTPS).
4. Builds:
   - `eas build --platform ios --profile production`
   - `eas build --platform android --profile production`
5. Push credentials: `eas credentials` (APNs key for iOS, FCM v1 service account for Android).
   Expo Push needs both before reminders work in release builds.
6. Submit: `eas submit --platform ios` / `eas submit --platform android`.

## Store listings

- Privacy: the app stores the student's schedule, tasks and assistant messages.
  Analytics are opt-out and contain no event contents. Declare "Contacts info
  (email)", "User content (calendar)" and "Identifiers".
- Apple requires Sign in with Apple when other social sign-in is offered; it is
  implemented (`POST /auth/social` with `provider: "APPLE"`).
- Account deletion is required by both stores and is available in Settings
  (`DELETE /auth/account`).
- Android 13+ needs the runtime notification permission, requested on first launch.
