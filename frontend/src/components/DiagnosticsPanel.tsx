import { motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { useSettings } from '../context/SettingsContext';
import type { GraphPayload } from '../types';
import { LangTag } from './Detail';

type SortKey = 'label' | 'loc' | 'complexity' | 'in_degree' | 'out_degree';

const COLS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'label', label: 'Module', numeric: false },
  { key: 'loc', label: 'LOC', numeric: true },
  { key: 'complexity', label: 'Complexity', numeric: true },
  { key: 'in_degree', label: 'Fan-in', numeric: true },
  { key: 'out_degree', label: 'Fan-out', numeric: true },
];

interface Props {
  graph: GraphPayload;
  onOpenNode: (id: string) => void;
}

/** Sortable per-module metrics, circular dependencies and parse errors. */
export default function DiagnosticsPanel({ graph, onOpenNode }: Props) {
  const { dur } = useSettings();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'complexity', desc: true });

  const rows = useMemo(() => {
    const sorted = [...graph.nodes].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
      return sort.desc ? -c : c;
    });
    return sorted.slice(0, 200);
  }, [graph.nodes, sort]);
  const errors = graph.nodes.filter((n) => n.parse_error);
  const top = Math.max(1, ...graph.nodes.map((n) => n.complexity));

  return (
    <div className="diag">
      <section className="diag-table glass">
        <table>
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.key} className={c.numeric ? 'num' : ''} aria-sort={sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
                  <button onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : c.numeric }))}>
                    {c.label}
                    {sort.key === c.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((n, i) => (
              <motion.tr
                key={n.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: dur(0.25), delay: Math.min(i, 12) * dur(0.02) }}
                onClick={() => onOpenNode(n.id)}
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onOpenNode(n.id)}
              >
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
              </motion.tr>
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
}
