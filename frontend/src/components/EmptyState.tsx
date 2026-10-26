import { memo } from 'react';
import GhostText from './GhostText';

export default memo(function EmptyState({ title, text, onStart }: { title: string; text: string; onStart: () => void }) {
  return (
    <div className="empty glass">
      <GhostText as="h2" text={title} />
      <p>{text}</p>
      <button className="btn primary" onClick={onStart}>
        Map a repository
      </button>
    </div>
  );
});
