import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authRouter } from './modules/auth/routes.js';
import { userRouter } from './modules/users/routes.js';
import { eventRouter } from './modules/events/routes.js';
import { taskRouter } from './modules/tasks/routes.js';
import { reminderRouter } from './modules/reminders/routes.js';
import { aiRouter } from './modules/ai/routes.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      // Native clients send no Origin; browsers must be on the allow-list.
      origin: (origin, callback) =>
        !origin || env.corsOrigins.length === 0 || env.corsOrigins.includes(origin)
          ? callback(null, true)
          : callback(new Error('Origin not allowed')),
      credentials: false,
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  if (!env.isTest) {
    app.use(pinoHttp({ logger }));
  }
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: env.isTest ? 10_000 : 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: process.env.npm_package_version ?? '0.1.0' });
  });

  app.use('/auth', authRouter);
  app.use('/users', userRouter);
  app.use('/events', eventRouter);
  app.use('/tasks', taskRouter);
  app.use('/reminders', reminderRouter);
  app.use('/ai', aiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
