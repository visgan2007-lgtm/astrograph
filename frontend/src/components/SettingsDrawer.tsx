import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, type ReactNode } from 'react';
import { ACCENTS, useSettings } from '../context/SettingsContext';

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">
        <strong>{label}</strong>
        {hint && <span className="muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className="switch" onClick={() => onChange(!on)}>
      <motion.span className="switch-knob" layout transition={{ type: 'spring', stiffness: 500, damping: 34 }} />
    </button>
  );
}

/** Slide-in panel that customises accent colour, background motion and transition speed. */
export default function SettingsDrawer() {
  const { settings, update, reset, drawerOpen, setDrawerOpen, dur, reducedMotion } = useSettings();
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = () => setDrawerOpen(false);

  useEffect(() => {
    if (!drawerOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [drawerOpen, setDrawerOpen]);

  const spring = reducedMotion ? { duration: 0 } : { type: 'spring' as const, stiffness: 340 * settings.speed, damping: 34 };

  return (
    <AnimatePresence>
      {drawerOpen && (
        <>
          <motion.div
            key="scrim"
            className="drawer-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: dur(0.2) }}
            onClick={close}
          />
          <motion.aside
            key="drawer"
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Customize Astrograph"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={spring}
          >
            <header className="drawer-head">
              <h2>Customize</h2>
              <button ref={closeRef} className="btn glass icon-only" onClick={close} aria-label="Close settings">
                ✕
              </button>
            </header>

            <Row label="Theme">
              <div className="seg" role="group" aria-label="Theme">
                {(['dark', 'light'] as const).map((t) => (
                  <button key={t} aria-pressed={settings.theme === t} onClick={() => update({ theme: t })}>
                    {t === 'dark' ? 'Dark' : 'Light'}
                  </button>
                ))}
              </div>
            </Row>

            <Row label="Accent colour" hint="Buttons and highlights">
              <div className="swatches">
                {ACCENTS.map((c) => (
                  <button
                    key={c}
                    className="swatch"
                    style={{ background: c }}
                    aria-label={`Accent ${c}`}
                    aria-pressed={settings.accent.toLowerCase() === c}
                    onClick={() => update({ accent: c })}
                  />
                ))}
                <label className="swatch custom" title="Custom colour">
                  <input type="color" value={settings.accent} onChange={(e) => update({ accent: e.target.value })} aria-label="Custom accent colour" />
                </label>
              </div>
            </Row>

            <Row label="Background animation" hint="Drifting streaks and flowing lines">
              <Switch on={settings.bgMotion} onChange={(v) => update({ bgMotion: v })} label="Background animation" />
            </Row>

            <Row label="Transition speed" hint={`${settings.speed.toFixed(1)}× (higher is faster)`}>
              <input
                type="range" min={0.5} max={2} step={0.1} value={settings.speed}
                aria-label="Transition speed" onChange={(e) => update({ speed: Number(e.target.value) })}
              />
            </Row>

            {reducedMotion && <p className="muted">Your system asks for reduced motion, so background and transition animations are kept to a minimum.</p>}
            <button className="btn glass wide" onClick={reset}>
              Reset to defaults
            </button>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
