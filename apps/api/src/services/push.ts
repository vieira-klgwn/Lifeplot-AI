import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushResult {
  ok: boolean;
  error?: string;
}

/** Expo push tokens are the only accepted format; anything else is dropped. */
export function isExpoPushToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token) || /^[a-zA-Z0-9_-]{22,}$/.test(token);
}

export async function sendPush(messages: PushMessage[]): Promise<PushResult[]> {
  if (messages.length === 0) return [];

  try {
    const response = await fetch(env.EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      const error = `Expo push failed with status ${response.status}`;
      logger.warn({ status: response.status }, 'Expo push rejected the batch');
      return messages.map(() => ({ ok: false, error }));
    }

    const payload = (await response.json()) as { data?: Array<{ status: string; message?: string }> };
    return messages.map((_, index) => {
      const ticket = payload.data?.[index];
      if (!ticket || ticket.status === 'ok') return { ok: true };
      return { ok: false, error: ticket.message ?? 'Unknown push error' };
    });
  } catch (error) {
    logger.warn({ err: error }, 'Expo push request threw');
    return messages.map(() => ({ ok: false, error: 'Push transport error' }));
  }
}
