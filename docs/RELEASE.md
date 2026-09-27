# Release guide

## Backend

1. Provision PostgreSQL and set environment variables from `apps/api/.env.example`. Generate independent 32+ character JWT secrets; back up `JWT_REFRESH_SECRET` securely because it also derives the encryption key for personal AI keys.
2. Run `npm --prefix apps/api ci`, `npm --prefix apps/api run prisma:generate`, `npm --prefix apps/api run prisma:migrate`, and `npm run build`.
3. Run `node apps/api/dist/index.js` behind HTTPS with `CORS_ORIGINS` restricted to your domains. Keep `REMINDER_WORKER_ENABLED=false` while using device-local notifications. If you enable the legacy push worker, configure delivery and duplicate prevention before production use.
4. Configure Google/Apple client IDs if offering social sign-in. OpenAI keys may instead be added by each user in Settings.

## Mobile

1. In `apps/mobile`, run `eas init` to replace the placeholder EAS project ID in `app.json`. Set `extra.apiUrl` to the deployed HTTPS backend.
2. Configure production package/bundle identifiers and signing in EAS. Use `eas build --platform android --profile production` and `eas build --platform ios --profile production`; configure build profiles for your EAS account first.
3. Install each signed build on a device. Check notification permission, local reminder delivery after closing the app, reminder rescheduling, timezone changes, and sign-out cancellation on both platforms. Android and iOS notification delivery is not verified by a web preview.
4. Submit through `eas submit --platform android` and `eas submit --platform ios` after testing and store review.

The API stores schedules, tasks, goals, conversations, and encrypted personal AI keys. Account deletion and data export are in Settings. Review privacy declarations and social sign-in requirements for each store before submission.
