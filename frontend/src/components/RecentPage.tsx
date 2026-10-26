import { memo, useDeferredValue, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSettings } from '../context/SettingsContext';
import { ago, type Work } from '../lib/works';
import GhostText from './GhostText';

interface Props {
  works: Work[];
  query: string;
  onReopen: (work: Work) => void;
  onClear: () => void;
}

export default memo(function RecentPage({ works, query, onReopen, onClear }: Props) {
  const { dur } = useSettings();
  const deferred = useDeferredValue(query); // typing in the search box never blocks on re-filtering
  const shown = useMemo(() => {
    const q = deferred.trim().toLowerCase();
    return q ? works.filter((w) => w.source.toLowerCase().includes(q)) : works;
  }, [works, deferred]);

  return (
    <section className="dash">
      <GhostText as="h2" text="Recent works" className="page-title" />
      {shown.length === 0 && <p className="muted">{works.length ? 'No works match your search.' : 'Repositories you map will be listed here.'}</p>}
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
                <button className="btn glass" onClick={() => onReopen(w)}>
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
        <button className="btn glass fit" onClick={onClear}>
          Clear history
        </button>
      )}
    </section>
  );
});
