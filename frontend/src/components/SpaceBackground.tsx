import { memo } from 'react';

/** Flowing coordinate lines and a drifting perspective grid. Pure SVG/CSS, so it stays sharp at any resolution. */
const PATHS = [
  'M-120 640 C 260 520, 560 790, 940 620 S 1480 430, 1740 540',
  'M-120 700 C 300 600, 620 840, 1000 690 S 1500 520, 1740 610',
  'M-120 560 C 240 440, 640 720, 980 540 S 1460 340, 1740 450',
  'M-120 480 C 320 400, 600 620, 1040 470 S 1500 260, 1740 360',
  'M-120 760 C 280 700, 700 860, 1060 760 S 1520 610, 1740 690',
];
const COLORS = ['accent', 'pink', 'cyan', 'accent', 'violet'] as const;

export default memo(function SpaceBackground() {
  return (
    <div className="space-bg" aria-hidden="true">
      <div className="grid-flow" />
      <svg className="flow-svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" focusable="false">
        {PATHS.map((d, i) => (
          <g key={d} className={`flow flow-${COLORS[i]}`}>
            <path d={d} className="flow-base" pathLength={1000} />
            <path d={d} className="flow-line" pathLength={1000} style={{ animationDuration: `${16 + i * 3.5}s`, animationDelay: `${-i * 2.7}s` }} />
          </g>
        ))}
      </svg>
    </div>
  );
});
