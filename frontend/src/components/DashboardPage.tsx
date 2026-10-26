import { memo, useMemo } from 'react';
import { langMeta } from '../lib/languages';
import type { GraphPayload } from '../types';
import GhostText from './GhostText';
import MagicBento, { type BentoTarget } from './MagicBento';

interface Props {
  graph: GraphPayload;
  runId: number;
  onOpenView: (view: BentoTarget) => void;
  onOpenNode: (id: string) => void;
}

export default memo(function DashboardPage({ graph, runId, onOpenView, onOpenNode }: Props) {
  const languages = useMemo(() => (graph.languages ? Object.entries(graph.languages) : []), [graph.languages]);
  return (
    <section className="dash">
      <div className="dash-head">
        <div>
          <GhostText as="h2" text="Dashboard" className="page-title" />
          <p className="muted">{graph.repository?.source ?? 'Latest repository'}</p>
        </div>
        <div className="dash-meta">
          {languages.map(([id, n]) => (
            <span key={id} className="lang-pill">
              {langMeta(id)?.label ?? id} · {n}
            </span>
          ))}
        </div>
      </div>
      <MagicBento key={runId} graph={graph} onOpenView={onOpenView} onOpenNode={onOpenNode} />
    </section>
  );
});
