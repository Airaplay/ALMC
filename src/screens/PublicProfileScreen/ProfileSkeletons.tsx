import { PROFILE_HERO_HEIGHT } from './profileUiUtils';

export function ProfileHeroSkeletonCore() {
  return (
    <>
      <div
        className="px-5"
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px) * 0.25)' }}
      >
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div className="w-10 h-10 rounded-full bg-white/[0.06] animate-pulse" />
          <div className="h-5 w-32 rounded bg-white/[0.06] animate-pulse" />
          <div className="w-10 h-10 rounded-full bg-white/[0.06] animate-pulse" />
        </div>
      </div>

      <div className="relative overflow-hidden bg-white/[0.04]" style={{ height: PROFILE_HERO_HEIGHT }}>
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.04] to-[#0a0a0a] animate-pulse" />
      </div>

      <div className="profile-safe-x -mt-12 relative z-10 px-5 pb-4 max-w-lg mx-auto w-full">
        <div className="flex items-end gap-4">
          <div className="w-[72px] h-[72px] rounded-2xl bg-white/[0.06] animate-pulse" />
          <div className="flex-1 space-y-2 pb-1">
            <div className="h-7 w-40 bg-white/[0.06] rounded animate-pulse" />
            <div className="h-4 w-24 bg-white/[0.06] rounded animate-pulse" />
          </div>
        </div>

        <div className="flex items-center gap-3 mt-6">
          <div className="flex-1 h-14 rounded-2xl bg-white/[0.06] animate-pulse" />
          <div className="flex-1 h-14 rounded-2xl bg-white/[0.06] animate-pulse" />
        </div>

        <div className="flex items-center gap-2.5 mt-6">
          <div className="h-10 flex-1 rounded-full bg-white/[0.06] animate-pulse" />
          <div className="h-10 flex-1 rounded-full bg-white/[0.06] animate-pulse" />
        </div>
      </div>
    </>
  );
}
