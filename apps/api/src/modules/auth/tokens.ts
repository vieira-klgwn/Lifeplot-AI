import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { User } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { unauthorized } from '../../lib/errors.js';

export interface AccessTokenPayload {
  sub: string;
  email: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function signAccessToken(user: Pick<User, 'id' | 'email'>): string {
  return jwt.sign({ email: user.email }, env.JWT_ACCESS_SECRET, {
    subject: user.id,
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
    issuer: 'lifepilot',
    audience: 'lifepilot-app',
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: 'lifepilot',
      audience: 'lifepilot-app',
    });
    if (typeof decoded === 'string' || !decoded.sub) throw new Error('Malformed token');
    return { sub: decoded.sub, email: String(decoded.email ?? '') };
  } catch {
    throw unauthorized('Session expired or invalid');
  }
}

/** Refresh tokens are opaque, stored hashed, single use and revocable. */
export async function issueRefreshToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
  return token;
}

export async function rotateRefreshToken(token: string): Promise<{ user: User; refreshToken: string }> {
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw unauthorized('Session expired, please sign in again');
  }

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });
  const refreshToken = await issueRefreshToken(stored.userId);
  return { user: stored.user, refreshToken };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function issueTokenPair(user: User): Promise<TokenPair> {
  return {
    accessToken: signAccessToken(user),
    refreshToken: await issueRefreshToken(user.id),
    expiresIn: env.ACCESS_TOKEN_TTL,
  };
}
