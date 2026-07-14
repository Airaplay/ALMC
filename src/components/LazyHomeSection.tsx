import { memo, useEffect, useRef, useState, type ReactNode } from "react";

interface LazyHomeSectionProps {
  children: ReactNode;
  /** Reserve space before mount to limit layout shift */
  minHeight?: number | string;
  /** Prefetch when within this margin of the viewport */
  rootMargin?: string;
  /** Skip lazy gate (above-the-fold sections) */
  eager?: boolean;
}

/**
 * Defers mounting heavy home sections until the user scrolls near them.
 * Once mounted, children stay mounted so data is not refetched on scroll-back.
 */
export const LazyHomeSection = memo(function LazyHomeSection({
  children,
  minHeight = 220,
  rootMargin = "500px 0px",
  eager = false,
}: LazyHomeSectionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(eager);

  useEffect(() => {
    if (eager || shouldRender) return;

    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldRender(true);
          observer.disconnect();
        }
      },
      { rootMargin, threshold: 0 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [eager, shouldRender, rootMargin]);

  const minHeightStyle =
    typeof minHeight === "number" ? `${minHeight}px` : minHeight;

  return (
    <div
      ref={ref}
      className="aira-home-lazy-section"
      data-pending={shouldRender ? undefined : "true"}
      style={shouldRender ? undefined : { minHeight: minHeightStyle }}
    >
      {shouldRender ? children : null}
    </div>
  );
});
