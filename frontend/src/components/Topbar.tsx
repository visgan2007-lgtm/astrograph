import { memo, useEffect, useRef } from 'react';
import { useSettings } from '../context/SettingsContext';
import { openDrawer } from '../lib/drawerStore';
import { Icon } from './Icon';
import Logo from './Logo';

interface Props {
  query: string;
  onQuery: (value: string) => void;
  onNew: () => void;
}

/** Search, theme toggle, customise and "New analysis". Owns its own Ctrl/Cmd+K shortcut. */
export default memo(function Topbar({ query, onQuery, onNew }: Props) {
  const { settings, update } = useSettings();
  const searchRef = useRef<HTMLInputElement>(null);
  const next = settings.theme === 'dark' ? 'light' : 'dark';

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

  return (
    <header className="topbar glass">
      <span className="mini-logo">
        <Logo size={30} label="Astrograph" />
      </span>
      <label className="search">
        <Icon n="search" />
        <input
          ref={searchRef}
          value={query}
          placeholder="Search recent works"
          aria-label="Search recent works"
          onChange={(e) => onQuery(e.target.value)}
        />
        <kbd className="kbd">Ctrl K</kbd>
      </label>
      <button className="btn glass icon-only" onClick={() => update({ theme: next })} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
        <Icon n={settings.theme === 'dark' ? 'sun' : 'moon'} />
      </button>
      <button className="btn glass icon-only" onClick={openDrawer} aria-label="Customize" title="Customize">
        <Icon n="sliders" />
      </button>
      <button className="btn primary" onClick={onNew}>
        <Icon n="plus" /> New analysis
      </button>
    </header>
  );
});
