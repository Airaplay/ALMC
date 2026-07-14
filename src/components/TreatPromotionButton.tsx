import React, { useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { TreatPromotionModal } from './TreatPromotionModal';

interface TreatPromotionButtonProps {
  contentId: string;
  contentType: 'song_promotion' | 'profile_promotion';
  contentTitle: string;
  className?: string;
  compact?: boolean;
}

export const TreatPromotionButton: React.FC<TreatPromotionButtonProps> = ({
  contentId,
  contentType,
  contentTitle,
  className = '',
  compact = false
}) => {
  const [showPromotionModal, setShowPromotionModal] = useState(false);

  const handlePromotionSuccess = () => {
    setShowPromotionModal(false);
    // Could show a success toast here
  };

  if (compact) {
    return (
      <>
        <button
          onClick={() => setShowPromotionModal(true)}
          className={`p-2 hover:bg-purple-500/20 rounded-full transition-colors duration-200 ${className}`}
          title="Promote with treats"
        >
          <TrendingUp className="w-4 h-4 text-purple-400" />
        </button>

        {showPromotionModal && (
          <TreatPromotionModal
            onClose={() => setShowPromotionModal(false)}
            onSuccess={handlePromotionSuccess}
            contentId={contentId}
            contentType={contentType}
            contentTitle={contentTitle}
          />
        )}
      </>
    );
  }

  return (
    <>
      <button
        onClick={() => setShowPromotionModal(true)}
        className={`flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-lg text-white font-medium transition-all duration-200 shadow-lg shadow-purple-600/25 ${className}`}
      >
        <TrendingUp className="w-4 h-4" />
        <span>Promote</span>
      </button>

      {showPromotionModal && (
        <TreatPromotionModal
          onClose={() => setShowPromotionModal(false)}
          onSuccess={handlePromotionSuccess}
          contentId={contentId}
          contentType={contentType}
          contentTitle={contentTitle}
        />
      )}
    </>
  );
};