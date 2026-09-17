import type { NextFunction, Request, Response } from 'express';
import type { User } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
  }
}

/** Every protected route resolves the caller from the bearer token only. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) throw unauthorized();

    const payload = verifyAccessToken(header.slice('Bearer '.length).trim());
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw unauthorized('Account no longer exists');

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export function currentUser(req: Request): User {
  if (!req.user) throw unauthorized();
  return req.user;
}
