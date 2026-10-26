import { memo } from 'react';

export const PATHS = {
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
  sliders: 'M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
} as const;

export type IconName = keyof typeof PATHS;

export const Icon = memo(function Icon({ n }: { n: IconName }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[n]} />
    </svg>
  );
});
