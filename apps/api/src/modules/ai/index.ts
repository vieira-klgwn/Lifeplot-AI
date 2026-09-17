import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { LocalProvider } from './provider/local.js';
import { OpenAIProvider } from './provider/openai.js';
import type { AIProvider } from './provider/types.js';

let cached: AIProvider | null = null;

/** The provider is chosen once from configuration; call sites stay agnostic. */
export function getAIProvider(): AIProvider {
  if (cached) return cached;

  if (env.AI_PROVIDER === 'openai') {
    if (!env.OPENAI_API_KEY) {
      logger.warn('AI_PROVIDER=openai but OPENAI_API_KEY is unset; falling back to the local parser');
      cached = new LocalProvider();
    } else {
      cached = new OpenAIProvider(env.OPENAI_API_KEY);
    }
  } else {
    cached = new LocalProvider();
  }

  return cached;
}

export function setAIProvider(provider: AIProvider | null): void {
  cached = provider;
}
