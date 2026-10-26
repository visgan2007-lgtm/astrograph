import { memo } from 'react';
import { motion } from 'framer-motion';
import { useSettings } from '../context/SettingsContext';
import { ago, type Work } from '../lib/works';
import { Icon, type IconName } from './Icon';
import Logo from './Logo';

export type Tab = 'home' | 'workspace' | 'dashboard' | 'recent';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'workspace', label: 'Workspace', icon: 'atlas' },
  { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { id: 'recent', label: 'Recent works', icon: 'clock' },
];

interface Props {
  tab: Tab;
  works: Work[];
  onTab: (tab: Tab) => void;
  onReopen: (work: Work) => void;
}

/** Brand, section tabs and the five most recent works. Re-renders only when the tab or the works list changes. */
export default memo(function Sidebar({ tab, works, onTab, onReopen }: Props) {
  const { dur } = useSettings();
  return (
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
            onClick={() => onTab(t.id)}
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
          <button key={w.id} className="recent-item glass" onClick={() => onReopen(w)}>
            <span className="clip">{w.source}</span>
            <span className="muted">{ago(w.at)}</span>
          </button>
        ))}
        {works.length > 0 && (
          <button className="btn glass wide" onClick={() => onTab('recent')}>
            View all works <Icon n="arrow" />
          </button>
        )}
      </div>
    </aside>
  );
});
