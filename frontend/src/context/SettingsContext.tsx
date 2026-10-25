import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';

export interface Settings {
  theme: Theme;
  /** hex colour used for highlights and buttons */
  accent: string;
  /** wallpaper drift and flowing-line animation */
  bgMotion: boolean;
  /** transition speed multiplier: 2 = twice as fast */
  speed: number;
}

export const DEFAULT_SETTINGS: Settings = { theme: 'dark', accent: '#4aa3ff', bgMotion: true, speed: 1 };
export const ACCENTS = ['#4aa3ff', '#8b7bff', '#35d0ba', '#ff7ab6', '#ffb454', '#7bd35c'];
const KEY = 'astrograph.settings';

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return {
      theme: raw.theme === 'light' ? 'light' : 'dark',
      accent: typeof raw.accent === 'string' && /^#[0-9a-f]{6}$/i.test(raw.accent) ? raw.accent : DEFAULT_SETTINGS.accent,
      bgMotion: typeof raw.bgMotion === 'boolean' ? raw.bgMotion : DEFAULT_SETTINGS.bgMotion,
      speed: num(raw.speed, 0.5, 2, DEFAULT_SETTINGS.speed),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface Ctx {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
  /** user (OS) prefers reduced motion */
  reducedMotion: boolean;
  /** scale a duration in seconds by the speed setting */
  dur: (seconds: number) => number;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
}

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [reducedMotion, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.dataset.bgMotion = settings.bgMotion ? 'on' : 'off';
    root.style.setProperty('--accent', settings.accent);
    root.style.setProperty('--speed', String(settings.speed));
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable */
    }
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), []);
  const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), []);
  const dur = useCallback((seconds: number) => seconds / settings.speed, [settings.speed]);

  const value = useMemo<Ctx>(
    () => ({ settings, update, reset, reducedMotion, dur, drawerOpen, setDrawerOpen }),
    [settings, update, reset, reducedMotion, dur, drawerOpen],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>');
  return ctx;
}
