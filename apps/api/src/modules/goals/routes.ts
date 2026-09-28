import { Router } from 'express';
import { z } from 'zod';
import { format, isValid, parseISO } from 'date-fns';
import { prisma } from '../../lib/prisma.js';
import { notFound } from '../../lib/errors.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { currentUser, requireAuth } from '../../middleware/requireAuth.js';

const fields = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(1000).nullable(),
  category: z.string().trim().min(1).max(40),
  priority: z.number().int().min(1).max(3),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) =>
    isValid(parseISO(value)) && format(parseISO(value), 'yyyy-MM-dd') === value, 'Invalid date').nullable(),
  weeklyMinutes: z.number().int().min(0).max(10080),
  progress: z.number().int().min(0).max(100),
  notes: z.string().max(2000).nullable(),
  status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED']),
});

export const goalRouter = Router();
goalRouter.use(requireAuth);

goalRouter.get('/', asyncHandler(async (req, res) => {
  res.json({ goals: await prisma.goal.findMany({
    where: { userId: currentUser(req).id },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  }) });
}));

goalRouter.post('/', asyncHandler(async (req, res) => {
  const body = fields.partial().required({ title: true }).parse(req.body);
  const goal = await prisma.goal.create({
    data: { ...body, userId: currentUser(req).id, targetDate: body.targetDate ? new Date(body.targetDate) : null },
  });
  res.status(201).json({ goal });
}));

goalRouter.patch('/:id', asyncHandler(async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const body = fields.partial().parse(req.body);
  const result = await prisma.goal.updateMany({
    where: { id, userId: currentUser(req).id },
    data: { ...body, targetDate: body.targetDate === undefined ? undefined : body.targetDate ? new Date(body.targetDate) : null },
  });
  if (!result.count) throw notFound('Goal not found');
  res.json({ goal: await prisma.goal.findUniqueOrThrow({ where: { id } }) });
}));

goalRouter.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const result = await prisma.goal.deleteMany({ where: { id, userId: currentUser(req).id } });
  if (!result.count) throw notFound('Goal not found');
  res.status(204).send();
}));
