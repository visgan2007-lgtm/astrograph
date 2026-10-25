import { animate, motion, useMotionValue, useSpring, useTransform, type Variants } from 'framer-motion';
import { useEffect, useMemo, useRef, type PointerEvent, type ReactNode } from 'react';
import { useSettings } from '../context/SettingsContext';
import { computeHealth } from '../lib/health';
import { langMeta } from '../lib/languages';
import type { GraphPayload } from '../types';
import GhostText from './GhostText';

export type BentoTarget = 'pathfinder' | 'diagnostics';

interface Props {
  graph: GraphPayload;
  onOpenView: (view: BentoTarget) => void;
  onOpenNode: (id: string) => void;
}

/* ---------------------------------------------------------------- tile */

/** A bento cell: cursor spotlight, soft 3D tilt, staggered entrance. */
function Tile({ className, title, children }: { className: string; title: string; children: ReactNode }) {
  const { dur, reducedMotion } = useSettings();
  const ref = useRef<HTMLElement>(null);
  const rx = useSpring(useMotionValue(0), { stiffness: 170, damping: 18 });
  const ry = useSpring(useMotionValue(0), { stiffness: 170, damping: 18 });

  const move = (e: PointerEvent<HTMLElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    el.style.setProperty('--mx', `${x}px`);
    el.style.setProperty('--my', `${y}px`);
    if (!reducedMotion) {
      ry.set((x / r.width - 0.5) * 6);
      rx.set(-(y / r.height - 0.5) * 6);
    }
  };
  const leave = () => {
    rx.set(0);
    ry.set(0);
  };
  const variants: Variants = {
    hidden: { opacity: 0, y: 18, scale: 0.97 },
    show: { opacity: 1, y: 0, scale: 1, transition: { duration: dur(0.5), ease: [0.22, 1, 0.36, 1] } },
  };

  return (
    <motion.article
      ref={ref}
      className={`bento-tile ${className}`}
      variants={variants}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 900 }}
      whileHover={reducedMotion ? undefined : { y: -3 }}
      onPointerMove={move}
      onPointerLeave={leave}
    >
      <GhostText as="h3" text={title} stagger={0.02} className="bento-title" />
      {children}
    </motion.article>
  );
}

/* ------------------------------------------------------------- widgets */

function HealthRing({ score, grade }: { score: number; grade: string }) {
  const { dur } = useSettings();
  const C = 2 * Math.PI * 52;
  const value = useMotionValue(0);
  const shown = useTransform(value, (v) => Math.round(v));
  useEffect(() => {
    const controls = animate(value, score, { duration: dur(1.2), ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [score, value, dur]);

  return (
    <div className="ring">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="52" className="ring-track" />
        <motion.circle
          cx="60" cy="60" r="52" className="ring-fill" strokeDasharray={C}
          initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: C * (1 - score / 100) }}
          transition={{ duration: dur(1.2), ease: [0.22, 1, 0.36, 1] }}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div className="ring-label" role="img" aria-label={`Health score ${score} out of 100, grade ${grade}`}>
        <motion.strong>{shown}</motion.strong>
        <span>Grade {grade}</span>
      </div>
    </div>
  );
}

function Bars({ items, onPick }: { items: { id: string; label: string; value: number }[]; onPick: (id: string) => void }) {
  const { dur } = useSettings();
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <p className="muted">Nothing to show.</p>;
  return (
    <ul className="bars">
      {items.map((it, i) => (
        <li key={it.id}>
          <button onClick={() => onPick(it.id)} title={it.id}>
            <span className="clip">{it.label}</span>
            <span className="bar-track">
              <motion.span
                className="bar-fill" initial={{ scaleX: 0 }} animate={{ scaleX: it.value / max }}
                transition={{ duration: dur(0.6), delay: dur(0.08 * i), ease: [0.22, 1, 0.36, 1] }}
              />
            </span>
            <b>{it.value}</b>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- grid */

export default function MagicBento({ graph, onOpenView, onOpenNode }: Props) {
  const { dur } = useSettings();
  const health = useMemo(() => computeHealth(graph), [graph]);

  const buckets = useMemo(() => {
    const edges = [5, 10, 20, 50, Infinity];
    const labels = ['1–5', '6–10', '11–20', '21–50', '50+'];
    const counts = edges.map(() => 0);
    for (const n of graph.nodes) counts[edges.findIndex((e) => n.complexity <= e)] += 1;
    return labels.map((label, i) => ({ label, count: counts[i] }));
  }, [graph.nodes]);
  const maxBucket = Math.max(1, ...buckets.map((b) => b.count));
  const maxCx = Math.max(0, ...graph.nodes.map((n) => n.complexity));
  const topFns = useMemo(
    () =>
      graph.nodes
        .flatMap((n) => n.functions.map((f) => ({ ...f, module: n.id })))
        .sort((a, b) => b.complexity - a.complexity)
        .slice(0, 3),
    [graph.nodes],
  );
  const top = (key: 'in_degree' | 'out_degree') =>
    [...graph.nodes].sort((a, b) => b[key] - a[key]).filter((n) => n[key] > 0).slice(0, 4).map((n) => ({ id: n.id, label: n.label, value: n[key] }));
  const tour = (graph.tour ?? []).slice(0, 3);
  const grid: Variants = { hidden: {}, show: { transition: { staggerChildren: dur(0.07) } } };

  return (
    <motion.div className="bento" variants={grid} initial="hidden" animate="show">
      <Tile className="t-health" title="Architectural health">
        <HealthRing score={health.score} grade={health.grade} />
        <ul className="factors">
          {health.factors.filter((f) => f.penalty > 0).slice(0, 4).map((f) => (
            <li key={f.label} title={f.note}>
              <span>{f.label}</span>
              <b>−{f.penalty}</b>
            </li>
          ))}
          {health.factors.every((f) => f.penalty === 0) && <li className="muted">No deductions. Clean architecture.</li>}
        </ul>
      </Tile>

      <Tile className="t-cx" title="Cyclomatic complexity">
        <div className="cx-head">
          <div><strong>{graph.stats.avg_complexity}</strong><span className="muted">average</span></div>
          <div><strong>{maxCx}</strong><span className="muted">highest module</span></div>
          <div><strong>{graph.stats.loc.toLocaleString()}</strong><span className="muted">lines</span></div>
        </div>
        <div className="histo" role="img" aria-label="Modules by complexity bucket">
          {buckets.map((b, i) => (
            <div key={b.label} className="histo-col">
              <motion.span
                className="histo-bar" style={{ height: `${(b.count / maxBucket) * 100}%` }}
                initial={{ scaleY: 0 }} animate={{ scaleY: 1 }}
                transition={{ duration: dur(0.6), delay: dur(0.06 * i), ease: [0.22, 1, 0.36, 1] }}
              />
              <b>{b.count}</b>
              <span className="muted">{b.label}</span>
            </div>
          ))}
        </div>
        {topFns.length > 0 && (
          <p className="muted clip">Hardest: {topFns.map((f) => `${f.name} (${f.complexity})`).join(' · ')}</p>
        )}
      </Tile>

      <Tile className="t-fan" title="Fan-in / fan-out">
        <h4>Most depended on</h4>
        <Bars items={top('in_degree')} onPick={onOpenNode} />
        <h4>Most dependencies</h4>
        <Bars items={top('out_degree')} onPick={onOpenNode} />
      </Tile>

      <Tile className="t-cycles" title="Cycle warnings">
        {graph.cycles.length === 0 ? (
          <p className="ok-note">✓ No circular dependencies. Every module can be loaded in a clean order.</p>
        ) : (
          <>
            <p className="warn-note">
              {graph.cycles.length} cycle cluster{graph.cycles.length > 1 ? 's' : ''} found
            </p>
            <ul className="list">
              {graph.cycles.slice(0, 3).map((c) => (
                <li key={c.id}>
                  <code className="cycle">{c.path.join(' → ')}</code>
                  <span className="muted">{c.members.length} modules</span>
                </li>
              ))}
            </ul>
            <button className="btn glass fit" onClick={() => onOpenView('diagnostics')}>Inspect in Diagnostics</button>
          </>
        )}
      </Tile>

      <Tile className="t-path" title="Pathfinder suggestions">
        {tour.length === 0 ? (
          <p className="muted">No guided tour for this analysis.</p>
        ) : (
          <ol className="tour-mini">
            {tour.map((s) => (
              <li key={s.id}>
                <span className="tour-rank">{s.rank}</span>
                <div>
                  <code>{s.label}</code>
                  <span className="stage-chip">{s.stage}</span>
                  <p className="muted">{s.why}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
        <button className="btn primary fit" onClick={() => onOpenView('pathfinder')}>Open Pathfinder</button>
      </Tile>

      {graph.languages && Object.keys(graph.languages).length > 0 && (
        <div className="bento-langs">
          {Object.entries(graph.languages).map(([id, n]) => (
            <span key={id} className="lang-pill">{langMeta(id)?.label ?? id} · {n}</span>
          ))}
        </div>
      )}
    </motion.div>
  );
}
