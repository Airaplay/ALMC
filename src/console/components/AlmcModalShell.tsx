import { useEffect, type ReactNode } from 'react';
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
};

const sizeClass = {
  md: 'max-w-2xl',
  lg: 'max-w-3xl',
  xl: 'max-w-4xl',
} as const;

export function AlmcModalShell({
  title,
  subtitle,
  onClose,
  children,
  footer,
  size = 'lg',
}: AlmcModalShellProps) {
  useEffect(() => {
    document.body.classList.add('overflow-hidden');
    return () => document.body.classList.remove('overflow-hidden');
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className={cn(
          'relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-2xl',
          sizeClass[size]
        )}
        onClick={(e) => e.stopPropagation()}
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
            onClick={onClose}
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
