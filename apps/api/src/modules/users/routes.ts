import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { badRequest } from '../../lib/errors.js';
import { isValidTimezone } from '../../lib/time.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { currentUser, requireAuth } from '../../middleware/requireAuth.js';
import { toPublicUser } from '../auth/service.js';
import { reconcileUserReminders } from '../../services/reminders.js';
import { isExpoPushToken } from '../../services/push.js';
import { track } from '../../services/analytics.js';

export const userRouter = Router();
userRouter.use(requireAuth);
const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

userRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    res.json({ user: toPublicUser(currentUser(req)) });
  }),
);

userRouter.patch(
  '/me',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().min(1).max(80).optional(),
        university: z.string().max(120).nullable().optional(),
        timezone: z.string().max(64).optional(),
        weekStartsOn: z.number().int().min(0).max(1).optional(),
        defaultReminderMinutes: z.number().int().min(0).max(60 * 24 * 14).optional(),
        wakeTime: TIME.optional(),
        bedTime: TIME.optional(),
        workStartTime: TIME.optional(),
        workEndTime: TIME.optional(),
        breakMinutes: z.number().int().min(0).max(60).optional(),
        protectEvenings: z.boolean().optional(),
        categoryReminderMinutes: z.record(z.number().int().min(0).max(60 * 24 * 14)).optional(),
        notificationsEnabled: z.boolean().optional(),
        analyticsEnabled: z.boolean().optional(),
        onboarded: z.boolean().optional(),
      })
      .parse(req.body);

    if (body.timezone && !isValidTimezone(body.timezone)) {
      throw badRequest(`"${body.timezone}" is not a known timezone`);
    }

    const user = currentUser(req);
    const wakeTime = body.wakeTime ?? user.wakeTime;
    const bedTime = body.bedTime ?? user.bedTime;
    const workStartTime = body.workStartTime ?? user.workStartTime;
    const workEndTime = body.workEndTime ?? user.workEndTime;
    if (wakeTime >= bedTime || workStartTime < wakeTime || workEndTime > bedTime || workStartTime >= workEndTime) {
      throw badRequest('Working hours must fall between wake-up and bedtime');
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        name: body.name ?? undefined,
        university: body.university === undefined ? undefined : body.university,
        timezone: body.timezone ?? undefined,
        weekStartsOn: body.weekStartsOn ?? undefined,
        defaultReminderMinutes: body.defaultReminderMinutes ?? undefined,
        wakeTime: body.wakeTime,
        bedTime: body.bedTime,
        workStartTime: body.workStartTime,
        workEndTime: body.workEndTime,
        breakMinutes: body.breakMinutes,
        protectEvenings: body.protectEvenings,
        categoryReminderMinutes: body.categoryReminderMinutes ?? undefined,
        notificationsEnabled: body.notificationsEnabled ?? undefined,
        analyticsEnabled: body.analyticsEnabled ?? undefined,
        onboardedAt: body.onboarded ? (user.onboardedAt ?? new Date()) : undefined,
      },
    });

    // A timezone change keeps wall-clock reminders aligned with their events.
    if (body.timezone && body.timezone !== user.timezone) {
      await reconcileUserReminders(user.id);
    }
    if (body.onboarded && !user.onboardedAt) {
      await track('onboarding_completed', user.id);
    }

    res.json({ user: toPublicUser(updated) });
  }),
);

userRouter.put(
  '/me/push-token',
  asyncHandler(async (req, res) => {
    const body = z.object({ pushToken: z.string().max(256).nullable() }).parse(req.body);
    if (body.pushToken && !isExpoPushToken(body.pushToken)) {
      throw badRequest('That does not look like an Expo push token');
    }
    await prisma.user.update({
      where: { id: currentUser(req).id },
      data: { pushToken: body.pushToken },
    });
    res.status(204).send();
  }),
);

userRouter.delete(
  '/me/schedule-data',
  asyncHandler(async (req, res) => {
    const userId = currentUser(req).id;
    await prisma.$transaction([
      prisma.reminder.deleteMany({ where: { userId } }),
      prisma.event.deleteMany({ where: { userId } }),
      prisma.recurrenceRule.deleteMany({ where: { userId } }),
      prisma.task.deleteMany({ where: { userId } }),
      prisma.goal.deleteMany({ where: { userId } }),
      prisma.conversation.deleteMany({ where: { userId } }),
    ]);
    res.status(204).send();
  }),
);
