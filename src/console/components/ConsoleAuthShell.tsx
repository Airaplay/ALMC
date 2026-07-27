import { Music2 } from 'lucide-react';
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
    maxWidth === '2xl' ? 'max-w-2xl' : maxWidth === 'lg' ? 'max-w-lg' : 'max-w-[420px]';

  return (
    <div className="relative flex min-h-screen w-full overflow-hidden">
      <div className="absolute inset-0 bg-[#07111f]" aria-hidden />
      <div
        className="absolute inset-0 bg-cover bg-center opacity-45"
        style={{ backgroundImage: "url('/admin-login-bg.png')" }}
        aria-hidden
      />
      <div
        className="absolute inset-0 bg-gradient-to-r from-[#07111f]/75 via-[#07111f]/35 to-[#07111f]/55"
        aria-hidden
      />

      {headerAction ? (
        <div className="absolute right-4 top-4 z-20 sm:right-6 sm:top-6">{headerAction}</div>
      ) : null}

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col justify-center gap-12 px-6 py-12 lg:flex-row lg:items-center lg:justify-between lg:gap-16 lg:px-10">
        <div className="max-w-xl text-white lg:flex-1">
          <div className="mb-8 flex items-center gap-2">
            <span className="text-2xl font-extrabold tracking-[0.18em] sm:text-3xl">AIRAPLAY</span>
            <span className="relative ml-1 flex h-6 w-16 items-center" aria-hidden>
              <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-white/70" />
              <Music2 className="absolute -right-1 top-1/2 h-4 w-4 -translate-y-1/2 text-white" strokeWidth={2} />
            </span>
          </div>
          <h1 className="text-4xl font-extrabold uppercase leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Own the Stage
          </h1>
          <p className="mt-5 text-base font-medium text-white/90 sm:text-lg">
            Where music meets control.
          </p>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-white/70 sm:text-[15px]">
            Manage artists, releases, and your roster from the Airaplay Label & Management Console.
          </p>
        </div>

        <div className={cn('w-full lg:flex lg:flex-1 lg:justify-end')}>
          <div
            className={cn(
              'w-full rounded-[2rem] border border-white/30 bg-white/15 p-10 shadow-[0_8px_32px_rgba(0,0,0,0.25)] backdrop-blur-[22px] sm:p-12',
              widthClass
            )}
          >
            <div className="mb-6">
              <h2 className="text-2xl font-bold tracking-tight text-white">{title}</h2>
              {subtitle ? (
                <p className="mt-2 text-sm leading-snug text-white/75">{subtitle}</p>
              ) : null}
            </div>
            {children}
            {footer}
          </div>
        </div>
      </div>
    </div>
  );
}
