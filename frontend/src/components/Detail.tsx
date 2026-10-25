import type { GraphNodePayload, GraphPayload } from '../types';
import { langMeta, langTag } from '../lib/languages';

export function LangTag({ id }: { id: string | undefined }) {
  return <span className="lang-tag">{langTag(id)}</span>;
}

export function Overview({ graph }: { graph: GraphPayload }) {
  return (
    <>
      <h2>{graph.repository?.source ?? 'Repository'}</h2>
      <p className="muted">Select a module in the atlas to see its declarations, functions, and neighbours.</p>

      <h3>Entry points</h3>
      {graph.entry_points.length === 0 && <p className="muted">None detected.</p>}
      <ul className="list">
        {graph.entry_points.map((e) => (
          <li key={e.id}>
            <code>{e.id}</code>
            <span className="muted">{e.reasons.join('; ')}</span>
          </li>
        ))}
      </ul>

      <h3>Circular dependencies</h3>
      {graph.cycles.length === 0 && <p className="muted">No import-time cycles found.</p>}
      <ul className="list">
        {graph.cycles.map((c) => (
          <li key={c.id}>
            <code className="cycle">{c.path.join(' → ')}</code>
            <span className="muted">{c.members.length} modules in cluster</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function NodeDetail({ node }: { node: GraphNodePayload }) {
  const meta = langMeta(node.language);
  const isSql = node.language === 'sql';
  return (
    <>
      <h2>
        {node.label} <LangTag id={node.language} />
      </h2>
      <p className="muted">
        <code>{node.path}</code>
      </p>
      <dl className="facts">
        <dt>Lines</dt>
        <dd>{node.loc}</dd>
        <dt>Complexity</dt>
        <dd>{node.complexity}</dd>
        <dt>{isSql ? 'Referenced by' : 'Imported by'}</dt>
        <dd>{node.in_degree}</dd>
        <dt>{isSql ? 'References' : 'Imports'}</dt>
        <dd>{node.out_degree}</dd>
      </dl>
      {node.parse_error && <p className="error-inline">{node.parse_error}</p>}

      {node.classes.length > 0 && (
        <>
          <h3>{meta?.declares ?? 'Classes'}</h3>
          <ul className="list">
            {node.classes.map((c) => (
              <li key={`${c.name}:${c.lineno}`}>
                <code>{c.name}</code>
                <span className="muted">
                  line {c.lineno}
                  {c.kind && c.kind !== 'class' ? ` · ${c.kind}` : ''}
                  {!isSql ? ` · ${c.methods} methods` : ''}
                  {c.bases.length ? ` · extends ${c.bases.join(', ')}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {node.functions.length > 0 && (
        <>
          <h3>{isSql ? 'Functions & procedures' : 'Most complex functions'}</h3>
          <ul className="list">
            {node.functions.slice(0, 15).map((f) => (
              <li key={`${f.name}:${f.lineno}`}>
                <code>{f.name}</code>
                <span className="muted">
                  line {f.lineno} · complexity {f.complexity}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {node.external_deps.length > 0 && (
        <>
          <h3>External dependencies</h3>
          <p>
            {node.external_deps.map((d) => (
              <code key={d} className="chip">
                {d}
              </code>
            ))}
          </p>
        </>
      )}
    </>
  );
}
