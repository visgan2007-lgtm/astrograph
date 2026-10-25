/** Lets the export modal reach the mounted dependency atlas without prop drilling through the app. */
export interface AtlasExportApi {
  /** root element that contains `.react-flow` */
  element: HTMLElement;
  /** bounding box of every node in graph coordinates, or null for an empty graph */
  getBounds: () => { x: number; y: number; width: number; height: number } | null;
  /** turns off virtualisation so off-screen nodes exist in the DOM; resolves to a restore function */
  renderAll: () => Promise<() => void>;
}

let current: AtlasExportApi | null = null;

export function registerAtlasExport(api: AtlasExportApi): () => void {
  current = api;
  return () => {
    if (current === api) current = null; // a newer atlas may already have taken over
  };
}

export const getAtlasExport = (): AtlasExportApi | null => current;
