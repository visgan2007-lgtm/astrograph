import { useEffect, useMemo, useState, memo } from 'react';
import { fetchDiff, listSnapshots } from '../api';
import type { DiffResult, SnapshotMeta } from '../types';

interface Props {
  /** Snapshot of the analysis currently on screen. */
  current: SnapshotMeta | undefined;
  /** Receives the diff so the atlas can colour added/removed items; null clears it. */
  onOverlay: (diff: DiffResult | null) => void;
  overlayActive: boolean;
}

const label = (s: SnapshotMeta) => `#${s.id} · ${s.created_at.slice(0, 16).replace('T', ' ')} · ${s.content_hash.slice(0, 8)}`;

/** Pick two stored snapshots and see which dependencies were added (green) or removed (red). */
export default memo(function SnapshotCompare({ current, onOverlay, overlayActive }: Props) {
  const [snaps, setSnaps] = useState<SnapshotMeta[]>([]);
  const [base, setBase] = useState('');
  const [head, setHead] = useState('');
  const [result, setResult] = useState<DiffResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!current) return;
    let live = true;
    listSnapshots(current.source)
      .then((list) => {
        if (!live) return;
        setSnaps(list);
        setHead(String(current.id));
        const older = list.find((s) => s.id < current.id);
        setBase(older ? String(older.id) : '');
        setResult(null);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [current]);

  const compare = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await fetchDiff(base, head);
      setResult(d);
      onOverlay(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Comparison failed.');
    } finally {
      setBusy(false);
    }
  };

  const grouped = useMemo(
    () => ({
      removed: result?.changed_edges.filter((e) => e.status === 'removed') ?? [],
      added: result?.changed_edges.filter((e) => e.status === 'added') ?? [],
    }),
    [result],
  );

  if (!current) return <p className="muted">Snapshots are stored by the backend after each analysis.</p>;

  const options = snaps.map((s) => (
    <option key={s.id} value={s.id}>
      {label(s)}
    </option>
  ));

  return (
    <div className="compare">
      <p className="muted">
        Compare two stored revisions of <code>{current.source}</code>. Analyse the repo again later to build history.
      </p>
      <label className="field">
        <span className="muted">Base (older)</span>
        <select value={base} onChange={(e) => setBase(e.target.value)}>
          <option value="">Select revision</option>
          {options}
        </select>
      </label>
      <label className="field">
        <span className="muted">Head (newer)</span>
        <select value={head} onChange={(e) => setHead(e.target.value)}>
          {options}
        </select>
      </label>
      <button className="btn primary wide" disabled={busy || !base || !head || base === head} onClick={compare}>
        {busy ? 'Comparing…' : 'Compare revisions'}
      </button>
      {error && <p className="error-inline">{error}</p>}

      {result && (
        <>
          <div className="diff-tiles">
            {(['added', 'removed', 'unchanged'] as const).map((k) => (
              <div key={k} className={`diff-tile ${k}`}>
                <strong>{result.summary.edges[k]}</strong>
                <span>{k} edges</span>
                <span className="muted">{result.summary.nodes[k]} modules</span>
              </div>
            ))}
          </div>

          <div className="diff-cols">
            <section>
              <h4 className="removed">Removed ({grouped.removed.length})</h4>
              {grouped.removed.length === 0 && <p className="muted">None</p>}
              <ul className="diff-list removed">
                {grouped.removed.map((e) => (
                  <li key={e.id}>
                    <code>{e.source}</code>
                    <code>→ {e.target}</code>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h4 className="added">Added ({grouped.added.length})</h4>
              {grouped.added.length === 0 && <p className="muted">None</p>}
              <ul className="diff-list added">
                {grouped.added.map((e) => (
                  <li key={e.id}>
                    <code>{e.source}</code>
                    <code>→ {e.target}</code>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <button className="btn glass wide" onClick={() => onOverlay(overlayActive ? null : result)}>
            {overlayActive ? 'Hide diff on atlas' : 'Show diff on atlas'}
          </button>
        </>
      )}
    </div>
  );
});
