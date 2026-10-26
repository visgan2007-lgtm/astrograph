import { memo, startTransition, useMemo, useState } from 'react';
import type { GraphNodePayload, GraphPayload } from '../types';
import { LangTag } from './Detail';

type SortKey = 'label' | 'loc' | 'complexity' | 'in_degree' | 'out_degree';
const MAX_ROWS = 200;

const COLS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'label', label: 'Module', numeric: false },
  { key: 'loc', label: 'LOC', numeric: true },
  { key: 'complexity', label: 'Complexity', numeric: true },
  { key: 'in_degree', label: 'Fan-in', numeric: true },
  { key: 'out_degree', label: 'Fan-out', numeric: true },
];

interface RowProps {
  n: GraphNodePayload;
  top: number;
  onOpen: (id: string) => void;
}

/** One table row. Memoized: sorting reorders rows but does not re-render the ones whose data is unchanged. */
const Row = memo(function Row({ n, top, onOpen }: RowProps) {
  return (
    <tr className="row-in" onClick={() => onOpen(n.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(n.id)}>
      <td className="clip">
        <LangTag id={n.language} /> <code>{n.label}</code>
      </td>
      <td className="num">{n.loc}</td>
      <td className="num">
        <span className="cx-bar" style={{ width: `${(n.complexity / top) * 100}%` }} />
        <span className="cx-val">{n.complexity}</span>
      </td>
      <td className="num">{n.in_degree}</td>
      <td className="num">{n.out_degree}</td>
    </tr>
  );
});

interface Props {
  graph: GraphPayload;
  onOpenNode: (id: string) => void;
}

/** Sortable per-module metrics, circular dependencies and parse errors. */
export default memo(function DiagnosticsPanel({ graph, onOpenNode }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'complexity', desc: true });

  const rows = useMemo(() => {
    const { key, desc } = sort;
    const sorted = [...graph.nodes].sort((a, b) => {
      const x = a[key];
      const y = b[key];
      const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
      return desc ? -c : c;
    });
    return sorted.slice(0, MAX_ROWS);
  }, [graph.nodes, sort]);
  const errors = useMemo(() => graph.nodes.filter((n) => n.parse_error), [graph.nodes]);
  // reduce instead of Math.max(...array): no argument-count limit on very large graphs
  const top = useMemo(() => graph.nodes.reduce((m, n) => (n.complexity > m ? n.complexity : m), 1), [graph.nodes]);

  // Sorting is a low-priority update: the header click paints immediately, the re-sort never blocks input.
  const sortBy = (key: SortKey, numeric: boolean) =>
    startTransition(() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : numeric })));

  return (
    <div className="diag">
      <section className="diag-table glass">
        <table>
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.key} className={c.numeric ? 'num' : ''} aria-sort={sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
                  <button onClick={() => sortBy(c.key, c.numeric)}>
                    {c.label}
                    {sort.key === c.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => (
              <Row key={n.id} n={n} top={top} onOpen={onOpenNode} />
            ))}
          </tbody>
        </table>
      </section>

      <aside className="diag-side">
        <section className="glass panel">
          <h3>Circular dependencies</h3>
          {graph.cycles.length === 0 && <p className="muted">None found.</p>}
          <ul className="list">
            {graph.cycles.map((c) => (
              <li key={c.id}>
                <code className="cycle">{c.path.join(' → ')}</code>
                <span className="muted">{c.members.length} modules</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="glass panel">
          <h3>Parse errors</h3>
          {errors.length === 0 && <p className="muted">All files parsed.</p>}
          <ul className="list">
            {errors.map((n) => (
              <li key={n.id}>
                <code>{n.id}</code>
                <span className="error-inline">{n.parse_error}</span>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
});
