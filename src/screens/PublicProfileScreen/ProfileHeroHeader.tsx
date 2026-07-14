import { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  PROFILE_HERO_HEADER_BTN_CLASS,
  PROFILE_HERO_HEADER_GRID_BACK,
  PROFILE_HERO_HEADER_ICON_CLASS,
  PROFILE_HERO_HEADER_ICON_STROKE,
} from './profileUiUtils';

interface ProfileHeroHeaderProps {
  progress: number;
  title: string;
  gridTemplateColumns: string;
  onBack: () => void;
  trailing?: ReactNode;
}

export function ProfileHeroHeader({
  progress,
  title,
  gridTemplateColumns,
  onBack,
  trailing,
}: ProfileHeroHeaderProps) {
  const clamped = Math.min(1, Math.max(0, progress));

  return (
    <header
      className={cn(
        'sticky top-0 z-30 px-5 transition-[background-color,box-shadow,border-color] duration-150',
        clamped > 0.02 && 'border-b border-white/10 backdrop-blur-xl',
      )}
      style={{
        paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px) * 0.25)',
        paddingBottom: '0.75rem',
        backgroundColor: `rgba(10, 10, 10, ${clamped * 0.92})`,
        boxShadow: clamped > 0.35 ? '0 8px 24px rgba(0, 0, 0, 0.35)' : 'none',
      }}
    >
      <div
        className="grid items-center gap-2 max-w-lg mx-auto"
        style={{ gridTemplateColumns }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="Go back"
          className={cn(
            PROFILE_HERO_HEADER_BTN_CLASS,
            clamped > 0.35 && 'bg-white/[0.07] border-white/[0.1] shadow-none hover:bg-white/[0.11]',
          )}
        >
          <ArrowLeft
            className={PROFILE_HERO_HEADER_ICON_CLASS}
            strokeWidth={PROFILE_HERO_HEADER_ICON_STROKE}
          />
        </button>

        <h1
          className="min-w-0 text-center text-base font-semibold text-white truncate transition-opacity duration-150"
          style={{ opacity: clamped }}
        >
          {title}
        </h1>

        <div
          className="flex items-center justify-end gap-2 min-w-0"
          style={{ minWidth: PROFILE_HERO_HEADER_GRID_BACK }}
        >
          {trailing}
        </div>
      </div>
    </header>
  );
}
