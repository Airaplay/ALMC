import { RefObject, useEffect, useState } from 'react';

/** Scroll offset (px) where header fade-in begins */
export const PROFILE_HEADER_SCROLL_START = 28;
/** Scroll offset (px) where header fade-in completes */
export const PROFILE_HEADER_SCROLL_END = 132;

const PROGRESS_EPSILON = 0.006;

/**
 * Maps scroll position → 0–1 progress for profile hero headers.
 * Uses rAF so background, title, and shadow interpolate smoothly while scrolling.
 */
export function useProfileHeaderScroll(
  containerRef: RefObject<HTMLElement | null>,
  enabled = true,
): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) {
      setProgress(0);
      return;
    }

    let rafId = 0;
    let lastProgress = -1;

    const update = () => {
      const range = PROFILE_HEADER_SCROLL_END - PROFILE_HEADER_SCROLL_START;
      const raw = range > 0 ? (el.scrollTop - PROFILE_HEADER_SCROLL_START) / range : 0;
      const next = Math.min(1, Math.max(0, raw));

      if (
        Math.abs(next - lastProgress) > PROGRESS_EPSILON ||
        next === 0 ||
        next === 1
      ) {
        lastProgress = next;
        setProgress(next);
      }
    };

    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(update);
    };

    update();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(rafId);
    };
  }, [containerRef, enabled]);

  return progress;
}
