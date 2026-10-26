import { AnimatePresence, motion } from 'framer-motion';
import { memo, useCallback, useEffect, useState } from 'react';
import CanvasExportModal from './components/CanvasExportModal';
import DashboardPage from './components/DashboardPage';
import EmptyState from './components/EmptyState';
import HomePage, { type AnalyzeInput } from './components/HomePage';
import RecentPage from './components/RecentPage';
import SettingsDrawer from './components/SettingsDrawer';
import Sidebar, { type Tab } from './components/Sidebar';
import Splash from './components/Splash';
import Topbar from './components/Topbar';
import Wallpaper from './components/Wallpaper';
import Workspace, { type ViewId } from './components/Workspace';
import { SettingsProvider, useSettings } from './context/SettingsContext';
import { analyzeRepository } from './api';
import { loadWorks, saveWorks, type Work } from './lib/works';
import type { GraphNodePayload, GraphPayload } from './types';

const INTRO_KEY = 'astrograph.intro';

const shouldPlayIntro = () => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  try {
    return !sessionStorage.getItem(INTRO_KEY);
  } catch {
    return true;
  }
};

/** The backdrop never changes after mount, so it is rendered exactly once. */
const StaticWallpaper = memo(Wallpaper);

export default function App() {
  return (
    <SettingsProvider>
      <Shell />
    </SettingsProvider>
  );
}

/**
 * Shell: owns only what several pages share (current tab, the analysed graph, recent works).
 * Everything below is memoized with stable callbacks, so a state change here re-renders just the
 * parts that actually depend on it.
 */
function Shell() {
  const { dur, reducedMotion } = useSettings();
  const [intro, setIntro] = useState(shouldPlayIntro);
  const [tab, setTab] = useState<Tab>('home');
  const [view, setView] = useState<ViewId>('atlas');
  const [graph, setGraph] = useState<GraphPayload | null>(null);
  const [runId, setRunId] = useState(0);
  const [selected, setSelected] = useState<GraphNodePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [works, setWorks] = useState<Work[]>(loadWorks);
  const [query, setQuery] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ url: string | null; n: number }>({ url: null, n: 0 });
  const [focusNonce, setFocusNonce] = useState(0);

  useEffect(() => {
    try {
      sessionStorage.setItem(INTRO_KEY, '1');
    } catch {
      /* private mode */
    }
  }, []);
  useEffect(() => saveWorks(works), [works]);

  const endIntro = useCallback(() => setIntro(false), []);
  const startNew = useCallback(() => {
    setTab('home');
    setFocusNonce((n) => n + 1);
  }, []);
  const reopen = useCallback((w: Work) => {
    if (w.url) setPrefill((p) => ({ url: w.url, n: p.n + 1 }));
    setTab('home');
    setFocusNonce((n) => n + 1);
  }, []);
  const clearWorks = useCallback(() => setWorks([]), []);
  const onQuery = useCallback((value: string) => {
    setQuery(value);
    if (value) setTab('recent');
  }, []);
  const openView = useCallback((v: ViewId) => {
    setView(v);
    setTab('workspace');
  }, []);
  const openNode = useCallback(
    (id: string) => {
      setSelected(graph?.nodes.find((n) => n.id === id) ?? null);
      openView('atlas');
    },
    [graph, openView],
  );
  const openExport = useCallback(() => setExportOpen(true), []);
  const closeExport = useCallback(() => setExportOpen(false), []);

  const submit = useCallback(async (input: AnalyzeInput) => {
    if (!input.repoUrl?.trim() && !input.archive) {
      setError('Enter a public GitHub URL or choose a .zip archive.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const g = await analyzeRepository(input);
      setGraph(g);
      setSelected(null);
      setRunId((n) => n + 1);
      setView('atlas');
      setTab('workspace');
      const work: Work = {
        id: String(Date.now()),
        source: g.repository?.source ?? input.archive?.name ?? input.repoUrl?.trim() ?? 'repository',
        url: input.archive ? null : (input.repoUrl?.trim() ?? null),
        at: Date.now(),
        modules: g.stats.modules,
        cycles: g.stats.cycles,
        loc: g.stats.loc,
      };
      setWorks((prev) => [work, ...prev].slice(0, 30));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed.');
    } finally {
      setLoading(false);
    }
  }, []);

  let page;
  switch (tab) {
    case 'home':
      page = <HomePage loading={loading} works={works} prefill={prefill} focusNonce={focusNonce} onSubmit={submit} />;
      break;
    case 'workspace':
      page = graph ? (
        <Workspace key={runId} graph={graph} view={view} onViewChange={setView} selected={selected} onSelect={setSelected} onExport={openExport} />
      ) : (
        <EmptyState title="No workspace yet" text="Map a repository and its atlas, tour and diagnostics appear here." onStart={startNew} />
      );
      break;
    case 'dashboard':
      page = graph ? (
        <DashboardPage graph={graph} runId={runId} onOpenView={openView} onOpenNode={openNode} />
      ) : (
        <EmptyState title="Nothing to show" text="Your dashboard fills in after your first analysis." onStart={startNew} />
      );
      break;
    case 'recent':
      page = <RecentPage works={works} query={query} onReopen={reopen} onClear={clearWorks} />;
      break;
  }

  return (
    <>
      <StaticWallpaper />
      {intro && <Splash onDone={endIntro} />}

      <div className="shell">
        <Sidebar tab={tab} works={works} onTab={setTab} onReopen={reopen} />

        <div className="main">
          <Topbar query={query} onQuery={onQuery} onNew={startNew} />

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
            {/* Enter-only animation. An exit + AnimatePresence mode="wait" here could hang when the outgoing
                page (e.g. Workspace on a non-atlas view) had nested animated children, leaving the page blank. */}
            <motion.div
              key={tab}
              className="page-motion"
              initial={{ opacity: 0, y: reducedMotion ? 0 : 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: dur(0.26), ease: [0.22, 1, 0.36, 1] }}
            >
              {page}
            </motion.div>
          </main>
        </div>
      </div>

      <SettingsDrawer />
      <CanvasExportModal open={exportOpen} onClose={closeExport} source={graph?.repository?.source ?? 'astrograph'} />
    </>
  );
}
