export interface GraphNodePayload {
  id: string;
  label: string;
  path: string;
  loc: number;
  complexity: number;
  in_degree: number;
  out_degree: number;
  is_entry: boolean;
  entry_score: number | null;
  cycle_id: number | null;
  has_main_guard: boolean;
  parse_error: string | null;
  language: string;
  classes: { name: string; lineno: number; bases: string[]; methods: number; kind?: string }[];
  functions: { name: string; lineno: number; complexity: number }[];
  external_deps: string[];
}

export interface GraphEdgePayload {
  id: string;
  source: string;
  target: string;
  runtime: boolean;
  weight: number;
  calls: number;
  in_cycle: boolean;
}

export interface GraphPayload {
  nodes: GraphNodePayload[];
  edges: GraphEdgePayload[];
  cycles: { id: number; members: string[]; path: string[] }[];
  entry_points: { id: string; score: number; reasons: string[] }[];
  stats: {
    modules: number;
    edges: number;
    cycles: number;
    loc: number;
    parse_errors: number;
    avg_complexity: number;
  };
  repository?: { source: string; files_extracted: number };
  /** module count per language id */
  languages?: Record<string, number>;
  language_mode?: 'auto' | string[];
  detected_languages?: Record<string, number>;
  tour?: TourStep[];
  snapshot?: SnapshotMeta;
}

export interface TourStep {
  rank: number;
  id: string;
  label: string;
  stage: 'Orient' | 'Foundations' | 'Core logic';
  score: number;
  metrics: { centrality: number; fan_in: number; fan_out: number; depth: number; loc: number; complexity: number };
  why: string;
  /** import chain from an entry point to this module */
  route: string[];
}

export interface SnapshotMeta {
  id: number;
  content_hash: string;
  source: string;
  created_at: string;
  stats?: GraphPayload['stats'];
  deduped?: boolean;
}

export type DiffStatus = 'added' | 'removed' | 'unchanged';
type Tally = Record<DiffStatus, number>;

export interface DiffResult {
  base: SnapshotMeta;
  head: SnapshotMeta;
  summary: { nodes: Tally; edges: Tally };
  node_status: Record<string, DiffStatus>;
  edge_status: Record<string, DiffStatus>;
  deltas: Record<string, { loc: number; complexity: number }>;
  changed_edges: { id: string; source: string; target: string; status: DiffStatus }[];
  /** head graph plus the nodes/edges that only existed in base */
  graph: GraphPayload;
}
