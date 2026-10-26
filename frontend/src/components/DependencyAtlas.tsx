import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  getNodesBounds,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type OnMove,
  type NodeMouseHandler,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { registerAtlasExport } from '../lib/atlasExport';
import { langTag } from '../lib/languages';
import type { GraphNodePayload, GraphPayload } from '../types';
import ActivityBar, { type StatusKey } from './ActivityBar';

export type { GraphNodePayload, GraphEdgePayload, GraphPayload } from '../types';

export interface DependencyAtlasProps {
  graph: GraphPayload;
  /** Controlled selection; omit for uncontrolled behaviour. */
  selectedNodeId?: string | null;
  onNodeSelect?: (node: GraphNodePayload | null) => void;
  theme?: 'dark' | 'light';
  /** Pathfinder route: these nodes/edges stay lit, everything else dims. */
  highlight?: { nodes: string[]; edges: string[] } | null;
  /** Snapshot diff: colours added (green) and removed (red) items. */
  status?: { nodes: Record<string, string>; edges: Record<string, string> } | null;
  className?: string;
  style?: CSSProperties;
}

type ModuleNodeData = {
  payload: GraphNodePayload;
  selected: boolean;
  dimmed: boolean;
  mark: 'path' | 'added' | 'removed' | null;
  theme: 'dark' | 'light';
  /** 1.2 while the node is the hovered / selected / on-path focus */
  scale: number;
  focus: boolean;
};
type ModuleFlowNode = Node<ModuleNodeData, 'module'>;

/* ----------------------------------------------------------------- theme */

interface Palette {
  bg: string; node: string; nodeBorder: string; text: string; muted: string; crimson: string; gold: string;
  edge: string; low: string; mid: string; high: string; panel: string; grid: string; mask: string; track: string;
  /** high-contrast focus ring for hovered / selected paths */
  focus: string;
  path: string; added: string; removed: string;
}
/** Light values are verified at WCAG AAA (7:1) against the node surface and the worst-case panel backdrop. */
const PALETTES: Record<'dark' | 'light', Palette> = {
  dark: {
    bg: '#01030a', node: '#0b1730', nodeBorder: '#2b4470', text: '#eaf2ff', muted: '#9bb0d0', crimson: '#ff6b78',
    gold: '#e0b84a', edge: '#5d80b8', low: '#5fc79a', mid: '#e0ae4a', high: '#ff7566',
    panel: 'rgba(8,18,44,.78)', grid: '#1d3a66', mask: '#01030acc', track: '#16284a',
    focus: '#ffe45c', path: '#38bdf8', added: '#35d07f', removed: '#ff6b6b',
  },
  light: {
    bg: '#ffffff', node: '#ffffff', nodeBorder: '#4a5f8a', text: '#0b1220', muted: '#2f3d5a', crimson: '#8f1424',
    gold: '#5c4100', edge: '#3f5278', low: '#10523d', mid: '#664300', high: '#85200f',
    panel: 'rgba(255,255,255,.94)', grid: '#b9c6e0', mask: '#ffffffcc', track: '#c9d5ec',
    focus: '#1237c8', path: '#00536f', added: '#075a30', removed: '#8f1020',
  },
};
/** Palette in use; swapped at the top of each Atlas render so the helpers below stay simple. */
const COLORS: Palette = { ...PALETTES.dark };

const NODE_WIDTH = 230;
const COL_W = 320;
const ROW_H = 118;

const complexityColor = (c: number): string =>
  c <= 10 ? COLORS.low : c <= 30 ? COLORS.mid : COLORS.high;

/* ---------------------------------------------------------------- layout */

/** Layered left→right layout: importers on the left, dependencies on the right.
 *  Intra-cycle edges are ignored for ranking so cyclic graphs still layer cleanly. */
function computeLayout(graph: GraphPayload): Map<string, { x: number; y: number }> {
  const ids = graph.nodes.map((n) => n.id);
  const label = new Map(graph.nodes.map((n) => [n.id, n.label]));
  const succ = new Map<string, string[]>(ids.map((i) => [i, []]));
  const pred = new Map<string, string[]>(ids.map((i) => [i, []]));
  const pending = new Map<string, number>(ids.map((i) => [i, 0]));

  for (const e of graph.edges) {
    if (e.in_cycle || e.source === e.target) continue;
    succ.get(e.source)?.push(e.target);
    pred.get(e.target)?.push(e.source);
    pending.set(e.target, (pending.get(e.target) ?? 0) + 1);
  }

  const rank = new Map<string, number>(ids.map((i) => [i, 0]));
  const remaining = new Set(ids);
  const queue: string[] = ids.filter((i) => pending.get(i) === 0);
  let head = 0;

  while (remaining.size > 0) {
    if (head >= queue.length) {
      // Residual cycle through deferred imports: force the least-constrained node.
      let best: string | undefined;
      let bestDeg = Infinity;
      for (const id of remaining) {
        const d = pending.get(id) ?? 0;
        if (d < bestDeg) {
          best = id;
          bestDeg = d;
        }
      }
      if (best === undefined) break;
      queue.push(best);
    }
    const id = queue[head++];
    if (!remaining.delete(id)) continue;
    for (const nxt of succ.get(id) ?? []) {
      rank.set(nxt, Math.max(rank.get(nxt) ?? 0, (rank.get(id) ?? 0) + 1));
      const d = (pending.get(nxt) ?? 0) - 1;
      pending.set(nxt, d);
      if (d === 0 && remaining.has(nxt)) queue.push(nxt);
    }
  }

  const layers = new Map<number, string[]>();
  for (const id of ids) {
    const r = rank.get(id) ?? 0;
    const layer = layers.get(r) ?? [];
    layer.push(id);
    layers.set(r, layer);
  }

  const order = [...layers.keys()].sort((a, b) => a - b);
  const indexInLayer = new Map<string, number>();
  for (const r of order) {
    const layer = layers.get(r)!;
    if (r === order[0]) {
      layer.sort((a, b) => (label.get(a) ?? a).localeCompare(label.get(b) ?? b));
    } else {
      // Barycentre ordering against already-placed predecessors to reduce crossings.
      const bary = (id: string): number => {
        const idx = (pred.get(id) ?? [])
          .map((p) => indexInLayer.get(p))
          .filter((v): v is number => v !== undefined);
        return idx.length ? idx.reduce((s, v) => s + v, 0) / idx.length : Number.MAX_SAFE_INTEGER;
      };
      layer.sort(
        (a, b) => bary(a) - bary(b) || (label.get(a) ?? a).localeCompare(label.get(b) ?? b),
      );
    }
    layer.forEach((id, i) => indexInLayer.set(id, i));
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const r of order) {
    const layer = layers.get(r)!;
    const offset = ((layer.length - 1) * ROW_H) / 2;
    layer.forEach((id, i) => positions.set(id, { x: r * COL_W, y: i * ROW_H - offset }));
  }
  return positions;
}

/* ----------------------------------------------------------- custom node */

function ModuleNodeView({ data }: NodeProps<ModuleFlowNode>) {
  const { payload: n, selected, dimmed, mark, scale, focus } = data;
  const inCycle = n.cycle_id !== null;
  const ring = focus ? COLORS.focus : mark ? COLORS[mark] : null;
  const borderColor =
    ring ?? (selected ? COLORS.gold : inCycle ? COLORS.crimson : n.is_entry ? COLORS.gold : COLORS.nodeBorder);
  const heavy = selected || inCycle || mark !== null;

  const container: CSSProperties = {
    width: NODE_WIDTH,
    background: COLORS.node,
    color: COLORS.text,
    border: `${focus ? 3 : heavy ? 2 : 1}px solid ${borderColor}`,
    borderRadius: 6,
    padding: '8px 10px 10px',
    fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11,
    opacity: dimmed ? 0.22 : 1,
    transform: `scale(${scale})`,
    transformOrigin: 'center center',
    boxShadow: focus
      ? `0 0 0 4px ${COLORS.focus}40, 0 0 30px ${COLORS.focus}80, 0 12px 32px #000a`
      : selected
        ? `0 0 0 3px ${COLORS.gold}33, 0 6px 24px #0008`
        : '0 2px 10px #0006',
    transition: 'opacity 140ms ease, box-shadow 160ms ease, transform 200ms cubic-bezier(0.22, 1, 0.36, 1)',
    cursor: 'pointer',
  };
  const handle: CSSProperties = { width: 8, height: 8, background: COLORS.gold, border: `1px solid ${COLORS.bg}` };
  const barPct = Math.min(100, (n.complexity / 60) * 100);

  return (
    <div style={container} title={n.path}>
      <Handle type="target" position={Position.Left} style={handle} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontWeight: 700, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {n.label}
        </span>
        {mark === 'added' && <Badge color={COLORS.added}>NEW</Badge>}
        {mark === 'removed' && <Badge color={COLORS.removed}>REMOVED</Badge>}
        <Badge color={COLORS.muted}>{langTag(n.language)}</Badge>
        {n.is_entry && <Badge color={COLORS.gold}>ENTRY</Badge>}
        {inCycle && <Badge color={COLORS.crimson}>CYCLE</Badge>}
      </div>
      <div style={{ color: COLORS.muted, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 6 }}>
        {n.path}
      </div>
      <div style={{ height: 3, background: COLORS.track, borderRadius: 2, marginBottom: 6 }}>
        <div style={{ width: `${barPct}%`, height: '100%', background: complexityColor(n.complexity), borderRadius: 2 }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: COLORS.muted }}>
        <span>{n.loc} loc</span>
        <span>cx {n.complexity}</span>
        <span>
          ↓{n.in_degree} ↑{n.out_degree}
        </span>
      </div>
      <Handle type="source" position={Position.Right} style={handle} />
    </div>
  );
}

/** Re-render a node only when its own visual state (the `data` object) changes, never for unrelated updates. */
const ModuleNode = memo(ModuleNodeView, (a, b) => a.data === b.data);

function Badge({ color, children }: { color: string; children: string }) {
  return (
    <span style={{ border: `1px solid ${color}`, color, borderRadius: 3, padding: '0 4px', fontSize: 9, letterSpacing: 1, lineHeight: '14px' }}>
      {children}
    </span>
  );
}

const nodeTypes: NodeTypes = { module: ModuleNode };

/* ------------------------------------------------------------ navigation */

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 2.5;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Smooth navigation on top of React Flow:
 *  - wheel / pinch zoom eases toward a target zoom around the cursor (no stepping),
 *  - releasing a fast drag glides to a stop (exponential friction),
 *  - a fresh press, wheel turn or drag cancels any glide.
 */
function useCanvasNavigation(rootRef: RefObject<HTMLDivElement>) {
  const { getViewport, setViewport } = useReactFlow();
  const s = useRef({ zoomRaf: 0, glideRaf: 0, target: 0, ax: 0, ay: 0, rect: null as DOMRect | null, samples: [] as { t: number; x: number; y: number }[] });

  const stopGlide = useCallback(() => {
    cancelAnimationFrame(s.current.glideRaf);
    s.current.glideRaf = 0;
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const st = s.current;

    const zoomTick = () => {
      const v = getViewport();
      const dz = st.target - v.zoom;
      if (Math.abs(dz) < v.zoom * 0.001) {
        st.zoomRaf = 0;
        st.target = 0;
        st.rect = null; // next gesture re-measures
        return;
      }
      const z = v.zoom + dz * 0.22;
      const r = z / v.zoom;
      void setViewport({ zoom: z, x: st.ax - (st.ax - v.x) * r, y: st.ay - (st.ay - v.y) * r });
      st.zoomRaf = requestAnimationFrame(zoomTick);
    };

    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element | null)?.closest('.activity-bar, .react-flow__minimap, .react-flow__controls')) return;
      e.preventDefault();
      e.stopPropagation(); // keep d3-zoom from also handling it
      stopGlide();
      if (!st.rect) st.rect = root.getBoundingClientRect(); // one layout read per gesture, not per wheel tick
      st.ax = e.clientX - st.rect.left;
      st.ay = e.clientY - st.rect.top;
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      const base = st.target || getViewport().zoom;
      st.target = clamp(base * Math.exp(-px * (e.ctrlKey ? 0.01 : 0.002)), MIN_ZOOM, MAX_ZOOM);
      if (reducedMotion()) {
        const v = getViewport();
        const r = st.target / v.zoom;
        void setViewport({ zoom: st.target, x: st.ax - (st.ax - v.x) * r, y: st.ay - (st.ay - v.y) * r });
        st.target = 0;
        st.rect = null;
      } else if (!st.zoomRaf) {
        st.zoomRaf = requestAnimationFrame(zoomTick);
      }
    };

    root.addEventListener('wheel', onWheel, { passive: false, capture: true });
    root.addEventListener('pointerdown', stopGlide, true);
    return () => {
      root.removeEventListener('wheel', onWheel, true);
      root.removeEventListener('pointerdown', stopGlide, true);
      cancelAnimationFrame(st.zoomRaf);
      cancelAnimationFrame(st.glideRaf);
    };
  }, [rootRef, getViewport, setViewport, stopGlide]);

  const onMoveStart = useCallback<OnMove>(() => {
    stopGlide();
    s.current.samples = [];
  }, [stopGlide]);

  const onMove = useCallback<OnMove>((event, vp) => {
    if (!event) return; // programmatic moves (fitView, zoom easing) are not drags
    const now = performance.now();
    const samples = s.current.samples;
    samples.push({ t: now, x: vp.x, y: vp.y });
    while (samples.length > 1 && now - samples[0].t > 120) samples.shift();
  }, []);

  const onMoveEnd = useCallback<OnMove>(
    (event, vp) => {
      const samples = s.current.samples;
      s.current.samples = [];
      if (!event || reducedMotion() || samples.length < 2 || !/^(mouse|pointer|touch)(up|cancel|end)$/.test(event.type)) return;
      const a = samples[0];
      const b = samples[samples.length - 1];
      const dt = b.t - a.t;
      if (dt < 8 || performance.now() - b.t > 100) return; // paused before release: no throw
      let vx = (b.x - a.x) / dt; // px per ms
      let vy = (b.y - a.y) / dt;
      if (Math.hypot(vx, vy) < 0.08) return;
      let { x, y } = vp;
      let last = performance.now();
      const step = (now: number) => {
        const d = Math.min(32, now - last);
        last = now;
        const friction = Math.pow(0.94, d / 16.67);
        vx *= friction;
        vy *= friction;
        if (Math.hypot(vx, vy) < 0.015) {
          s.current.glideRaf = 0;
          return;
        }
        x += vx * d;
        y += vy * d;
        void setViewport({ x, y, zoom: getViewport().zoom });
        s.current.glideRaf = requestAnimationFrame(step);
      };
      s.current.glideRaf = requestAnimationFrame(step);
    },
    [getViewport, setViewport],
  );

  return { onMoveStart, onMove, onMoveEnd };
}

/* ------------------------------------------------------------- component */

const BASE_KEYS: StatusKey[] = ['entry', 'cycle', 'hot', 'error'];
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

function AtlasInner({
  graph,
  selectedNodeId,
  onNodeSelect,
  theme = 'dark',
  highlight = null,
  status = null,
  className,
  style,
}: DependencyAtlasProps) {
  Object.assign(COLORS, PALETTES[theme]);
  const rootRef = useRef<HTMLDivElement>(null);
  const { fitView, getNodes } = useReactFlow();
  const nav = useCanvasNavigation(rootRef);
  const [internalSelected, setInternalSelected] = useState<string | null>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [filters, setFilters] = useState<ReadonlySet<StatusKey>>(new Set());
  const [renderAll, setRenderAll] = useState(false);
  const nodeCache = useRef(new Map<string, { src: ModuleFlowNode; sig: string; out: ModuleFlowNode }>());
  const edgeCache = useRef(new Map<string, { sig: string; out: Edge }>());
  const hoverRaf = useRef(0);
  const pendingHover = useRef<{ node?: string | null; edge?: string | null }>({});
  const selectedId = selectedNodeId !== undefined ? selectedNodeId : internalSelected;

  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const edgeById = useMemo(() => new Map(graph.edges.map((e) => [e.id, e])), [graph.edges]);

  const baseNodes = useMemo<ModuleFlowNode[]>(() => {
    const layout = computeLayout(graph);
    return graph.nodes.map((payload) => ({
      id: payload.id,
      type: 'module' as const,
      position: layout.get(payload.id) ?? { x: 0, y: 0 },
      data: { payload, selected: false, dimmed: false, mark: null, theme: 'dark' as const, scale: 1, focus: false },
    }));
  }, [graph]);

  const [nodes, setNodes, onNodesChange] = useNodesState<ModuleFlowNode>(baseNodes);

  useEffect(() => {
    nodeCache.current.clear();
    edgeCache.current.clear();
    setNodes(baseNodes);
    setInternalSelected(null);
    setFilters(new Set());
    const raf = requestAnimationFrame(() => fitView({ padding: 0.15, duration: 300 }));
    return () => cancelAnimationFrame(raf);
  }, [baseNodes, setNodes, fitView]);

  // Let the export modal reach this canvas.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    return registerAtlasExport({
      element: el,
      getBounds: () => {
        const all = getNodes();
        return all.length ? getNodesBounds(all) : null;
      },
      renderAll: async () => {
        setRenderAll(true);
        await frame();
        await frame();
        await new Promise((r) => setTimeout(r, 80));
        return () => setRenderAll(false);
      },
    });
  }, [getNodes]);

  /* ---- status indicators ---- */
  const matches = useCallback(
    (n: GraphNodePayload, k: StatusKey): boolean => {
      switch (k) {
        case 'entry': return n.is_entry;
        case 'cycle': return n.cycle_id !== null;
        case 'hot': return n.complexity > 30;
        case 'error': return !!n.parse_error;
        case 'added': return status?.nodes[n.id] === 'added';
        case 'removed': return status?.nodes[n.id] === 'removed';
      }
    },
    [status],
  );
  const keys = useMemo<StatusKey[]>(() => (status ? [...BASE_KEYS, 'added', 'removed'] : BASE_KEYS), [status]);
  const counts = useMemo(() => {
    const c: Record<StatusKey, number> = { entry: 0, cycle: 0, hot: 0, error: 0, added: 0, removed: 0 };
    for (const n of graph.nodes) for (const k of keys) if (matches(n, k)) c[k] += 1;
    return c;
  }, [graph.nodes, keys, matches]);
  const kindOf = useCallback(
    (n: GraphNodePayload): StatusKey | null => keys.find((k) => matches(n, k)) ?? null,
    [keys, matches],
  );
  const filterIds = useMemo(() => {
    if (filters.size === 0) return null;
    const act = [...filters].filter((k) => keys.includes(k));
    if (act.length === 0) return null;
    return new Set(graph.nodes.filter((n) => act.some((k) => matches(n, k))).map((n) => n.id));
  }, [filters, keys, graph.nodes, matches]);
  const chips = useMemo(() => {
    const pool = filterIds ? graph.nodes.filter((n) => filterIds.has(n.id)) : [...graph.nodes];
    const rank = (n: GraphNodePayload) => (n.is_entry ? 1000 : 0) + (n.cycle_id !== null ? 500 : 0) + n.complexity + n.in_degree * 2;
    return pool.sort((a, b) => rank(b) - rank(a)).slice(0, filterIds ? 14 : 10);
  }, [graph.nodes, filterIds]);

  /* ---- hover: coalesce enter/leave bursts into one state update per frame ---- */
  const queueHover = useCallback((kind: 'node' | 'edge', id: string | null) => {
    pendingHover.current[kind] = id;
    if (hoverRaf.current) return;
    hoverRaf.current = requestAnimationFrame(() => {
      hoverRaf.current = 0;
      const p = pendingHover.current;
      pendingHover.current = {};
      if ('node' in p) setHoverNode(p.node ?? null);
      if ('edge' in p) setHoverEdge(p.edge ?? null);
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(hoverRaf.current), []);

  /* ---- adjacency, built once per graph, so hover focus costs O(degree) instead of O(edges) ---- */
  const adjacency = useMemo(() => {
    const m = new Map<string, { edges: string[]; nbrs: string[] }>();
    const at = (id: string) => {
      let v = m.get(id);
      if (!v) m.set(id, (v = { edges: [], nbrs: [] }));
      return v;
    };
    for (const e of graph.edges) {
      const a = at(e.source);
      a.edges.push(e.id);
      a.nbrs.push(e.target);
      const b = at(e.target);
      b.edges.push(e.id);
      b.nbrs.push(e.source);
    }
    return m;
  }, [graph.edges]);

  /* ---- focus: hovered edge > hovered node > selected node ---- */
  const focus = useMemo(() => {
    const e = hoverEdge ? edgeById.get(hoverEdge) : undefined;
    if (e) {
      const ends = new Set([e.source, e.target]);
      return { primary: ends, near: ends, edges: new Set([e.id]) };
    }
    const id = hoverNode ?? selectedId;
    if (!id) return null;
    const adj = adjacency.get(id);
    return { primary: new Set([id]), near: new Set<string>([id, ...(adj?.nbrs ?? [])]), edges: new Set<string>(adj?.edges ?? []) };
  }, [hoverEdge, hoverNode, selectedId, edgeById, adjacency]);

  const hlNodes = useMemo(() => (highlight ? new Set(highlight.nodes) : null), [highlight]);
  const hlEdges = useMemo(() => (highlight ? new Set(highlight.edges) : null), [highlight]);

  /**
   * Node/edge objects are reused whenever their visual state is unchanged. React Flow and the per-node
   * memo then skip everything that did not change: hovering one node updates a handful of elements,
   * not all of them.
   */
  const displayNodes = useMemo<ModuleFlowNode[]>(() => {
    const cache = nodeCache.current;
    return nodes.map((n) => {
      const st = status?.nodes[n.id];
      const onPath = hlNodes?.has(n.id) ?? false;
      const primary = hlNodes ? onPath : (focus?.primary.has(n.id) ?? false);
      const mark = st === 'added' || st === 'removed' ? st : onPath ? 'path' : null;
      const dimmed = hlNodes ? !onPath : focus ? !focus.near.has(n.id) : filterIds ? !filterIds.has(n.id) : false;
      const isSel = n.id === selectedId;
      const sig = `${isSel ? 1 : 0}${dimmed ? 1 : 0}${primary ? 1 : 0}${mark ?? '-'}${theme}`;
      const hit = cache.get(n.id);
      if (hit && hit.src === n && hit.sig === sig) return hit.out;
      const out: ModuleFlowNode = {
        ...n,
        selected: isSel,
        zIndex: primary ? 1000 : undefined,
        data: { ...n.data, selected: isSel, dimmed, mark, theme, scale: primary ? 1.2 : 1, focus: primary },
      };
      cache.set(n.id, { src: n, sig, out });
      return out;
    });
  }, [nodes, selectedId, focus, hlNodes, filterIds, status, theme]);

  const displayEdges = useMemo<Edge[]>(() => {
    const cache = edgeCache.current;
    return graph.edges.map((e) => {
      const st = status?.edges[e.id];
      const onPath = hlEdges?.has(e.id) ?? false;
      const inFocus = focus?.edges.has(e.id) ?? false;
      const lit = onPath || inFocus;
      const diffed = st === 'added' || st === 'removed';
      const dimmed = hlEdges
        ? !onPath
        : focus
          ? !inFocus
          : status
            ? st === 'unchanged'
            : filterIds
              ? !(filterIds.has(e.source) && filterIds.has(e.target))
              : false;
      const color = lit
        ? COLORS.focus
        : st === 'added'
          ? COLORS.added
          : st === 'removed'
            ? COLORS.removed
            : e.in_cycle
              ? COLORS.crimson
              : COLORS.edge;
      const width = lit ? 4 : diffed ? 2.6 : Math.min(3, 1 + Math.log2(1 + e.weight + e.calls) * 0.4);
      const opacity = dimmed ? (status ? 0.25 : 0.08) : 1;
      const dashed = !(e.runtime && st !== 'removed');
      const animated = e.in_cycle || lit;
      const sig = `${color}|${width}|${opacity}|${lit ? 1 : 0}|${dashed ? 1 : 0}|${animated ? 1 : 0}`;
      const hit = cache.get(e.id);
      if (hit && hit.sig === sig) return hit.out;
      const out: Edge = {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'smoothstep',
        animated,
        zIndex: lit ? 20 : e.in_cycle ? 5 : 0,
        interactionWidth: 24, // generous hover target
        markerEnd: { type: MarkerType.ArrowClosed, color, width: lit ? 24 : 16, height: lit ? 24 : 16 },
        style: {
          stroke: color,
          strokeWidth: width,
          strokeDasharray: dashed ? '5 4' : undefined, // dashed = deferred / type-only import
          opacity,
          filter: lit ? `drop-shadow(0 0 5px ${color})` : undefined,
          transition: 'stroke-width 160ms ease, opacity 140ms ease',
        },
      };
      cache.set(e.id, { sig, out });
      return out;
    });
  }, [graph.edges, status, hlEdges, focus, filterIds]);

  const select = useCallback(
    (id: string | null) => {
      setInternalSelected(id);
      onNodeSelect?.(id ? (nodeById.get(id) ?? null) : null);
    },
    [nodeById, onNodeSelect],
  );
  const handleNodeClick = useCallback<NodeMouseHandler>((_e, node) => select(node.id === selectedId ? null : node.id), [select, selectedId]);
  const handlePaneClick = useCallback(() => select(null), [select]);
  const onNodeEnter = useCallback<NodeMouseHandler>((_e, node) => queueHover('node', node.id), [queueHover]);
  const onNodeLeave = useCallback<NodeMouseHandler>(() => queueHover('node', null), [queueHover]);
  const onEdgeEnter = useCallback<EdgeMouseHandler>((_e, edge) => queueHover('edge', edge.id), [queueHover]);
  const onEdgeLeave = useCallback<EdgeMouseHandler>(() => queueHover('edge', null), [queueHover]);
  const hoverFromBar = useCallback((id: string | null) => queueHover('node', id), [queueHover]);
  const miniMapStyle = useMemo(() => ({ background: COLORS.panel, border: `1px solid ${COLORS.nodeBorder}` }), [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = useCallback(
    (id: string) => {
      select(id);
      void fitView({ nodes: [{ id }], duration: reducedMotion() ? 0 : 520, padding: 0.8, maxZoom: 1.3 });
    },
    [select, fitView],
  );
  const toggle = useCallback(
    (k: StatusKey) =>
      setFilters((prev) => {
        const next = new Set(prev);
        if (!next.delete(k)) next.add(k);
        return next;
      }),
    [],
  );

  const miniMapColor = useCallback((n: Node) => {
    const p = (n.data as ModuleNodeData | undefined)?.payload;
    if (!p) return COLORS.edge;
    return p.cycle_id !== null ? COLORS.crimson : p.is_entry ? COLORS.gold : complexityColor(p.complexity);
  }, []);

  return (
    <div ref={rootRef} className={className} style={{ width: '100%', height: '100%', minHeight: 480, background: 'transparent', ...style }}>
      <ReactFlow<ModuleFlowNode, Edge>
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onNodeMouseEnter={onNodeEnter}
        onNodeMouseLeave={onNodeLeave}
        onEdgeMouseEnter={onEdgeEnter}
        onEdgeMouseLeave={onEdgeLeave}
        onMoveStart={nav.onMoveStart}
        onMove={nav.onMove}
        onMoveEnd={nav.onMoveEnd}
        nodesConnectable={false}
        elementsSelectable
        zoomOnScroll={false} // replaced by the eased handler in useCanvasNavigation
        zoomOnDoubleClick
        panOnDrag
        onlyRenderVisibleElements={!renderAll && graph.nodes.length > 400}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        colorMode={theme}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color={COLORS.grid} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={miniMapColor} maskColor={COLORS.mask} style={miniMapStyle} />
        <Panel position="top-left">
          <ActivityBar
            modules={graph.stats.modules}
            edges={graph.stats.edges}
            counts={counts}
            keys={keys}
            active={filters}
            onToggle={toggle}
            chips={chips}
            chipKind={kindOf}
            selectedId={selectedId ?? null}
            onHover={hoverFromBar}
            onPick={pick}
          />
        </Panel>
      </ReactFlow>
    </div>
  );
}

function DependencyAtlasRoot(props: DependencyAtlasProps) {
  return (
    <ReactFlowProvider>
      <AtlasInner {...props} />
    </ReactFlowProvider>
  );
}

/** Skips re-rendering the whole canvas when the parent re-renders with identical props. */
export default memo(DependencyAtlasRoot);
