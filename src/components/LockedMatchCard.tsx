import { Lock, Coins, Sparkles } from 'lucide-react';

interface LockedMatchCardProps {
  compatibilityScore: number;
  unlockCost: number;
  onUnlock: () => void;
  isProcessing?: boolean;
  isDisabled?: boolean;
}

export const LockedMatchCard = ({
  compatibilityScore,
  unlockCost,
  onUnlock,
  isProcessing = false,
  isDisabled = false
}: LockedMatchCardProps): JSX.Element => {
  return (
    <div className="relative bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl overflow-hidden min-h-[380px]">
      {/* Lock overlay */}
      <div className="absolute inset-0 backdrop-blur-md bg-black/40 flex items-center justify-center z-10 p-6">
        <div className="text-center w-full max-w-xs">
          <div className="w-16 h-16 mx-auto mb-5 bg-white/10 backdrop-blur-sm rounded-2xl flex items-center justify-center border border-white/10">
            <Lock className="w-8 h-8 text-gray-400" />
          </div>

          <h3 className="font-['Inter',sans-serif] font-semibold text-white text-lg mb-3">
            Match Locked
          </h3>

          <p className="font-['Inter',sans-serif] text-gray-300 text-sm mb-6 leading-relaxed">
            Unlock this match to discover a great collaboration opportunity
          </p>

          <div className="flex items-center justify-center gap-2 mb-6">
            <div className="px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full">
              <span className="font-['Inter',sans-serif] font-semibold text-white text-base">
                {compatibilityScore}%
              </span>
            </div>
            <span className="font-['Inter',sans-serif] text-gray-400 text-sm">
              Match
            </span>
          </div>

          <button
            onClick={onUnlock}
            disabled={isProcessing || isDisabled}
            className="w-full py-3.5 bg-white text-black hover:bg-gray-100 rounded-xl font-['Inter',sans-serif] font-semibold text-sm transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-gray-500 flex items-center justify-center gap-2 shadow-lg"
          >
            {isProcessing ? (
              <>
                <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                Processing...
              </>
            ) : isDisabled ? (
              <>
                <Lock className="w-4 h-4" />
                Max Unlocks
              </>
            ) : (
              <>
                <Coins className="w-4 h-4" />
                Unlock for {unlockCost} Treats
              </>
            )}
          </button>
        </div>
      </div>

      {/* Blurred content preview */}
      <div className="p-5 filter blur-sm select-none pointer-events-none">
        <div className="flex items-start gap-4 mb-4">
          <div className="w-16 h-16 rounded-full bg-white/20" />

          <div className="flex-1 min-w-0 space-y-2">
            <div className="h-4 bg-white/20 rounded w-3/4" />
            <div className="h-3 bg-white/10 rounded w-1/2" />
            <div className="h-3 bg-white/10 rounded w-2/3" />
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          <div className="px-2.5 py-1 bg-white/10 rounded-lg">
            <div className="h-3 w-14 bg-white/20 rounded" />
          </div>
          <div className="px-2.5 py-1 bg-white/10 rounded-lg">
            <div className="h-3 w-16 bg-white/20 rounded" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-white/5 rounded-xl">
            <div className="h-2.5 bg-white/10 rounded w-16 mb-2" />
            <div className="h-4 bg-white/20 rounded w-10" />
          </div>
          <div className="p-3 bg-white/5 rounded-xl">
            <div className="h-2.5 bg-white/10 rounded w-16 mb-2" />
            <div className="h-4 bg-white/20 rounded w-10" />
          </div>
        </div>
      </div>
    </div>
  );
};
