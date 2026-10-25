import { AnimatePresence, motion, type PanInfo } from 'framer-motion';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useSettings } from '../context/SettingsContext';

export interface SwipeView {
  id: string;
  label: string;
  content: ReactNode;
  /** allow dragging the content sideways to change view (off for canvases, which pan on drag) */
  swipe?: boolean;
}

interface Props {
  views: SwipeView[];
  active: string;
  onChange: (id: string) => void;
  /** extra controls on the right of the tab bar */
  actions?: ReactNode;
}

const THRESHOLD = 70;

/** Tabbed view container: direction-aware slide + cross-fade, swipeable on the tab bar (and on views that allow it). */
export default function ViewSwiper({ views, active, onChange, actions }: Props) {
  const { dur, reducedMotion } = useSettings();
  const index = Math.max(0, views.findIndex((v) => v.id === active));
  const prev = useRef(index);
  const dir = index >= prev.current ? 1 : -1;
  prev.current = index;
  const current = views[index];

  const go = (delta: number) => {
    const next = views[index + delta];
    if (next) onChange(next.id);
  };
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (Math.abs(info.offset.x) > THRESHOLD || Math.abs(info.velocity.x) > 500) go(info.offset.x < 0 ? 1 : -1);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else return;
    e.preventDefault();
  };

  const slide = reducedMotion ? 0 : 56;
  const variants = {
    enter: (d: number) => ({ x: d * slide, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (d: number) => ({ x: -d * slide, opacity: 0 }),
  };

  return (
    <div className="swiper">
      <div className="swiper-bar">
        <motion.div
          className="swiper-tabs glass"
          role="tablist"
          aria-label="Workspace views"
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.12}
          onDragEnd={onDragEnd}
          onKeyDown={onKey}
        >
          {views.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={v.id === active}
              tabIndex={v.id === active ? 0 : -1}
              className="swiper-tab"
              onClick={() => onChange(v.id)}
            >
              {v.id === active && (
                <motion.span layoutId="swiper-pill" className="swiper-pill" transition={{ duration: dur(0.3), ease: [0.22, 1, 0.36, 1] }} />
              )}
              <span>{v.label}</span>
            </button>
          ))}
        </motion.div>
        <div className="swiper-actions">{actions}</div>
      </div>

      <div className="swiper-stage">
        <AnimatePresence mode="popLayout" custom={dir} initial={false}>
          <motion.div
            key={current.id}
            className="swiper-panel"
            role="tabpanel"
            custom={dir}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: dur(0.34), ease: [0.22, 1, 0.36, 1] }}
            drag={current.swipe ? 'x' : false}
            dragDirectionLock
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.14}
            onDragEnd={current.swipe ? onDragEnd : undefined}
          >
            {current.content}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
