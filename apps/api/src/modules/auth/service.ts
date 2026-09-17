import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { User } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { badRequest, conflict, unauthorized } from '../../lib/errors.js';
import { isValidTimezone } from '../../lib/time.js';
import { issueTokenPair, revokeAllSessions, type TokenPair } from './tokens.js';
import { verifySocialIdToken } from './social.js';

const BCRYPT_ROUNDS = 12;
/** Uniform work factor so timing does not reveal whether an account exists. */
const DUMMY_HASH = bcrypt.hashSync('uniflow-dummy-password', BCRYPT_ROUNDS);

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  university: string | null;
  timezone: string;
  weekStartsOn: number;
  defaultReminderMinutes: number;
  categoryReminderMinutes: Record<string, number>;
  notificationsEnabled: boolean;
  analyticsEnabled: boolean;
  onboardedAt: string | null;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    university: user.university,
    timezone: user.timezone,
    weekStartsOn: user.weekStartsOn,
    defaultReminderMinutes: user.defaultReminderMinutes,
    categoryReminderMinutes: (user.categoryReminderMinutes ?? {}) as Record<string, number>,
    notificationsEnabled: user.notificationsEnabled,
    analyticsEnabled: user.analyticsEnabled,
    onboardedAt: user.onboardedAt?.toISOString() ?? null,
  };
}

export interface AuthResult extends TokenPair {
  user: PublicUser;
}

export async function register(input: {
  email: string;
  password: string;
  name: string;
  timezone?: string;
  university?: string;
}): Promise<AuthResult> {
  const email = input.email.toLowerCase().trim();
  const timezone = input.timezone && isValidTimezone(input.timezone) ? input.timezone : 'UTC';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw conflict('An account with that email already exists');

  const user = await prisma.user.create({
    data: {
      email,
      name: input.name.trim(),
      university: input.university?.trim() || null,
      timezone,
      passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
      authProvider: 'PASSWORD',
    },
  });

  const tokens = await issueTokenPair(user);
  return { ...tokens, user: toPublicUser(user) };
}

export async function login(input: { email: string; password: string }): Promise<AuthResult> {
  const email = input.email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email } });

  const hash = user?.passwordHash ?? DUMMY_HASH;
  const matches = await bcrypt.compare(input.password, hash);
  if (!user || !user.passwordHash || !matches) {
    throw unauthorized('Incorrect email or password');
  }

  const tokens = await issueTokenPair(user);
  return { ...tokens, user: toPublicUser(user) };
}

export async function socialLogin(input: {
  provider: 'GOOGLE' | 'APPLE';
  idToken: string;
  timezone?: string;
}): Promise<AuthResult> {
  const identity = await verifySocialIdToken(input.provider, input.idToken);

  const user = await prisma.user.upsert({
    where: { authProvider_providerSubject: { authProvider: identity.provider, providerSubject: identity.subject } },
    update: { email: identity.email },
    create: {
      email: identity.email,
      name: identity.name ?? identity.email.split('@')[0] ?? 'Student',
      authProvider: identity.provider,
      providerSubject: identity.subject,
      timezone: input.timezone && isValidTimezone(input.timezone) ? input.timezone : 'UTC',
    },
  });

  const tokens = await issueTokenPair(user);
  return { ...tokens, user: toPublicUser(user) };
}

/**
 * Password reset always reports success so the endpoint cannot be used to
 * enumerate accounts. The token is returned only outside production, where no
 * mail transport is wired up.
 */
export async function requestPasswordReset(email: string): Promise<{ resetToken?: string }> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || !user.passwordHash) return {};

  const raw = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });
  return { resetToken: raw };
}

export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const stored = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
    throw badRequest('This reset link is invalid or has expired');
  }

  await prisma.user.update({
    where: { id: stored.userId },
    data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) },
  });
  await prisma.passwordResetToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } });
  // Resetting a password invalidates every existing session.
  await revokeAllSessions(stored.userId);
}

export async function deleteAccount(userId: string): Promise<void> {
  await prisma.user.delete({ where: { id: userId } });
}
