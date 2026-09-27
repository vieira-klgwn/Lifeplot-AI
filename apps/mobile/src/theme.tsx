import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Palette {
  background: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryText: string;
  border: string;
  danger: string;
  success: string;
  warning: string;
}

const light: Palette = {
  background: '#F6F7FB',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF1F8',
  text: '#131722',
  textMuted: '#5B6376',
  primary: '#3B5BDB',
  primaryText: '#FFFFFF',
  border: '#DDE2EE',
  danger: '#C92A2A',
  success: '#2B8A3E',
  warning: '#E67700',
};

const dark: Palette = {
  background: '#0B1020',
  surface: '#161C2E',
  surfaceAlt: '#1F2740',
  text: '#F2F4FA',
  textMuted: '#A3ACC2',
  primary: '#7C9BFF',
  primaryText: '#0B1020',
  border: '#2A3350',
  danger: '#FF8787',
  success: '#69DB7C',
  warning: '#FFC078',
};

export type ThemePreference = 'system' | 'light' | 'dark';

interface ThemeValue {
  colors: Palette;
  scheme: 'light' | 'dark';
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);
const STORAGE_KEY = 'lifepilot.theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') setPreferenceState(stored);
    });
  }, []);

  const value = useMemo<ThemeValue>(() => {
    const scheme = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
    return {
      scheme,
      colors: scheme === 'dark' ? dark : light,
      preference,
      setPreference: (next) => {
        setPreferenceState(next);
        void AsyncStorage.setItem(STORAGE_KEY, next);
      },
    };
  }, [preference, system]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
