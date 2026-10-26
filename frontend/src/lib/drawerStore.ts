import { useSyncExternalStore } from 'react';

/**
 * Open/closed state of the settings drawer lives outside React context on purpose:
 * toggling it re-renders only the drawer, not every component that reads the settings.
 */
let open = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const openDrawer = (): void => {
  if (!open) {
    open = true;
    emit();
  }
};
export const closeDrawer = (): void => {
  if (open) {
    open = false;
    emit();
  }
};

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export const useDrawerOpen = (): boolean =>
  useSyncExternalStore(subscribe, () => open, () => false);
