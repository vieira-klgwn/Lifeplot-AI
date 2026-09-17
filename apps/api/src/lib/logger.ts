import pino from 'pino';
import { env } from '../config/env.js';

/// Redaction keeps credentials and schedule contents out of logs.
export const logger = pino({
  level: env.isTest ? 'silent' : env.isProduction ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.refreshToken',
      'req.body.idToken',
      'req.body.message',
      'password',
      'passwordHash',
      'token',
      'accessToken',
      'refreshToken',
      'pushToken',
    ],
    censor: '[redacted]',
  },
});
