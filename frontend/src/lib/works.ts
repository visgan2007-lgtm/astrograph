export interface Work {
  id: string;
  source: string;
  url: string | null;
  at: number;
  modules: number;
  cycles: number;
  loc: number;
}

const KEY = 'astrograph.recent';

export const loadWorks = (): Work[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Work[];
  } catch {
    return [];
  }
};

export const saveWorks = (works: Work[]): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(works));
  } catch {
    /* storage unavailable */
  }
};

export const ago = (t: number): string => {
  const d = Math.floor((Date.now() - t) / 864e5);
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`;
};
