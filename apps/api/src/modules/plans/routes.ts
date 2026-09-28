import { Router } from 'express';
import { z } from 'zod';
import { format, isValid, parseISO } from 'date-fns';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { currentUser, requireAuth } from '../../middleware/requireAuth.js';
import { applyPlan, planningDate, previewPlan } from '../../services/planner.js';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) =>
  isValid(parseISO(value)) && format(parseISO(value), 'yyyy-MM-dd') === value, 'Invalid date');
export const planRouter = Router();
planRouter.use(requireAuth);

planRouter.post('/preview', asyncHandler(async (req, res) => {
  const body = z.object({ date: DATE.optional() }).parse(req.body);
  const user = currentUser(req);
  res.json({ plan: await previewPlan(user, body.date ?? planningDate(user)) });
}));

planRouter.post('/apply', asyncHandler(async (req, res) => {
  const body = z.object({ date: DATE, revision: z.string().length(64) }).parse(req.body);
  res.json(await applyPlan(currentUser(req).id, body.date, body.revision));
}));
