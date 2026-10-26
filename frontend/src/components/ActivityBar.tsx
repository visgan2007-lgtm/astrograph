import { memo, useState } from 'react';
import type { GraphNodePayload } from '../types';
import { langTag } from '../lib/languages';

export type StatusKey = 'entry' | 'cycle' | 'hot' | 'error' | 'added' | 'removed';

export const STATUS_META: Record<StatusKey, { label: string; hint: string }> = {
  entry: { label: 'Entry', hint: 'Entry points' },
  cycle: { label: 'Cycle', hint: 'Modules in a circular dependency' },
  hot: { label: 'Hot', hint: 'Complexity above 30' },
  error: { label: 'Error', hint: 'Files that failed to parse' },
  added: { label: 'New', hint: 'Added since the base snapshot' },
  removed: { label: 'Gone', hint: 'Removed since the base snapshot' },
};

interface Props {
  modules: number;
  edges: number;
  counts: Record<StatusKey, number>;
  /** which status indicators are offered (added/removed only appear during a diff) */
  keys: StatusKey[];
  active: ReadonlySet<StatusKey>;
  onToggle: (key: StatusKey) => void;
  /** nodes shown as interactive chips */
  chips: GraphNodePayload[];
  chipKind: (n: GraphNodePayload) => StatusKey | null;
  selectedId: string | null;
  onHover: (id: string | null) => void;
  onPick: (id: string) => void;
}

/** Corner bar of the atlas: live status indicators (click to spotlight) and node chips (hover to preview, click to fly there). */
export default memo(function ActivityBar({ modules, edges, counts, keys, active, onToggle, chips, chipKind, selectedId, onHover, onPick }: Props) {
  const [open, setOpen] = useState(true);

  return (
    <div className="activity-bar" data-open={open} role="region" aria-label="Graph activity">
      <button className="activity-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="activity-title">Activity</span>
        <span className="activity-stats">
          {modules} modules · {edges} edges
        </span>
        <span className="activity-caret" aria-hidden="true">
          {open ? '–' : '+'}
        </span>
      </button>

      {open && (
        <>
          <div className="activity-status" role="group" aria-label="Status indicators">
            {keys.map((k) => (
              <button
                key={k}
                className="status-pill"
                data-kind={k}
                aria-pressed={active.has(k)}
                disabled={counts[k] === 0}
                title={STATUS_META[k].hint}
                onClick={() => onToggle(k)}
              >
                <i className="status-dot" />
                {STATUS_META[k].label}
                <b>{counts[k]}</b>
              </button>
            ))}
          </div>

          <div className="activity-nodes" role="list" aria-label={active.size ? 'Nodes matching the active indicators' : 'Key nodes'}>
            {chips.length === 0 && <span className="muted">No nodes match.</span>}
            {chips.map((n) => {
              const kind = chipKind(n);
              return (
                <button
                  key={n.id}
                  role="listitem"
                  className="node-chip"
                  data-kind={kind ?? 'plain'}
                  aria-current={n.id === selectedId ? 'true' : undefined}
                  title={n.path}
                  onMouseEnter={() => onHover(n.id)}
                  onMouseLeave={() => onHover(null)}
                  onFocus={() => onHover(n.id)}
                  onBlur={() => onHover(null)}
                  onClick={() => onPick(n.id)}
                >
                  <i className="status-dot" />
                  <span className="clip">{n.label}</span>
                  <em>{langTag(n.language)}</em>
                </button>
              );
            })}
          </div>
          <div className="activity-legend">┄ dashed edge = deferred import</div>
        </>
      )}
    </div>
  );
});
