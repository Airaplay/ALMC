import { cn } from '../../lib/utils';
import { ConsoleThemeToggle } from './ConsoleThemeToggle';
import { consoleTheme } from '../consoleTheme';

interface ConsoleAuthShellProps {
  title: string;
  subtitle?: string;
  maxWidth?: 'md' | 'lg' | '2xl';
  headerAction?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function ConsoleAuthShell({
  title,
  subtitle,
  maxWidth = 'md',
  headerAction,
  footer,
  children,
}: ConsoleAuthShellProps): JSX.Element {
  const widthClass =
    maxWidth === '2xl' ? 'max-w-2xl' : maxWidth === 'lg' ? 'max-w-lg' : 'max-w-md';

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden
      >
        <div
          className="absolute -right-24 -top-24 h-[420px] w-[420px] rounded-full opacity-40"
          style={{ background: 'radial-gradient(circle, var(--almc-lime) 0%, transparent 68%)' }}
        />
        <div
          className="absolute -bottom-32 -left-16 h-[360px] w-[360px] rounded-full opacity-25"
          style={{ background: 'radial-gradient(circle, hsl(0 0% 0% / 0.06) 0%, transparent 70%)' }}
        />
      </div>

      <div className="absolute right-4 top-4 z-10 flex items-center gap-1 sm:right-6 sm:top-6">
        <ConsoleThemeToggle compact />
        {headerAction}
      </div>

      <div className={cn('relative w-full', widthClass)}>
        <div className={cn(consoleTheme.card, 'overflow-hidden')}>
          <div className="h-1.5 w-full shrink-0 bg-[var(--almc-lime)]" />
          <div className="space-y-6 px-6 py-8 sm:space-y-7 sm:px-8 sm:py-9">
            <div>
              <img
                src="/official_airaplay_logo.png"
                alt="Airaplay"
                className="h-7 object-contain sm:h-8"
              />
              <h1 className="mt-5 text-2xl font-bold leading-none tracking-tight text-foreground sm:text-[28px]">
                {title}
              </h1>
              {subtitle ? (
                <p className="mt-2 text-[13px] leading-snug text-muted-foreground">{subtitle}</p>
              ) : null}
            </div>
            {children}
          </div>
        </div>
        {footer}
      </div>
    </div>
  );
}
