import { useMemo, useState } from 'react';
import { useSettings } from '../context/SettingsContext';
import type { DiffResult, GraphNodePayload, GraphPayload, TourStep } from '../types';
import DependencyAtlas from './DependencyAtlas';
import DiagnosticsPanel from './DiagnosticsPanel';
import { NodeDetail, Overview } from './Detail';
import PathfinderPanel from './PathfinderPanel';
import SnapshotCompare from './SnapshotCompare';
import ViewSwiper, { type SwipeView } from './ViewSwiper';

export type ViewId = 'atlas' | 'pathfinder' | 'diagnostics' | 'diff';

interface Props {
  graph: GraphPayload;
  view: ViewId;
  onViewChange: (view: ViewId) => void;
  selected: GraphNodePayload | null;
  onSelect: (node: GraphNodePayload | null) => void;
  onExport: () => void;
}

/** The four analysis views (Atlas, Pathfinder, Diagnostics, Snapshot Diff) behind one swipeable tab bar. */
export default function Workspace({ graph, view, onViewChange, selected, onSelect, onExport }: Props) {
  const { settings } = useSettings();
  const [step, setStep] = useState<TourStep | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);

  const highlight = useMemo(
    () => (step ? { nodes: step.route, edges: step.route.slice(1).map((id, i) => `${step.route[i]}->${id}`) } : null),
    [step],
  );
  const diffStatus = useMemo(() => (diff ? { nodes: diff.node_status, edges: diff.edge_status } : null), [diff]);

  const openNode = (id: string) => {
    onSelect(graph.nodes.find((n) => n.id === id) ?? null);
    onViewChange('atlas');
  };

  const canvas = (g: GraphPayload, hl: typeof highlight, st: typeof diffStatus) => (
    <div className="atlas frame">
      <DependencyAtlas graph={g} theme={settings.theme} highlight={hl} status={st} selectedNodeId={selected?.id ?? null} onNodeSelect={onSelect} />
    </div>
  );

  const views: SwipeView[] = [
    {
      id: 'atlas',
      label: 'Dependency Atlas',
      content: (
        <div className="split">
          {canvas(graph, null, null)}
          <aside className="detail frame">{selected ? <NodeDetail node={selected} /> : <Overview graph={graph} />}</aside>
        </div>
      ),
    },
    {
      id: 'pathfinder',
      label: 'Pathfinder',
      content: (
        <div className="split">
          {canvas(graph, highlight, null)}
          <aside className="detail frame">
            <PathfinderPanel tour={graph.tour ?? []} activeId={step?.id ?? null} onActivate={setStep} />
          </aside>
        </div>
      ),
    },
    { id: 'diagnostics', label: 'Diagnostics', swipe: true, content: <DiagnosticsPanel graph={graph} onOpenNode={openNode} /> },
    {
      id: 'diff',
      label: 'Snapshot Diff',
      content: (
        <div className="split">
          {canvas(diff ? diff.graph : graph, null, diffStatus)}
          <aside className="detail frame">
            <SnapshotCompare current={graph.snapshot} onOverlay={setDiff} overlayActive={diff !== null} />
          </aside>
        </div>
      ),
    },
  ];

  return (
    <ViewSwiper
      views={views}
      active={view}
      onChange={(id) => onViewChange(id as ViewId)}
      actions={
        <button
          className="btn glass"
          onClick={onExport}
          disabled={view === 'diagnostics'}
          title={view === 'diagnostics' ? 'Switch to a graph view to export the canvas' : 'Export the graph as PNG, JPG or SVG'}
        >
          Export graph
        </button>
      }
    />
  );
}
