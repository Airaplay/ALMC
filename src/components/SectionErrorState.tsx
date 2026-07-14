import { WifiOff, RefreshCw } from 'lucide-react';
import { useNetworkQuality } from '../hooks/useNetworkQuality';

interface SectionErrorStateProps {
  onRetry?: () => void;
  message?: string;
  compact?: boolean;
}

export const SectionErrorState = ({ 
  onRetry, 
  message = "Unable to load content",
  compact = false 
}: SectionErrorStateProps): JSX.Element | null => {
  const { isOnline } = useNetworkQuality();

  if (!isOnline) {
    return null;
  }

  if (compact) {
    return (
      <div className="py-3 px-4 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center flex-shrink-0">
            <WifiOff className="w-4 h-4 text-white/40" />
          </div>
          <p className="text-white/60 text-sm">{message}</p>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white/70 text-xs font-medium transition-colors duration-200 flex items-center gap-1.5 active:scale-95"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Retry</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="py-8 px-6 rounded-2xl bg-white/5 border border-white/10 text-center">
      <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
        <WifiOff className="w-6 h-6 text-white/40" />
      </div>
      <p className="text-white/70 text-sm font-medium mb-1">{message}</p>
      <p className="text-white/40 text-xs mb-4">Check your connection and try again</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white/80 text-sm font-medium transition-all duration-200 flex items-center gap-2 mx-auto active:scale-95"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Try Again</span>
        </button>
      )}
    </div>
  );
};
