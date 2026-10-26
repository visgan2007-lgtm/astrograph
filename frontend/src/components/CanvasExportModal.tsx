import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { useSettings } from '../context/SettingsContext';
import { getAtlasExport } from '../lib/atlasExport';

type Format = 'png' | 'jpg' | 'svg';
type Background = 'transparent' | 'dark' | 'light';
type Scope = 'graph' | 'view';

interface Props {
  open: boolean;
  onClose: () => void;
  /** used for the file name */
  source: string;
}

const FILL: Record<Exclude<Background, 'transparent'>, string> = { dark: '#050a18', light: '#ffffff' };
const SCALES = [1, 2, 3, 4];
const PADDING = 48; // px of breathing room around the graph, in graph units
const MAX_SIDE = 16384; // browsers refuse larger canvases
const MAX_PIXELS = 120_000_000;

function save(href: string, name: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
}

/** Export the dependency atlas as a PNG, JPG or SVG image. */
export default memo(function CanvasExportModal({ open, onClose, source }: Props) {
  const { settings } = useSettings();
  const [format, setFormat] = useState<Format>('png');
  const [bg, setBg] = useState<Background>(settings.theme);
  const [scope, setScope] = useState<Scope>('graph');
  const [scale, setScale] = useState(2);
  const [quality, setQuality] = useState(0.92);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setMsg(null);
    setBg((b) => (b === 'transparent' && format === 'jpg' ? settings.theme : b));
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, format, settings.theme]);

  const api = open ? getAtlasExport() : null;
  const bounds = useMemo(() => api?.getBounds() ?? null, [api, open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Base size in CSS pixels, then the output size after the resolution multiplier (clamped to what browsers allow).
  const base = useMemo(() => {
    if (!api) return null;
    if (scope === 'view') return { w: api.element.clientWidth, h: api.element.clientHeight };
    if (!bounds) return null;
    return { w: Math.ceil(bounds.width + PADDING * 2), h: Math.ceil(bounds.height + PADDING * 2) };
  }, [api, scope, bounds]);
  const effective = base ? Math.max(0.25, Math.min(scale, MAX_SIDE / base.w, MAX_SIDE / base.h, Math.sqrt(MAX_PIXELS / (base.w * base.h)))) : scale;
  const out = base ? { w: Math.round(base.w * effective), h: Math.round(base.h * effective) } : null;
  const clamped = base !== null && effective < scale;
  const transparentOk = format !== 'jpg';
  const mismatch = bg !== 'transparent' && bg !== settings.theme;

  if (!open) return null;

  const run = async () => {
    const target = getAtlasExport();
    if (!target || !base) {
      setMsg({ kind: 'error', text: 'Open a graph view (Atlas, Pathfinder or Snapshot Diff) first. The canvas has to be on screen to export it.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    let restore: (() => void) | undefined;
    try {
      const { toJpeg, toPng, toSvg } = await import('html-to-image');
      const fill = bg === 'transparent' ? undefined : FILL[bg];
      const skip = (n: HTMLElement) =>
        !(n.classList?.contains('react-flow__minimap') || n.classList?.contains('react-flow__controls') || n.classList?.contains('react-flow__panel'));
      const common = { backgroundColor: fill, pixelRatio: effective, filter: skip, cacheBust: true };

      let el: HTMLElement;
      let extra: object = {};
      if (scope === 'graph') {
        restore = await target.renderAll(); // make sure virtualised nodes exist in the DOM
        const b = target.getBounds();
        const vp = target.element.querySelector<HTMLElement>('.react-flow__viewport');
        if (!b || !vp) throw new Error('The graph is empty.');
        el = vp;
        extra = {
          width: base.w,
          height: base.h,
          style: { width: `${base.w}px`, height: `${base.h}px`, transform: `translate(${PADDING - b.x}px, ${PADDING - b.y}px) scale(1)` },
        };
      } else {
        const rf = target.element.querySelector<HTMLElement>('.react-flow');
        if (!rf) throw new Error('The canvas is not mounted.');
        el = rf;
      }

      const opts = { ...common, ...extra };
      const url =
        format === 'svg' ? await toSvg(el, opts) : format === 'jpg' ? await toJpeg(el, { ...opts, quality }) : await toPng(el, opts);
      const slug = source.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'graph';
      save(url, `astrograph-${slug}.${format}`);
      setMsg({ kind: 'ok', text: `Saved ${format.toUpperCase()}${format === 'svg' ? '' : ` at ${out?.w} × ${out?.h}px`}.` });
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Export failed.' });
    } finally {
      restore?.();
      setBusy(false);
    }
  };

  const seg = <T extends string | number>(label: string, value: T, options: { v: T; text: string; off?: boolean; hint?: string }[], set: (v: T) => void, first = false) => (
    <div className="exp-field" role="group" aria-label={label}>
      <span className="exp-label">{label}</span>
      <div className="seg">
        {options.map((o, i) => (
          <button
            key={String(o.v)}
            ref={first && i === 0 ? firstRef : undefined}
            aria-pressed={value === o.v}
            disabled={o.off}
            title={o.hint}
            onClick={() => set(o.v)}
          >
            {o.text}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="modal-back" onClick={onClose} role="presentation">
      <div className="modal glass" role="dialog" aria-modal="true" aria-labelledby="export-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="export-title">Export graph</h2>
        <p className="muted">{source}</p>

        {!api && <p className="error-inline" role="alert">Switch to Atlas, Pathfinder or Snapshot Diff to export the canvas.</p>}

        {seg<Format>('Format', format, [{ v: 'png', text: 'PNG' }, { v: 'jpg', text: 'JPG' }, { v: 'svg', text: 'SVG' }], (f) => {
          setFormat(f);
          if (f === 'jpg' && bg === 'transparent') setBg(settings.theme);
        }, true)}

        {seg<Scope>('Area', scope, [
          { v: 'graph', text: 'Whole graph', hint: 'Fit every node, regardless of pan and zoom' },
          { v: 'view', text: 'Current view', hint: 'Exactly what is on screen' },
        ], setScope)}

        {seg<Background>('Background', bg, [
          { v: 'transparent', text: 'Transparent', off: !transparentOk, hint: transparentOk ? undefined : 'JPG cannot be transparent' },
          { v: 'dark', text: 'Dark' },
          { v: 'light', text: 'Light' },
        ], setBg)}
        {mismatch && (
          <p className="muted">
            Nodes are drawn with the {settings.theme} theme colours. For the best contrast, pick {settings.theme === 'dark' ? 'Dark' : 'Light'} or Transparent, or switch the theme first.
          </p>
        )}

        {format !== 'svg' ? (
          <>
            {seg<number>('Resolution', scale, SCALES.map((s) => ({ v: s, text: `${s}×` })), setScale)}
            <p className="muted" aria-live="polite">
              {out ? `${out.w} × ${out.h} px` : 'Nothing to export'}
              {clamped ? ` (limited from ${scale}× to stay within browser canvas limits)` : ''}
            </p>
          </>
        ) : (
          <p className="muted">SVG is vector: it stays sharp at any size, so no resolution is needed.</p>
        )}

        {format === 'jpg' && (
          <label className="exp-field">
            <span className="exp-label">Quality {Math.round(quality * 100)}%</span>
            <input type="range" min={0.6} max={1} step={0.02} value={quality} onChange={(e) => setQuality(Number(e.target.value))} aria-label="JPG quality" />
          </label>
        )}

        {msg && (
          <p className={msg.kind === 'error' ? 'error-inline' : 'ok-note'} role={msg.kind === 'error' ? 'alert' : 'status'}>
            {msg.text}
          </p>
        )}

        <div className="modal-row end">
          <button className="btn glass" onClick={onClose}>
            Close
          </button>
          <button className="btn primary" onClick={run} disabled={busy || !api || !base}>
            {busy ? 'Rendering…' : `Download ${format.toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
});
