import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { User } from '@prisma/client';
import { env } from '../../config/env.js';
import { getAIProvider } from './index.js';
import { OpenAIProvider } from './provider/openai.js';

const encryptionKey = createHash('sha256').update(env.JWT_REFRESH_SECRET).digest();

export function encryptKey(key: string, userId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  cipher.setAAD(Buffer.from(userId));
  const ciphertext = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

function decryptKey(encrypted: string, userId: string): string {
  const [iv, tag, ciphertext] = encrypted.split('.').map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !ciphertext) throw new Error('Invalid encrypted AI key');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv);
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function providerForUser(user: User) {
  return user.aiKeyCiphertext
    ? new OpenAIProvider(decryptKey(user.aiKeyCiphertext, user.id))
    : getAIProvider();
}
