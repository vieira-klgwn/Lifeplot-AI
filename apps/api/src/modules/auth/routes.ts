import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { requireAuth, currentUser } from '../../middleware/requireAuth.js';
import { env } from '../../config/env.js';
import {
  deleteAccount,
  login,
  register,
  requestPasswordReset,
  resetPassword,
  socialLogin,
  toPublicUser,
} from './service.js';
import { issueTokenPair, revokeAllSessions, revokeRefreshToken, rotateRefreshToken, signAccessToken } from './tokens.js';

const password = z.string().min(10, 'Use at least 10 characters').max(128);

const credentialsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 1000 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts, try again later' } },
});

export const authRouter = Router();

authRouter.post(
  '/register',
  credentialsLimiter,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        email: z.string().email(),
        password,
        name: z.string().min(1).max(80),
        timezone: z.string().max(64).optional(),
        university: z.string().max(120).optional(),
      })
      .parse(req.body);
    res.status(201).json(await register(body));
  }),
);

authRouter.post(
  '/login',
  credentialsLimiter,
  asyncHandler(async (req, res) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    res.json(await login(body));
  }),
);

authRouter.post(
  '/social',
  credentialsLimiter,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        provider: z.enum(['GOOGLE', 'APPLE']),
        idToken: z.string().min(20),
        timezone: z.string().max(64).optional(),
      })
      .parse(req.body);
    res.json(await socialLogin(body));
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const body = z.object({ refreshToken: z.string().min(20) }).parse(req.body);
    const { user, refreshToken } = await rotateRefreshToken(body.refreshToken);
    res.json({
      accessToken: signAccessToken(user),
      refreshToken,
      expiresIn: env.ACCESS_TOKEN_TTL,
      user: toPublicUser(user),
    });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const body = z.object({ refreshToken: z.string().min(20) }).parse(req.body);
    await revokeRefreshToken(body.refreshToken);
    res.status(204).send();
  }),
);

authRouter.post(
  '/password-reset/request',
  credentialsLimiter,
  asyncHandler(async (req, res) => {
    const body = z.object({ email: z.string().email() }).parse(req.body);
    const { resetToken } = await requestPasswordReset(body.email);
    // The reset token is only echoed outside production, where no mailer exists.
    res.json(env.isProduction ? { ok: true } : { ok: true, resetToken });
  }),
);

authRouter.post(
  '/password-reset/confirm',
  credentialsLimiter,
  asyncHandler(async (req, res) => {
    const body = z.object({ token: z.string().min(20), password }).parse(req.body);
    await resetPassword(body.token, body.password);
    res.status(204).send();
  }),
);

authRouter.post(
  '/sessions/revoke-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeAllSessions(currentUser(req).id);
    res.status(204).send();
  }),
);

authRouter.post(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await issueTokenPair(currentUser(req)));
  }),
);

authRouter.delete(
  '/account',
  requireAuth,
  asyncHandler(async (req, res) => {
    await deleteAccount(currentUser(req).id);
    res.status(204).send();
  }),
);
