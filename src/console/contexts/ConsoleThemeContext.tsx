import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type ConsoleThemePreference = 'light' | 'dark' | 'system';
export type ConsoleResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'almc-theme';

type ConsoleThemeContextValue = {
  preference: ConsoleThemePreference;
  resolved: ConsoleResolvedTheme;
  setPreference: (preference: ConsoleThemePreference) => void;
  cyclePreference: () => void;
};

const ConsoleThemeContext = createContext<ConsoleThemeContextValue | null>(null);

function readStoredPreference(): ConsoleThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // ignore
  }
  return 'system';
}

function getSystemTheme(): ConsoleResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveConsoleTheme(preference: ConsoleThemePreference): ConsoleResolvedTheme {
  return preference === 'system' ? getSystemTheme() : preference;
}

export function applyConsoleTheme(resolved: ConsoleResolvedTheme) {
  const root = document.documentElement;
  const body = document.body;
  root.classList.add('almc-app');
  body.classList.add('almc-app');
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
  root.style.backgroundColor = resolved === 'dark' ? '#0a0a0b' : '#f4f5f3';
  body.style.backgroundColor = resolved === 'dark' ? '#0a0a0b' : '#f4f5f3';
}

export function ConsoleThemeProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [preference, setPreferenceState] = useState<ConsoleThemePreference>(() => readStoredPreference());
  const [resolved, setResolved] = useState<ConsoleResolvedTheme>(() =>
    resolveConsoleTheme(readStoredPreference())
  );

  const setPreference = useCallback((next: ConsoleThemePreference) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const cyclePreference = useCallback(() => {
    setPreference(
      preference === 'system' ? 'light' : preference === 'light' ? 'dark' : 'system'
    );
  }, [preference, setPreference]);

  useEffect(() => {
    const next = resolveConsoleTheme(preference);
    setResolved(next);
    applyConsoleTheme(next);

    if (preference !== 'system') return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const systemResolved = resolveConsoleTheme('system');
      setResolved(systemResolved);
      applyConsoleTheme(systemResolved);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference]);

  const value = useMemo(
    () => ({ preference, resolved, setPreference, cyclePreference }),
    [preference, resolved, setPreference, cyclePreference]
  );

  return <ConsoleThemeContext.Provider value={value}>{children}</ConsoleThemeContext.Provider>;
}

export function useConsoleTheme(): ConsoleThemeContextValue {
  const ctx = useContext(ConsoleThemeContext);
  if (!ctx) {
    throw new Error('useConsoleTheme must be used within ConsoleThemeProvider');
  }
  return ctx;
}
