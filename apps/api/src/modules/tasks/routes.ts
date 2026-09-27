import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { currentUser, requireAuth } from '../../middleware/requireAuth.js';
import { zonedToUtc } from '../../lib/time.js';
import { createTask, deleteTask, getTask, listTasks, updateTask } from '../../services/schedule.js';
import { track } from '../../services/analytics.js';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const TIME = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/);

export const taskRouter = Router();
taskRouter.use(requireAuth);

taskRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = z.object({ includeDone: z.coerce.boolean().default(false) }).parse(req.query);
    res.json({ tasks: await listTasks(currentUser(req).id, query.includeDone) });
  }),
);

taskRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        title: z.string().min(1).max(120),
        description: z.string().max(500).nullable().optional(),
        deadlineDate: DATE.nullable().optional(),
        deadlineTime: TIME.optional(),
        estimatedMinutes: z.number().int().min(5).max(24 * 60).nullable().optional(),
        goalId: z.string().uuid().nullable().optional(),
        priority: z.number().int().min(1).max(3).optional(),
        reminderMinutes: z.number().int().min(0).max(60 * 24 * 14).nullable().optional(),
      })
      .parse(req.body);

    const user = currentUser(req);
    const deadline = body.deadlineDate
      ? zonedToUtc(body.deadlineDate, body.deadlineTime ?? '23:59', user.timezone)
      : null;

    const task = await createTask(user, {
      title: body.title,
      description: body.description ?? null,
      deadline,
      estimatedMinutes: body.estimatedMinutes ?? null,
      goalId: body.goalId ?? null,
      priority: body.priority,
      reminderMinutes: body.reminderMinutes ?? (deadline ? user.defaultReminderMinutes : null),
    });

    await track('task_created', user.id, { hasDeadline: deadline !== null });
    res.status(201).json({ task });
  }),
);

taskRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    res.json({ task: await getTask(currentUser(req).id, id) });
  }),
);

taskRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        title: z.string().min(1).max(120).optional(),
        description: z.string().max(500).nullable().optional(),
        deadlineDate: DATE.nullable().optional(),
        deadlineTime: TIME.optional(),
        estimatedMinutes: z.number().int().min(5).max(24 * 60).nullable().optional(),
        goalId: z.string().uuid().nullable().optional(),
        priority: z.number().int().min(1).max(3).optional(),
        status: z.enum(['PENDING', 'SCHEDULED', 'DONE', 'CANCELLED']).optional(),
        reminderMinutes: z.number().int().min(0).max(60 * 24 * 14).nullable().optional(),
      })
      .parse(req.body);

    const user = currentUser(req);
    const deadline =
      body.deadlineDate === undefined
        ? undefined
        : body.deadlineDate === null
          ? null
          : zonedToUtc(body.deadlineDate, body.deadlineTime ?? '23:59', user.timezone);

    const task = await updateTask(user, id, {
      title: body.title,
      description: body.description,
      deadline,
      estimatedMinutes: body.estimatedMinutes,
      goalId: body.goalId,
      priority: body.priority,
      status: body.status,
      reminderMinutes: body.reminderMinutes,
    });
    res.json({ task });
  }),
);

taskRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await deleteTask(currentUser(req).id, id);
    res.status(204).send();
  }),
);
