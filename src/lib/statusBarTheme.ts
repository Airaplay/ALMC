import { Capacitor } from '@capacitor/core';

const DARK_BG = '#000000'; // pure black for maximum contrast behind white icons

export interface ApplyStatusBarThemeOptions {
  /** When true, skip setOverlaysWebView so we don't trigger layout reflow on resume (avoids black band) */
  onResume?: boolean;
}

/**
 * Apply status bar: visible, always white icons for our dark UI.
 * On initial load we set overlay false so content starts below status bar. On resume we only
 * re-apply show/style/color so layout doesn't change and no black space appears.
 */
export async function applyStatusBarTheme(options?: ApplyStatusBarThemeOptions): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    if (!options?.onResume) {
      // Only set overlay at startup — calling this on resume causes layout reflow and black band
      await StatusBar.setOverlaysWebView({ overlay: false });
    }
    await StatusBar.show();
    // Android naming can be confusing: "light status bar" = dark icons.
    // We want WHITE icons on our dark UI, so use the "dark" style here.
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: DARK_BG });
  } catch (e) {
    console.warn('[StatusBar] Could not apply theme:', e);
  }
}

export function subscribeStatusBarToSystemTheme(): () => void {
  // Our app enforces a consistent status bar (white icons).
  // Keep API for callers but no-op to avoid system-theme driven flips.
  return () => {};
}
