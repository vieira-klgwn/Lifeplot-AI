import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiRequest, setUnauthorizedHandler, tokens } from '../lib/api';
import { cache } from '../lib/storage';
import type { Profile } from '../types';

interface AuthPayload {
  accessToken: string;
  refreshToken: string;
  user: Profile;
}

interface AuthValue {
  user: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: {
    email: string;
    password: string;
    name: string;
    university?: string;
  }) => Promise<void>;
  signInWithProvider: (provider: 'GOOGLE' | 'APPLE', idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (patch: Record<string, unknown>) => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const applySession = useCallback(async (payload: AuthPayload) => {
    await tokens.save(payload.accessToken, payload.refreshToken);
    setUser(payload.user);
    await cache.write('profile', payload.user);
  }, []);

  const signOut = useCallback(async () => {
    const { refreshToken } = await tokens.read();
    if (refreshToken) {
      await apiRequest('/auth/logout', {
        method: 'POST',
        body: { refreshToken },
        auth: false,
      }).catch(() => undefined);
    }
    await tokens.clear();
    await cache.clear();
    setUser(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    const { accessToken, refreshToken } = await tokens.read();
    if (!accessToken && !refreshToken) {
      setUser(null);
      return;
    }
    try {
      const { user: profile } = await apiRequest<{ user: Profile }>('/users/me');
      setUser(profile);
      await cache.write('profile', profile);
    } catch {
      const cached = await cache.read<Profile>('profile');
      if (cached) setUser(cached);
    }
  }, []);

  useEffect(() => {
    let active = true;
    setUnauthorizedHandler(() => {
      void tokens.clear();
      setUser(null);
    });
    Promise.resolve()
      .then(() => refreshProfile())
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      setUnauthorizedHandler(null);
    };
  }, [refreshProfile]);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      loading,
      signIn: async (email, password) => {
        const payload = await apiRequest<AuthPayload>('/auth/login', {
          method: 'POST',
          body: { email, password },
          auth: false,
        });
        await applySession(payload);
      },
      signUp: async (input) => {
        const payload = await apiRequest<AuthPayload>('/auth/register', {
          method: 'POST',
          body: { ...input, timezone: deviceTimezone() },
          auth: false,
        });
        await applySession(payload);
      },
      signInWithProvider: async (provider, idToken) => {
        const payload = await apiRequest<AuthPayload>('/auth/social', {
          method: 'POST',
          body: { provider, idToken, timezone: deviceTimezone() },
          auth: false,
        });
        await applySession(payload);
      },
      signOut,
      refreshProfile,
      updateProfile: async (patch) => {
        const { user: updated } = await apiRequest<{ user: Profile }>('/users/me', {
          method: 'PATCH',
          body: patch,
        });
        setUser(updated);
        await cache.write('profile', updated);
      },
    }),
    [applySession, loading, refreshProfile, signOut, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
