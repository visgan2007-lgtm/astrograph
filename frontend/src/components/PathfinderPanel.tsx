import { memo } from 'react';
import type { TourStep } from '../types';

interface Props {
  tour: TourStep[];
  activeId: string | null;
  /** Called with the step to highlight on the canvas, or null to clear. */
  onActivate: (step: TourStep | null) => void;
}

const STAGE_HINT: Record<TourStep['stage'], string> = {
  Orient: 'See how the program starts',
  Foundations: 'Low-level modules the rest builds on',
  'Core logic': 'Where most behaviour lives',
};

/** Guided reading order for new contributors; clicking a step highlights its import route on the atlas. */
export default memo(function PathfinderPanel({ tour, activeId, onActivate }: Props) {
  if (tour.length === 0) return <p className="muted">No guided tour is available for this analysis.</p>;

  return (
    <div className="tour">
      <p className="muted">Read these files in order. Select one to light up its import route from an entry point.</p>
      <ol className="tour-list">
        {tour.map((s, i) => {
          const active = s.id === activeId;
          const newStage = i === 0 || tour[i - 1].stage !== s.stage;
          return (
            <li key={s.id}>
              {newStage && (
                <div className="tour-stage">
                  <strong>{s.stage}</strong>
                  <span className="muted">{STAGE_HINT[s.stage]}</span>
                </div>
              )}
              <button
                className="tour-step glass"
                aria-pressed={active}
                onClick={() => onActivate(active ? null : s)}
              >
                <span className="tour-rank">{s.rank}</span>
                <span className="tour-body">
                  <code className="clip">{s.label}</code>
                  <span className="tour-why">{s.why}</span>
                  <span className="tour-metrics muted">
                    fan-in {s.metrics.fan_in} · fan-out {s.metrics.fan_out} · depth {s.metrics.depth} · centrality{' '}
                    {s.metrics.centrality.toFixed(2)}
                  </span>
                  {active && s.route.length > 1 && <code className="tour-route">{s.route.join(' → ')}</code>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
});
