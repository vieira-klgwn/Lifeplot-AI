import { Router } from 'express';
import { z } from 'zod';
import { addDays, format, parseISO } from 'date-fns';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { currentUser, requireAuth } from '../../middleware/requireAuth.js';
import { formatInZone, zonedToUtc } from '../../lib/time.js';
import {
  createEvent,
  createRecurringClass,
  deleteEvent,
  findConflicts,
  findFreeTime,
  getEvent,
  listEvents,
  searchEvents,
  updateEvent,
} from '../../services/schedule.js';
import { track } from '../../services/analytics.js';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const TIME = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/);
const CATEGORY = z.enum(['CLASS', 'EXAM', 'ASSIGNMENT', 'MEETING', 'STUDY', 'PERSONAL', 'OTHER']);
const SCOPE = z.enum(['this', 'future', 'all']).default('this');

export const eventRouter = Router();
eventRouter.use(requireAuth);

eventRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = z
      .object({ from: DATE, to: DATE, search: z.string().max(120).optional() })
      .parse(req.query);
    const user = currentUser(req);

    if (query.search) {
      res.json({ events: await searchEvents(user.id, query.search) });
      return;
    }

    const events = await listEvents(user.id, {
      from: zonedToUtc(query.from, '00:00', user.timezone),
      to: zonedToUtc(format(addDays(parseISO(query.to), 1), 'yyyy-MM-dd'), '00:00', user.timezone),
    });
    res.json({ events });
  }),
);

eventRouter.get(
  '/free-time',
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        from: DATE,
        to: DATE,
        durationMinutes: z.coerce.number().int().min(15).max(12 * 60),
        earliest: TIME.optional(),
        latest: TIME.optional(),
      })
      .parse(req.query);

    const user = currentUser(req);
    const days: string[] = [];
    let cursor = parseISO(query.from);
    const last = parseISO(query.to);
    for (let guard = 0; guard < 60 && cursor <= last; guard += 1) {
      days.push(format(cursor, 'yyyy-MM-dd'));
      cursor = addDays(cursor, 1);
    }

    const slots = await findFreeTime(user, {
      days,
      durationMinutes: query.durationMinutes,
      dayStart: query.earliest,
      dayEnd: query.latest,
      limit: 8,
    });
    res.json({ slots });
  }),
);

eventRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    res.json({ event: await getEvent(currentUser(req).id, id) });
  }),
);

eventRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        title: z.string().min(1).max(120),
        date: DATE,
        startTime: TIME,
        durationMinutes: z.number().int().min(5).max(24 * 60).default(60),
        description: z.string().max(500).nullable().optional(),
        location: z.string().max(120).nullable().optional(),
        category: CATEGORY.optional(),
        reminderMinutes: z.number().int().min(0).max(60 * 24 * 14).nullable().optional(),
      })
      .parse(req.body);

    const user = currentUser(req);
    const startTime = zonedToUtc(body.date, body.startTime, user.timezone);
    const result = await createEvent(user, {
      title: body.title,
      description: body.description ?? null,
      location: body.location ?? null,
      category: body.category,
      startTime,
      endTime: new Date(startTime.getTime() + body.durationMinutes * 60_000),
      reminderMinutes: body.reminderMinutes,
    });

    await track('event_created', user.id, { category: result.event.category, source: 'manual' });
    res.status(201).json(result);
  }),
);

eventRouter.post(
  '/recurring',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        title: z.string().min(1).max(120),
        courseCode: z.string().max(40).nullable().optional(),
        professor: z.string().max(80).nullable().optional(),
        location: z.string().max(120).nullable().optional(),
        byWeekday: z.array(z.number().int().min(0).max(6)).min(1).max(7),
        startTime: TIME,
        endTime: TIME,
        startDate: DATE,
        endDate: DATE,
        category: CATEGORY.optional(),
        reminderMinutes: z.number().int().min(0).max(60 * 24 * 14).nullable().optional(),
      })
      .parse(req.body);

    const user = currentUser(req);
    const result = await createRecurringClass(user, body);
    await track('schedule_created', user.id, { occurrences: result.events.length });
    res.status(201).json({ rule: result.rule, occurrences: result.events.length });
  }),
);

eventRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        title: z.string().min(1).max(120).optional(),
        description: z.string().max(500).nullable().optional(),
        location: z.string().max(120).nullable().optional(),
        category: CATEGORY.optional(),
        date: DATE.optional(),
        startTime: TIME.optional(),
        durationMinutes: z.number().int().min(5).max(24 * 60).optional(),
        reminderMinutes: z.number().int().min(0).max(60 * 24 * 14).nullable().optional(),
        scope: SCOPE,
      })
      .parse(req.body);

    const user = currentUser(req);
    const existing = await getEvent(user.id, id);

    let startTime = existing.startTime;
    let endTime = existing.endTime;
    if (body.date || body.startTime || body.durationMinutes) {
      const date = body.date ?? formatInZone(existing.startTime, user.timezone, 'yyyy-MM-dd');
      const time = body.startTime ?? formatInZone(existing.startTime, user.timezone, 'HH:mm');
      const duration =
        body.durationMinutes ??
        Math.round((existing.endTime.getTime() - existing.startTime.getTime()) / 60_000);
      startTime = zonedToUtc(date, time, user.timezone);
      endTime = new Date(startTime.getTime() + duration * 60_000);
    }

    const result = await updateEvent(
      user,
      id,
      {
        title: body.title,
        description: body.description,
        location: body.location,
        category: body.category,
        startTime,
        endTime,
        reminderMinutes: body.reminderMinutes,
      },
      body.scope,
    );

    await track('event_modified', user.id, { scope: body.scope });
    res.json(result);
  }),
);

eventRouter.get(
  '/:id/conflicts',
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const user = currentUser(req);
    const event = await getEvent(user.id, id);
    res.json({ conflicts: await findConflicts(user.id, event.startTime, event.endTime, event.id) });
  }),
);

eventRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { scope } = z.object({ scope: SCOPE }).parse(req.query);
    const user = currentUser(req);
    const result = await deleteEvent(user, id, scope);
    await track('event_deleted', user.id, { scope, deleted: result.deleted });
    res.json(result);
  }),
);
