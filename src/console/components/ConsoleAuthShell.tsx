import { cn } from '../../lib/utils';

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
    <div className="relative flex min-h-screen items-center justify-center bg-[#0a0a0b] p-4">
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
        aria-hidden
      >
        <div
          className="h-[320px] w-[320px] rounded-full opacity-[0.07] sm:h-[420px] sm:w-[420px]"
          style={{ background: 'radial-gradient(circle, hsl(102,94%,30%) 0%, transparent 70%)' }}
        />
      </div>

      {headerAction}

      <div className={cn('relative w-full', widthClass)}>
        <div className="overflow-hidden rounded-3xl border border-white/20 bg-[#0d0d0d]/97 shadow-[0_32px_80px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
          <div className="h-[2px] w-full shrink-0 bg-gradient-to-r from-transparent via-[#3ba208] to-transparent opacity-80" />
          <div className="space-y-6 px-6 py-8 sm:space-y-7 sm:px-8 sm:py-8">
            <div>
              <img
                src="/official_airaplay_logo.png"
                alt="Airaplay"
                className="h-7 object-contain sm:h-8"
              />
              <h1 className="mt-4 text-2xl font-black leading-none tracking-tight text-white sm:text-[28px]">
                {title}
              </h1>
              {subtitle ? (
                <p className="mt-2 text-[13px] leading-snug text-white/60">{subtitle}</p>
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
