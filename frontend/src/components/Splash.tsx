import { useEffect, useRef, useState } from 'react';
import { playShootingA } from '../lib/shootingA';

const TRAVEL_MS = 2600;
const SETTLE_MS = 800;
const HOLD_MS = 500;
const FADE_MS = 450;

/** Opening animation: shooting stars converge into the Astrograph "A" at the centre of the screen. */
export default function Splash({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [out, setOut] = useState(false);

  useEffect(() => {
    let stop = () => {};
    let t1 = 0;
    let t2 = 0;
    let alive = true;
    const star = getComputedStyle(document.documentElement).getPropertyValue('--star').trim() || '#9fd0ff';
    playShootingA(ref.current!, {
      travelMs: TRAVEL_MS,
      settleMs: SETTLE_MS,
      star,
      onSettled: () => {
        t1 = window.setTimeout(() => setOut(true), HOLD_MS);
        t2 = window.setTimeout(onDone, HOLD_MS + FADE_MS);
      },
    }).then((cleanup) => {
      if (alive) stop = cleanup;
      else cleanup();
    });
    const skip = (e: KeyboardEvent) => {
      if (['Escape', 'Enter', ' '].includes(e.key)) onDone();
    };
    window.addEventListener('keydown', skip);
    return () => {
      alive = false;
      stop();
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener('keydown', skip);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`splash${out ? ' out' : ''}`} onClick={onDone} role="presentation">
      <canvas ref={ref} aria-hidden="true" />
      <p className="splash-hint">Click or press Esc to skip</p>
    </div>
  );
}
