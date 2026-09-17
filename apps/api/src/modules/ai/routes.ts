import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { currentUser, requireAuth } from '../../middleware/requireAuth.js';
import { chat, latestConversation, listMessages, undo } from './assistant.js';
import { getAIProvider } from './index.js';

/// Model calls cost money and are the most abusable endpoint, so they get a
/// tighter per-user budget than the rest of the API.
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: env.isTest ? 1000 : 20,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anonymous',
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: { code: 'TOO_MANY_REQUESTS', message: 'Slow down a moment and try again.' },
  },
});

export const aiRouter = Router();
aiRouter.use(requireAuth);

aiRouter.get('/provider', (_req, res) => {
  res.json({ provider: getAIProvider().name });
});

aiRouter.post(
  '/chat',
  aiLimiter,
  asyncHandler(async (req, res) => {
    const body = z
      .object({ message: z.string().min(1).max(1000), conversationId: z.string().uuid().optional() })
      .parse(req.body);
    res.json(await chat(currentUser(req), body));
  }),
);

aiRouter.post(
  '/undo',
  asyncHandler(async (req, res) => {
    const body = z.object({ messageId: z.string().uuid() }).parse(req.body);
    res.json(await undo(currentUser(req), body.messageId));
  }),
);

aiRouter.get(
  '/conversation',
  asyncHandler(async (req, res) => {
    res.json({ conversation: await latestConversation(currentUser(req).id) });
  }),
);

aiRouter.get(
  '/conversation/:id/messages',
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    res.json({ messages: await listMessages(currentUser(req).id, id) });
  }),
);
