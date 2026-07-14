import { X, Coins, Sparkles, AlertCircle, ShoppingCart } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface CollabUnlockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  unlockCost: number;
  currentBalance: number;
  compatibilityScore: number;
  isProcessing?: boolean;
}

export const CollabUnlockModal = ({
  isOpen,
  onClose,
  onConfirm,
  unlockCost,
  currentBalance,
  compatibilityScore,
  isProcessing = false
}: CollabUnlockModalProps): JSX.Element | null => {
  const navigate = useNavigate();
  const hasEnoughBalance = currentBalance >= unlockCost;
  const shortfall = unlockCost - currentBalance;

  if (!isOpen) return null;

  const handlePurchaseTreats = () => {
    onClose();
    navigate('/treat');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm pb-[140px]">
      <div className="w-full max-w-lg bg-[#0d0d0d] rounded-t-3xl border-t border-white/10 shadow-2xl animate-in slide-in-from-bottom duration-300 max-h-[calc(100vh-160px)] overflow-y-auto">
        <div className="p-6 pb-8">
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="font-['Inter',sans-serif] font-semibold text-white text-lg mb-1">
                Unlock Match
              </h2>
              <p className="font-['Inter',sans-serif] text-gray-400 text-sm">
                Discover your next collaboration opportunity
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center hover:bg-white/5 rounded-full transition-colors"
              disabled={isProcessing}
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          {/* Match Info */}
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-4 mb-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-['Inter',sans-serif] font-medium text-white text-sm">
                  High Compatibility Match
                </h3>
                <p className="font-['Inter',sans-serif] text-gray-400 text-xs">
                  {compatibilityScore}% Match Score
                </p>
              </div>
            </div>

            <p className="font-['Inter',sans-serif] text-gray-400 text-xs leading-relaxed">
              This artist has been carefully selected based on genre compatibility, audience size, and collaboration potential.
            </p>
          </div>

          {/* Cost Breakdown */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-5">
            <div className="flex items-center justify-between mb-3">
              <span className="font-['Inter',sans-serif] text-gray-400 text-xs">
                Unlock Cost
              </span>
              <div className="flex items-center gap-1.5">
                <Coins className="w-4 h-4 text-white" />
                <span className="font-['Inter',sans-serif] font-semibold text-white text-base">
                  {unlockCost} Treats
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-white/10">
              <span className="font-['Inter',sans-serif] text-gray-400 text-xs">
                Your Balance
              </span>
              <div className="flex items-center gap-1.5">
                <Coins className="w-4 h-4 text-gray-400" />
                <span className={`font-['Inter',sans-serif] font-semibold text-sm ${hasEnoughBalance ? 'text-white' : 'text-red-400'}`}>
                  {currentBalance} Treats
                </span>
              </div>
            </div>

            {hasEnoughBalance && (
              <div className="flex items-center justify-between pt-3 border-t border-white/10 mt-3">
                <span className="font-['Inter',sans-serif] text-gray-400 text-xs">
                  Balance After
                </span>
                <div className="flex items-center gap-1.5">
                  <Coins className="w-4 h-4 text-gray-400" />
                  <span className="font-['Inter',sans-serif] font-medium text-white text-sm">
                    {currentBalance - unlockCost} Treats
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Insufficient Balance Warning */}
          {!hasEnoughBalance && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-5">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-white/10 rounded-xl flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-['Inter',sans-serif] font-medium text-white text-sm mb-1">
                    Insufficient Balance
                  </h4>
                  <p className="font-['Inter',sans-serif] text-gray-400 text-xs leading-relaxed">
                    You need {shortfall} more Treats to unlock this match.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            {hasEnoughBalance ? (
              <>
                <button
                  onClick={onClose}
                  disabled={isProcessing}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-xl font-['Inter',sans-serif] font-medium text-white text-sm transition-all duration-200 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={onConfirm}
                  disabled={isProcessing}
                  className="flex-1 py-3 bg-white text-black hover:bg-gray-100 rounded-xl font-['Inter',sans-serif] font-medium text-sm transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isProcessing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                      Unlocking...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Confirm
                    </>
                  )}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={onClose}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-xl font-['Inter',sans-serif] font-medium text-white text-sm transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePurchaseTreats}
                  className="flex-1 py-3 bg-white text-black hover:bg-gray-100 rounded-xl font-['Inter',sans-serif] font-medium text-sm transition-all duration-200 active:scale-95 flex items-center justify-center gap-2"
                >
                  <ShoppingCart className="w-4 h-4" />
                  Buy Treats
                </button>
              </>
            )}
          </div>

          {/* Additional Info */}
          <p className="font-['Inter',sans-serif] text-gray-500 text-xs text-center mt-4">
            Unlocked matches are available until the next rotation (6 hours)
          </p>
        </div>
      </div>
    </div>
  );
};
