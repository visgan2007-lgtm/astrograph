import { memo, useCallback, useMemo, useState } from 'react';
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
export default memo(function Workspace({ graph, view, onViewChange, selected, onSelect, onExport }: Props) {
  const { settings } = useSettings();
  const theme = settings.theme;
  const [step, setStep] = useState<TourStep | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);

  const highlight = useMemo(
    () => (step ? { nodes: step.route, edges: step.route.slice(1).map((id, i) => `${step.route[i]}->${id}`) } : null),
    [step],
  );
  const diffStatus = useMemo(() => (diff ? { nodes: diff.node_status, edges: diff.edge_status } : null), [diff]);
  const tour = useMemo(() => graph.tour ?? [], [graph.tour]);
  const selectedId = selected?.id ?? null;

  const openNode = useCallback(
    (id: string) => {
      onSelect(graph.nodes.find((n) => n.id === id) ?? null);
      onViewChange('atlas');
    },
    [graph.nodes, onSelect, onViewChange],
  );
  const onViewId = useCallback((id: string) => onViewChange(id as ViewId), [onViewChange]);
  const clearOverlay = useCallback((d: DiffResult | null) => setDiff(d), []);

  // Each view is built once per relevant change, so the canvases keep stable props and skip re-renders.
  const views = useMemo<SwipeView[]>(() => {
    const canvas = (g: GraphPayload, hl: typeof highlight, st: typeof diffStatus) => (
      <div className="atlas frame">
        <DependencyAtlas graph={g} theme={theme} highlight={hl} status={st} selectedNodeId={selectedId} onNodeSelect={onSelect} />
      </div>
    );
    return [
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
              <PathfinderPanel tour={tour} activeId={step?.id ?? null} onActivate={setStep} />
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
              <SnapshotCompare current={graph.snapshot} onOverlay={clearOverlay} overlayActive={diff !== null} />
            </aside>
          </div>
        ),
      },
    ];
  }, [graph, theme, highlight, diffStatus, diff, selected, selectedId, step, tour, onSelect, openNode, clearOverlay]);

  const actions = useMemo(
    () => (
      <button
        className="btn glass"
        onClick={onExport}
        disabled={view === 'diagnostics'}
        title={view === 'diagnostics' ? 'Switch to a graph view to export the canvas' : 'Export the graph as PNG, JPG or SVG'}
      >
        Export graph
      </button>
    ),
    [onExport, view],
  );

  return <ViewSwiper views={views} active={view} onChange={onViewId} actions={actions} />;
});
