/** Client-side Data Saver preference (Privacy tab). */

export const DATA_SAVER_STORAGE_KEY = 'dataSaverMode';
export const DATA_SAVER_CHANGED_EVENT = 'dataSaverChanged';

export function isDataSaverEnabled(): boolean {
  if (typeof window === 'undefined') return false;

  const saved = localStorage.getItem(DATA_SAVER_STORAGE_KEY);
  if (saved !== null) {
    return saved === 'true';
  }

  if ('connection' in navigator) {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    return (
      connection?.saveData === true ||
      connection?.effectiveType === 'slow-2g' ||
      connection?.effectiveType === '2g'
    );
  }

  return false;
}

export function setDataSaverEnabled(enabled: boolean): void {
  localStorage.setItem(DATA_SAVER_STORAGE_KEY, String(enabled));
  applyDataSaverDomFlag();
  window.dispatchEvent(new CustomEvent(DATA_SAVER_CHANGED_EVENT, { detail: enabled }));
}

/** Sync `<html data-data-saver>` for CSS + runtime checks. */
export function applyDataSaverDomFlag(): void {
  if (typeof document === 'undefined') return;
  const enabled = isDataSaverEnabled();
  if (enabled) {
    document.documentElement.dataset.dataSaver = 'on';
  } else {
    delete document.documentElement.dataset.dataSaver;
  }
}

/** Cap explicit quality/dimensions when data saver is on. */
export function applyDataSaverImageCaps(options: {
  width?: number;
  height?: number;
  quality?: number;
}): { width?: number; height?: number; quality: number } {
  const dataSaver = isDataSaverEnabled();
  const baseQuality = options.quality ?? (dataSaver ? 45 : 75);

  if (!dataSaver) {
    return { ...options, quality: baseQuality };
  }

  return {
    width: options.width ? Math.min(options.width, 320) : undefined,
    height: options.height ? Math.min(options.height, 320) : undefined,
    quality: Math.min(baseQuality, 45),
  };
}
