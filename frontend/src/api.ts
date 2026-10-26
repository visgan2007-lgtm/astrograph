import type { DiffResult, GraphPayload, SnapshotMeta } from './types';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export async function analyzeRepository(input: {
  repoUrl?: string;
  archive?: File | null;
  /** language ids; empty / undefined = auto-detect */
  languages?: string[];
}): Promise<GraphPayload> {
  const body = new FormData();
  if (input.archive) body.append('archive', input.archive);
  else if (input.repoUrl) body.append('repo_url', input.repoUrl.trim());
  body.append('languages', input.languages?.length ? input.languages.join(',') : 'auto');

  const res = await fetch(`${API_BASE}/api/analyze`, { method: 'POST', body });
  if (!res.ok) {
    let detail = `Request failed (HTTP ${res.status}).`;
    try {
      const j = await res.json();
      if (typeof j.detail === 'string') detail = j.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  return (await res.json()) as GraphPayload;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    let detail = `Request failed (HTTP ${res.status}).`;
    try {
      const j = await res.json();
      if (typeof j.detail === 'string') detail = j.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export const listSnapshots = (source?: string) =>
  getJson<SnapshotMeta[]>(`/api/snapshots${source ? `?source=${encodeURIComponent(source)}` : ''}`);

export const fetchDiff = (base: number | string, head: number | string) =>
  getJson<DiffResult>(`/api/diff?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`);
