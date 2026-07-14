import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SectionHorizontalScrollProps {
  children: ReactNode;
  /** Classes for the inner flex row */
  rowClassName?: string;
  className?: string;
  variant?: "app" | "web";
  /** Pixels to scroll per tap; defaults to ~75% of visible width */
  scrollStep?: number;
}

export function SectionHorizontalScroll({
  children,
  rowClassName = "flex gap-4 pb-4",
  className,
  variant = "app",
  scrollStep,
}: SectionHorizontalScrollProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);

  const isWeb = variant === "web";

  const updateScrollState = useCallback(() => {
    if (!isWeb) return;
    const el = scrollRef.current;
    if (!el) return;
    const overflow = el.scrollWidth > el.clientWidth + 2;
    setHasOverflow(overflow);
    setCanScrollLeft(overflow && el.scrollLeft > 2);
    setCanScrollRight(
      overflow && el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    );
  }, [isWeb]);

  const getScrollStep = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return 200;
    return scrollStep ?? Math.max(200, Math.round(el.clientWidth * 0.75));
  }, [scrollStep]);

  const handleScrollLeft = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: -getScrollStep(), behavior: "smooth" });
    window.setTimeout(updateScrollState, 350);
  }, [getScrollStep, updateScrollState]);

  const handleScrollRight = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: getScrollStep(), behavior: "smooth" });
    window.setTimeout(updateScrollState, 350);
  }, [getScrollStep, updateScrollState]);

  useEffect(() => {
    if (!isWeb) return;
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      ro.disconnect();
    };
  }, [isWeb, updateScrollState, children]);

  const buttonClass = cn(
    "flex items-center justify-center rounded-full transition-all active:scale-95 touch-manipulation disabled:opacity-35 disabled:pointer-events-none",
    "w-8 h-8 bg-muted hover:bg-muted/80 text-foreground disabled:hover:bg-muted"
  );

  return (
    <div className={cn("w-full", className)}>
      <div
        ref={scrollRef}
        className={cn(
          "w-full overflow-x-auto overscroll-x-contain",
          "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          isWeb && "no-scrollbar"
        )}
      >
        <div className={rowClassName}>{children}</div>
      </div>
      {isWeb && hasOverflow && (
        <div className="hidden lg:flex justify-end items-center gap-2 mt-2">
          <button
            type="button"
            onClick={handleScrollLeft}
            disabled={!canScrollLeft}
            aria-label="Scroll back"
            className={buttonClass}
          >
            <ChevronLeft className="w-4 h-4" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={handleScrollRight}
            disabled={!canScrollRight}
            aria-label="Scroll forward"
            className={buttonClass}
          >
            <ChevronRight className="w-4 h-4" strokeWidth={2.5} />
          </button>
        </div>
      )}
    </div>
  );
}
