import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';

export interface Settings {
  theme: Theme;
  /** hex colour used for highlights and buttons */
  accent: string;
  /** wallpaper drift and flowing-line animation */
  bgMotion: boolean;
  /** transition speed multiplier: 2 = twice as fast */
  speed: number;
  /** performance mode: no blur, no background animation, solid panels */
  lite: boolean;
}

export const DEFAULT_SETTINGS: Settings = { theme: 'dark', accent: '#4aa3ff', bgMotion: true, speed: 1, lite: false };
export const ACCENTS = ['#4aa3ff', '#8b7bff', '#35d0ba', '#ff7ab6', '#ffb454', '#7bd35c'];
const KEY = 'astrograph.settings';
const PERF_KEY = 'astrograph.perfchecked';

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
      lite: typeof raw.lite === 'boolean' ? raw.lite : DEFAULT_SETTINGS.lite,
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
  /** performance mode was switched on automatically because the page measured as slow */
  autoLite: boolean;
  /** scale a duration in seconds by the speed setting */
  dur: (seconds: number) => number;
}

const SettingsContext = createContext<Ctx | null>(null);

/**
 * One-time check after startup: if the animated background runs below ~30 fps, switch to performance mode.
 * Runs once per session and never overrides the user afterwards.
 */
function usePerfGuard(active: boolean, onSlow: () => void) {
  useEffect(() => {
    if (!active) return;
    try {
      if (sessionStorage.getItem(PERF_KEY)) return;
    } catch {
      /* private mode: check anyway */
    }
    let raf = 0;
    let stop = 0;
    let last = 0;
    let aborted = false;
    const deltas: number[] = [];
    const sample = (t: number) => {
      if (document.hidden) {
        aborted = true;
        return;
      }
      if (last) deltas.push(t - last);
      last = t;
      raf = requestAnimationFrame(sample);
    };
    const start = window.setTimeout(() => {
      raf = requestAnimationFrame(sample);
      stop = window.setTimeout(() => {
        cancelAnimationFrame(raf);
        if (aborted || deltas.length < 30) return;
        try {
          sessionStorage.setItem(PERF_KEY, '1');
        } catch {
          /* ignore */
        }
        const sorted = [...deltas].sort((a, b) => a - b);
        if (sorted[sorted.length >> 1] > 34) onSlow();
      }, 2500);
    }, 6000); // after the intro and first paint have settled
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(stop);
      cancelAnimationFrame(raf);
    };
  }, [active, onSlow]);
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);
  const [autoLite, setAutoLite] = useState(false);
  const [reducedMotion, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const latest = useRef(settings);
  latest.current = settings;

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // DOM attributes apply immediately (sliders feel instant)...
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.dataset.bgMotion = settings.bgMotion ? 'on' : 'off';
    root.dataset.lite = settings.lite ? 'on' : 'off';
    root.style.setProperty('--accent', settings.accent);
    root.style.setProperty('--speed', String(settings.speed));
  }, [settings]);

  // ...but storage writes are debounced, so dragging a slider does not hit localStorage 60 times a second.
  useEffect(() => {
    const write = () => {
      try {
        localStorage.setItem(KEY, JSON.stringify(latest.current));
      } catch {
        /* storage unavailable */
      }
    };
    const t = window.setTimeout(write, 250);
    window.addEventListener('pagehide', write);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('pagehide', write);
    };
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => {
    if ('lite' in patch) setAutoLite(false);
    setSettings((s) => ({ ...s, ...patch }));
  }, []);
  const reset = useCallback(() => {
    setAutoLite(false);
    setSettings(DEFAULT_SETTINGS);
  }, []);
  const onSlow = useCallback(() => {
    setAutoLite(true);
    setSettings((s) => ({ ...s, lite: true }));
  }, []);
  usePerfGuard(!settings.lite && settings.bgMotion && !reducedMotion, onSlow);

  const dur = useCallback((seconds: number) => seconds / settings.speed, [settings.speed]);
  const value = useMemo<Ctx>(
    () => ({ settings, update, reset, reducedMotion, autoLite, dur }),
    [settings, update, reset, reducedMotion, autoLite, dur],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>');
  return ctx;
}
