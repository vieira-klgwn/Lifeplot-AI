import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { secureStorage } from './storage';

const ACCESS_KEY = 'uniflow.accessToken';
const REFRESH_KEY = 'uniflow.refreshToken';

function defaultApiUrl(): string {
  const configured = Constants.expoConfig?.extra?.apiUrl;
  if (typeof configured === 'string' && configured.length > 0) return configured;
  return 'http://localhost:4000';
}

/**
 * A device on the LAN cannot reach the packager host through "localhost", so the
 * Metro host is reused whenever the configured URL still points at the loopback.
 */
export function resolveApiUrl(): string {
  const configured = defaultApiUrl();
  if (Platform.OS === 'web' || !/localhost|127\.0\.0\.1/.test(configured)) return configured;
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost;
  const host = hostUri?.split(':')[0];
  if (!host) return configured;
  return configured.replace(/localhost|127\.0\.0\.1/, host);
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export class OfflineError extends Error {
  constructor() {
    super('You are offline. Showing your saved schedule.');
    this.name = 'OfflineError';
  }
}

export const tokens = {
  async read(): Promise<{ accessToken: string | null; refreshToken: string | null }> {
    const [accessToken, refreshToken] = await Promise.all([
      secureStorage.get(ACCESS_KEY),
      secureStorage.get(REFRESH_KEY),
    ]);
    return { accessToken, refreshToken };
  },
  async save(accessToken: string, refreshToken: string): Promise<void> {
    await Promise.all([
      secureStorage.set(ACCESS_KEY, accessToken),
      secureStorage.set(REFRESH_KEY, refreshToken),
    ]);
  },
  async clear(): Promise<void> {
    await Promise.all([secureStorage.remove(ACCESS_KEY), secureStorage.remove(REFRESH_KEY)]);
  },
};

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  auth?: boolean;
}

let refreshing: Promise<string | null> | null = null;
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = (async () => {
      const { refreshToken } = await tokens.read();
      if (!refreshToken) return null;
      const response = await fetch(`${resolveApiUrl()}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        await tokens.clear();
        return null;
      }
      const payload = (await response.json()) as { accessToken: string; refreshToken: string };
      await tokens.save(payload.accessToken, payload.refreshToken);
      return payload.accessToken;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, auth = true } = options;
  const url = new URL(`${resolveApiUrl()}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const send = async (accessToken: string | null): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
    try {
      return await fetch(url.toString(), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new OfflineError();
    }
  };

  const { accessToken } = auth ? await tokens.read() : { accessToken: null };
  let response = await send(accessToken);

  if (response.status === 401 && auth) {
    const next = await refreshAccessToken();
    if (next) {
      response = await send(next);
    } else {
      onUnauthorized?.();
    }
  }

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      payload && typeof payload === 'object' && 'error' in payload
        ? (payload as { error: { code?: string; message?: string } }).error
        : null;
    throw new ApiError(
      response.status,
      error?.code ?? 'REQUEST_FAILED',
      error?.message ?? 'Something went wrong. Please try again.',
    );
  }
  return payload as T;
}
