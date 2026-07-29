import { useEffect, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

type AlmcModalShellProps = {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
  /** Raise above another ALMC modal (e.g. Buy Treats over Setup Boost). */
  layer?: 'base' | 'nested';
  /** When a nested modal is open, ignore clicks on this shell. */
  inert?: boolean;
};

const sizeClass = {
  md: 'max-w-2xl',
  lg: 'max-w-3xl',
  xl: 'max-w-4xl',
} as const;

const layerClass = {
  base: 'z-[200]',
  nested: 'z-[220]',
} as const;

let bodyScrollLockCount = 0;

function lockBodyScroll() {
  if (typeof document === 'undefined') return;
  if (bodyScrollLockCount === 0) {
    document.body.classList.add('overflow-hidden');
  }
  bodyScrollLockCount += 1;
}

function unlockBodyScroll() {
  if (typeof document === 'undefined') return;
  bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1);
  if (bodyScrollLockCount === 0) {
    document.body.classList.remove('overflow-hidden');
  }
}

export function AlmcModalShell({
  title,
  subtitle,
  onClose,
  children,
  footer,
  size = 'lg',
  layer = 'base',
  inert = false,
}: AlmcModalShellProps) {
  useEffect(() => {
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, []);

  const handleClose = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (inert) return;
    onClose();
  };

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm',
        layerClass[layer],
        inert && 'pointer-events-none'
      )}
      role="dialog"
      aria-modal="true"
      aria-hidden={inert || undefined}
      onClick={handleClose}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className={cn(
          'relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-2xl',
          sizeClass[size]
        )}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="h-1.5 shrink-0 bg-[var(--almc-lime)]" />
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div className="min-w-0">
            <h2 className="break-words text-xl font-bold tracking-tight text-foreground">{title}</h2>
            {subtitle ? (
              <p className="mt-1 break-words text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer ? (
          <div className="shrink-0 border-t border-border/80 px-6 py-4">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
