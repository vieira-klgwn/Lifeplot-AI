import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { currentUser, requireAuth } from '../../middleware/requireAuth.js';
import { getEvent } from '../../services/schedule.js';
import { listReminders, removeReminder, syncRemindersForEvent, REMINDER_PRESETS } from '../../services/reminders.js';
import { track } from '../../services/analytics.js';

export const reminderRouter = Router();
reminderRouter.use(requireAuth);

reminderRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = z.object({ upcomingOnly: z.coerce.boolean().default(true) }).parse(req.query);
    res.json({
      presets: REMINDER_PRESETS,
      reminders: await listReminders(currentUser(req).id, query.upcomingOnly),
    });
  }),
);

reminderRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        eventId: z.string().uuid(),
        minutesBefore: z.number().int().min(0).max(60 * 24 * 14),
      })
      .parse(req.body);

    const user = currentUser(req);
    const event = await getEvent(user.id, body.eventId);
    const reminders = await syncRemindersForEvent(user, event, body.minutesBefore);
    await track('reminder_created', user.id, { minutesBefore: body.minutesBefore });
    res.status(201).json({ reminders });
  }),
);

reminderRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await removeReminder(currentUser(req).id, id);
    res.status(204).send();
  }),
);
