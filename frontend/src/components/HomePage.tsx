import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { useSettings } from '../context/SettingsContext';
import type { analyzeRepository } from '../api';
import type { Work } from '../lib/works';
import GhostText from './GhostText';
import { Icon, type IconName } from './Icon';
import LanguageSelect from './LanguageSelect';

export type AnalyzeInput = Parameters<typeof analyzeRepository>[0];

const FEATURES: { t: string; d: string; i: IconName }[] = [
  { t: 'Map dependencies', d: 'Every import, as a graph', i: 'atlas' },
  { t: 'Catch circular imports', d: 'Cycles flagged in red', i: 'loop' },
  { t: 'Find entry points', d: 'Where the code starts', i: 'flag' },
  { t: 'Measure complexity', d: 'Hot spots per module', i: 'pulse' },
];

const featuresVariants = (dur: (s: number) => number) => ({
  list: { hidden: {}, show: { transition: { staggerChildren: dur(0.06), delayChildren: dur(0.35) } } },
  item: { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: dur(0.4) } } },
});

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <p className="muted">Map two repositories to see your trend.</p>;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 120},${34 - (v / max) * 30}`).join(' ');
  return (
    <svg className="spark" viewBox="0 0 120 36" preserveAspectRatio="none" aria-label="Modules per analysis">
      <motion.polyline points={pts} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9 }} />
    </svg>
  );
}

/** Form draft kept outside the component so it survives switching tabs (the page unmounts on navigation). */
const draft = { url: '', archive: null as File | null, languages: [] as string[], prefillSeen: 0, focusSeen: 0 };

interface Props {
  loading: boolean;
  works: Work[];
  /** set by the app to pre-fill the URL box (Recent works -> "Map again") */
  prefill: { url: string | null; n: number };
  /** bump to focus the URL box */
  focusNonce: number;
  onSubmit: (input: AnalyzeInput) => void;
}

/**
 * The form state lives here, not in the app shell, so typing a URL re-renders only this page.
 */
export default memo(function HomePage({ loading, works, prefill, focusNonce, onSubmit }: Props) {
  const { dur, reducedMotion } = useSettings();
  const [repoUrl, setRepoUrlState] = useState(draft.url);
  const [archive, setArchiveState] = useState<File | null>(draft.archive);
  const [languages, setLanguagesState] = useState<string[]>(draft.languages);
  const urlRef = useRef<HTMLInputElement>(null);

  const setRepoUrl = useCallback((v: string) => {
    draft.url = v;
    setRepoUrlState(v);
  }, []);
  const setArchive = useCallback((f: File | null) => {
    draft.archive = f;
    setArchiveState(f);
  }, []);
  const setLanguages = useCallback((l: string[]) => {
    draft.languages = l;
    setLanguagesState(l);
  }, []);

  useEffect(() => {
    if (prefill.n > draft.prefillSeen && prefill.url) {
      draft.prefillSeen = prefill.n;
      setRepoUrl(prefill.url);
      setArchive(null);
    }
  }, [prefill, setRepoUrl, setArchive]);
  useEffect(() => {
    if (focusNonce > draft.focusSeen) {
      draft.focusSeen = focusNonce;
      urlRef.current?.focus();
    }
  }, [focusNonce]);

  const submit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      onSubmit({ repoUrl: archive ? undefined : repoUrl, archive, languages });
    },
    [onSubmit, repoUrl, archive, languages],
  );
  const focusUrl = useCallback(() => urlRef.current?.focus(), []);

  const v = useMemo(() => featuresVariants(dur), [dur]);
  const totals = useMemo(
    () => ({
      modules: works.reduce((s, w) => s + w.modules, 0),
      cycles: works.reduce((s, w) => s + w.cycles, 0),
      trend: works.slice(0, 12).reverse().map((w) => w.modules),
    }),
    [works],
  );

  return (
    <section className="home">
      <div className="home-main">
        <div className="hero">
          <GhostText as="h1" text="What shall we map today?" />
          <p>Drop in a public GitHub repo or a .zip. Astrograph reads Python, JavaScript, TypeScript, Java, C, C++, C# and SQL.</p>
        </div>

        <form className="prompt glass" onSubmit={submit}>
          <input
            ref={urlRef}
            type="url"
            placeholder="https://github.com/owner/repo"
            value={repoUrl}
            disabled={loading || !!archive}
            onChange={(e) => setRepoUrl(e.target.value)}
            aria-label="GitHub repository URL"
          />
          <LanguageSelect value={languages} onChange={setLanguages} disabled={loading} />
          <div className="prompt-row">
            <label className="file-btn glass" title="Choose a .zip archive">
              <Icon n="clip" />
              <span className="clip">{archive ? archive.name : 'Attach .zip'}</span>
              <input type="file" accept=".zip,application/zip" disabled={loading} onChange={(e) => setArchive(e.target.files?.[0] ?? null)} />
            </label>
            {archive && (
              <button type="button" className="btn glass" onClick={() => setArchive(null)}>
                Clear
              </button>
            )}
            <motion.button type="submit" className="btn primary push" disabled={loading} whileTap={{ scale: 0.96 }} whileHover={{ y: -1 }}>
              {loading ? 'Mapping…' : 'Map repository'}
            </motion.button>
          </div>
        </form>

        <motion.div className="features" initial="hidden" animate="show" variants={v.list}>
          {FEATURES.map((f) => (
            <motion.button
              key={f.t}
              className="feature glass"
              onClick={focusUrl}
              variants={v.item}
              whileHover={reducedMotion ? undefined : { y: -3 }}
              whileTap={{ scale: 0.98 }}
            >
              <strong>{f.t}</strong>
              <span className="muted">{f.d}</span>
              <Icon n={f.i} />
            </motion.button>
          ))}
        </motion.div>
      </div>

      <div className="rail">
        <article className="rail-card glass">
          <GhostText as="h3" text="Your activity" />
          <dl className="facts wide-facts">
            <dt>Repositories mapped</dt>
            <dd>{works.length}</dd>
            <dt>Modules scanned</dt>
            <dd>{totals.modules.toLocaleString()}</dd>
            <dt>Cycles found</dt>
            <dd>{totals.cycles}</dd>
          </dl>
          <Spark values={totals.trend} />
        </article>
      </div>
    </section>
  );
});
