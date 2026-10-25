import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import CanvasExportModal from './components/CanvasExportModal';
import GhostText from './components/GhostText';
import LanguageSelect from './components/LanguageSelect';
import Logo from './components/Logo';
import MagicBento from './components/MagicBento';
import SettingsDrawer from './components/SettingsDrawer';
import Splash from './components/Splash';
import Wallpaper from './components/Wallpaper';
import Workspace, { type ViewId } from './components/Workspace';
import { SettingsProvider, useSettings } from './context/SettingsContext';
import { analyzeRepository } from './api';
import { langMeta } from './lib/languages';
import type { GraphNodePayload, GraphPayload } from './types';

/* ------------------------------------------------------------------ data */

type Tab = 'home' | 'workspace' | 'dashboard' | 'recent';
interface Work {
  id: string;
  source: string;
  url: string | null;
  at: number;
  modules: number;
  cycles: number;
  loc: number;
}

const WORKS_KEY = 'astrograph.recent';
const INTRO_KEY = 'astrograph.intro';

const loadWorks = (): Work[] => {
  try {
    return JSON.parse(localStorage.getItem(WORKS_KEY) ?? '[]') as Work[];
  } catch {
    return [];
  }
};
const saveWorks = (w: Work[]) => {
  try {
    localStorage.setItem(WORKS_KEY, JSON.stringify(w));
  } catch {
    /* storage unavailable */
  }
};
const shouldPlayIntro = () => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  try {
    return !sessionStorage.getItem(INTRO_KEY);
  } catch {
    return true;
  }
};
const ago = (t: number) => {
  const d = Math.floor((Date.now() - t) / 864e5);
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`;
};

const QUOTES = [
  { t: 'The only way to do great work is to love what you do.', a: 'Steve Jobs' },
  { t: 'Simplicity is prerequisite for reliability.', a: 'Edsger W. Dijkstra' },
  { t: 'Make it work, make it right, make it fast.', a: 'Kent Beck' },
  { t: 'Programs must be written for people to read, and only incidentally for machines to execute.', a: 'Abelson & Sussman' },
  { t: 'We choose to go to the Moon … not because they are easy, but because they are hard.', a: 'John F. Kennedy' },
  { t: 'The cosmos is within us. We are made of star-stuff.', a: 'Carl Sagan' },
  { t: 'Perfection is achieved not when there is nothing more to add, but when there is nothing left to take away.', a: 'Antoine de Saint-Exupéry' },
  { t: 'Look up at the stars and not down at your feet.', a: 'Stephen Hawking' },
  { t: 'Talk is cheap. Show me the code.', a: 'Linus Torvalds' },
];
const quoteOfTheDay = () => {
  const d = new Date();
  return QUOTES[Math.floor((d.getTime() - d.getTimezoneOffset() * 6e4) / 864e5) % QUOTES.length];
};

/* ----------------------------------------------------------------- icons */

const PATHS = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  atlas: 'M12 5a2 2 0 100-4 2 2 0 000 4zM5 23a2 2 0 100-4 2 2 0 000 4zM19 23a2 2 0 100-4 2 2 0 000 4zM12 5v6M12 11l-6 8M12 11l6 8',
  grid: 'M3 3h8v8H3zM13 3h8v5h-8zM13 11h8v10h-8zM3 13h8v8H3z',
  clock: 'M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  search: 'M21 21l-4.3-4.3M17 11a6 6 0 11-12 0 6 6 0 0112 0z',
  clip: 'M21 11l-8.5 8.5a5 5 0 01-7-7L14 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L15 7',
  plus: 'M12 5v14M5 12h14',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  loop: 'M17 2l4 4-4 4M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 01-3 3H3',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  pulse: 'M3 12h4l3-8 4 16 3-8h4',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M16 12a4 4 0 11-8 0 4 4 0 018 0z',
  moon: 'M21 13A9 9 0 1111 3a7 7 0 0010 10z',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  sliders: 'M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
} as const;
type IconName = keyof typeof PATHS;

const Icon = ({ n }: { n: IconName }) => (
  <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
    <path d={PATHS[n]} />
  </svg>
);

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'workspace', label: 'Workspace', icon: 'atlas' },
  { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { id: 'recent', label: 'Recent works', icon: 'clock' },
];

const FEATURES: { t: string; d: string; i: IconName }[] = [
  { t: 'Map dependencies', d: 'Every import, as a graph', i: 'atlas' },
  { t: 'Catch circular imports', d: 'Cycles flagged in red', i: 'loop' },
  { t: 'Find entry points', d: 'Where the code starts', i: 'flag' },
  { t: 'Measure complexity', d: 'Hot spots per module', i: 'pulse' },
];

/* ------------------------------------------------------------------- app */

export default function App() {
  return (
    <SettingsProvider>
      <Shell />
    </SettingsProvider>
  );
}

function Shell() {
  const { settings, update, setDrawerOpen, dur, reducedMotion } = useSettings();
  const [intro, setIntro] = useState(shouldPlayIntro);
  const [tab, setTab] = useState<Tab>('home');
  const [view, setView] = useState<ViewId>('atlas');
  const [repoUrl, setRepoUrl] = useState('');
  const [archive, setArchive] = useState<File | null>(null);
  const [languages, setLanguages] = useState<string[]>([]);
  const [graph, setGraph] = useState<GraphPayload | null>(null);
  const [runId, setRunId] = useState(0);
  const [selected, setSelected] = useState<GraphNodePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [works, setWorks] = useState<Work[]>(loadWorks);
  const [q, setQ] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const quote = useMemo(quoteOfTheDay, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(INTRO_KEY, '1');
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!repoUrl.trim() && !archive) {
        setError('Enter a public GitHub URL or choose a .zip archive.');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const g = await analyzeRepository({ repoUrl: archive ? undefined : repoUrl, archive, languages });
        setGraph(g);
        setSelected(null);
        setRunId((n) => n + 1);
        setView('atlas');
        setTab('workspace');
        const w: Work = {
          id: String(Date.now()),
          source: g.repository?.source ?? archive?.name ?? repoUrl.trim(),
          url: archive ? null : repoUrl.trim(),
          at: Date.now(),
          modules: g.stats.modules,
          cycles: g.stats.cycles,
          loc: g.stats.loc,
        };
        const next = [w, ...works].slice(0, 30);
        setWorks(next);
        saveWorks(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Analysis failed.');
      } finally {
        setLoading(false);
      }
    },
    [repoUrl, archive, languages, works],
  );

  const startNew = () => {
    setTab('home');
    setTimeout(() => urlRef.current?.focus(), 0);
  };
  const reopen = (w: Work) => {
    if (w.url) {
      setRepoUrl(w.url);
      setArchive(null);
    }
    startNew();
  };
  const clearWorks = () => {
    setWorks([]);
    saveWorks([]);
  };
  const openView = (v: ViewId) => {
    setView(v);
    setTab('workspace');
  };
  const openNode = (id: string) => {
    if (!graph) return;
    setSelected(graph.nodes.find((n) => n.id === id) ?? null);
    openView('atlas');
  };

  const shown = works.filter((w) => w.source.toLowerCase().includes(q.trim().toLowerCase()));
  const trend = works.slice(0, 12).reverse().map((w) => w.modules);
  const detected = graph?.languages ? Object.entries(graph.languages) : [];

  const empty = (title: string, text: string): ReactNode => (
    <div className="empty glass">
      <GhostText as="h2" text={title} />
      <p>{text}</p>
      <button className="btn primary" onClick={startNew}>
        Map a repository
      </button>
    </div>
  );

  const page = (() => {
    switch (tab) {
      case 'home':
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
                    <input ref={fileRef} type="file" accept=".zip,application/zip" disabled={loading} onChange={(e) => setArchive(e.target.files?.[0] ?? null)} />
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

              <motion.div
                className="features"
                initial="hidden"
                animate="show"
                variants={{ hidden: {}, show: { transition: { staggerChildren: dur(0.06), delayChildren: dur(0.35) } } }}
              >
                {FEATURES.map((f) => (
                  <motion.button
                    key={f.t}
                    className="feature glass"
                    onClick={() => urlRef.current?.focus()}
                    variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: dur(0.4) } } }}
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
                <GhostText as="h3" text="Quote of the day" />
                <blockquote>“{quote.t}”</blockquote>
                <cite>{quote.a}</cite>
              </article>

              <article className="rail-card glass">
                <GhostText as="h3" text="Your activity" />
                <dl className="facts wide-facts">
                  <dt>Repositories mapped</dt>
                  <dd>{works.length}</dd>
                  <dt>Modules scanned</dt>
                  <dd>{works.reduce((s, w) => s + w.modules, 0).toLocaleString()}</dd>
                  <dt>Cycles found</dt>
                  <dd>{works.reduce((s, w) => s + w.cycles, 0)}</dd>
                </dl>
                <Spark values={trend} />
              </article>
            </div>
          </section>
        );

      case 'workspace':
        return graph ? (
          <Workspace
            key={runId}
            graph={graph}
            view={view}
            onViewChange={setView}
            selected={selected}
            onSelect={setSelected}
            onExport={() => setExportOpen(true)}
          />
        ) : (
          empty('No workspace yet', 'Map a repository and its atlas, tour and diagnostics appear here.')
        );

      case 'dashboard':
        return graph ? (
          <section className="dash">
            <div className="dash-head">
              <div>
                <GhostText as="h2" text="Dashboard" className="page-title" />
                <p className="muted">{graph.repository?.source ?? 'Latest repository'}</p>
              </div>
              <div className="dash-meta">
                {detected.map(([id, n]) => (
                  <span key={id} className="lang-pill">
                    {langMeta(id)?.label ?? id} · {n}
                  </span>
                ))}
              </div>
            </div>
            <MagicBento key={runId} graph={graph} onOpenView={openView} onOpenNode={openNode} />
          </section>
        ) : (
          empty('Nothing to show', 'Your dashboard fills in after your first analysis.')
        );

      case 'recent':
        return (
          <section className="dash">
            <GhostText as="h2" text="Recent works" className="page-title" />
            {shown.length === 0 && (
              <p className="muted">{works.length ? 'No works match your search.' : 'Repositories you map will be listed here.'}</p>
            )}
            <motion.div className="works" layout>
              <AnimatePresence initial={false}>
                {shown.map((w) => (
                  <motion.div
                    key={w.id}
                    layout
                    className="work glass"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    transition={{ duration: dur(0.28) }}
                  >
                    <div className="work-main">
                      <strong className="clip">{w.source}</strong>
                      <span className="muted">
                        {ago(w.at)} · {w.modules} modules · {w.loc.toLocaleString()} loc · {w.cycles} cycles
                      </span>
                    </div>
                    {w.url ? (
                      <button className="btn glass" onClick={() => reopen(w)}>
                        Map again
                      </button>
                    ) : (
                      <span className="muted">Zip upload</span>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
            {works.length > 0 && (
              <button className="btn glass fit" onClick={clearWorks}>
                Clear history
              </button>
            )}
          </section>
        );
    }
  })();

  return (
    <>
      <Wallpaper />
      {intro && <Splash onDone={() => setIntro(false)} />}

      <div className="shell">
        <aside className="side frame">
          <div className="brand">
            <Logo size={40} />
            <span className="wordmark">Astrograph</span>
          </div>

          <nav className="tabs" aria-label="Sections">
            {TABS.map((t) => (
              <motion.button
                key={t.id}
                className="tab glass"
                aria-current={tab === t.id ? 'page' : undefined}
                onClick={() => setTab(t.id)}
                whileTap={{ scale: 0.97 }}
              >
                {tab === t.id && (
                  <motion.span layoutId="nav-pill" className="tab-pill" transition={{ duration: dur(0.32), ease: [0.22, 1, 0.36, 1] }} />
                )}
                <Icon n={t.icon} />
                <span>{t.label}</span>
              </motion.button>
            ))}
          </nav>

          <div className="recent">
            <h3 className="side-h">Recent works</h3>
            {works.length === 0 && <p className="muted">Nothing mapped yet.</p>}
            {works.slice(0, 5).map((w) => (
              <button key={w.id} className="recent-item glass" onClick={() => reopen(w)}>
                <span className="clip">{w.source}</span>
                <span className="muted">{ago(w.at)}</span>
              </button>
            ))}
            {works.length > 0 && (
              <button className="btn glass wide" onClick={() => setTab('recent')}>
                View all works <Icon n="arrow" />
              </button>
            )}
          </div>
        </aside>

        <div className="main">
          <header className="topbar glass">
            <span className="mini-logo">
              <Logo size={30} label="Astrograph" />
            </span>
            <label className="search">
              <Icon n="search" />
              <input
                ref={searchRef}
                value={q}
                placeholder="Search recent works"
                aria-label="Search recent works"
                onChange={(e) => {
                  setQ(e.target.value);
                  if (e.target.value) setTab('recent');
                }}
              />
              <kbd className="kbd">Ctrl K</kbd>
            </label>
            <button
              className="btn glass icon-only"
              onClick={() => update({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
              aria-label={`Switch to ${settings.theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${settings.theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              <Icon n={settings.theme === 'dark' ? 'sun' : 'moon'} />
            </button>
            <button className="btn glass icon-only" onClick={() => setDrawerOpen(true)} aria-label="Customize" title="Customize">
              <Icon n="sliders" />
            </button>
            <button className="btn primary" onClick={startNew}>
              <Icon n="plus" /> New analysis
            </button>
          </header>

          <AnimatePresence>
            {error && (
              <motion.div
                className="alert glass"
                role="alert"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: dur(0.25) }}
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          <main className="page">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={tab}
                className="page-motion"
                initial={{ opacity: 0, y: reducedMotion ? 0 : 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reducedMotion ? 0 : -8 }}
                transition={{ duration: dur(0.26), ease: [0.22, 1, 0.36, 1] }}
              >
                {page}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>

      <SettingsDrawer />
      <CanvasExportModal open={exportOpen} onClose={() => setExportOpen(false)} source={graph?.repository?.source ?? 'astrograph'} />
    </>
  );
}

/* ------------------------------------------------------------ sub-parts */

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
