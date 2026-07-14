import React, { useState } from 'react';
import { Gift } from 'lucide-react';
import { TippingModal } from './TippingModal';

interface TreatTipButtonProps {
  recipientId: string;
  contentId?: string;
  contentType?: string;
  recipientName?: string | null;
  recipientAvatar?: string | null;
  className?: string;
  compact?: boolean;
  iconOnly?: boolean;
  onModalVisibilityChange?: (isVisible: boolean) => void;
}

export const TreatTipButton: React.FC<TreatTipButtonProps> = ({
  recipientId,
  contentId,
  contentType,
  recipientName,
  recipientAvatar,
  className = '',
  compact = false,
  iconOnly = false,
  onModalVisibilityChange
}) => {
  const [showTippingModal, setShowTippingModal] = useState(false);

  const handleOpenModal = () => {
    setShowTippingModal(true);
    onModalVisibilityChange?.(true);
  };

  const handleCloseModal = () => {
    setShowTippingModal(false);
    onModalVisibilityChange?.(false);
  };

  const handleTipSuccess = () => {
    handleCloseModal();
    // Could show a success toast here
  };

  if (iconOnly) {
    return (
      <>
        <button
          onClick={handleOpenModal}
          className={className || 'h-10 w-10 bg-white hover:bg-white/90 rounded-full flex items-center justify-center transition-colors duration-200 flex-shrink-0'}
          aria-label="Send treat"
        >
          <Gift className="w-4 h-4 text-black" />
        </button>

        {showTippingModal && (
          <TippingModal
            onClose={handleCloseModal}
            onSuccess={handleTipSuccess}
            recipientId={recipientId}
            contentId={contentId}
            contentType={contentType}
            recipientName={recipientName}
            recipientAvatar={recipientAvatar}
          />
        )}
      </>
    );
  }

  if (compact) {
    return (
      <>
        <button
          onClick={handleOpenModal}
          className={`flex flex-col items-center justify-center gap-2 p-3 rounded-2xl bg-white/5 hover:bg-white/10 active:scale-95 transition-all ${className}`}
          title="Send treat"
        >
          <div className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center">
            <Gift className="w-5 h-5 text-white" />
          </div>
          <span className="text-white/70 text-[10px] font-medium">Treat</span>
        </button>

        {showTippingModal && (
          <TippingModal
            onClose={handleCloseModal}
            onSuccess={handleTipSuccess}
            recipientId={recipientId}
            contentId={contentId}
            contentType={contentType}
            recipientName={recipientName}
            recipientAvatar={recipientAvatar}
          />
        )}
      </>
    );
  }

  return (
    <>
      <button
        onClick={handleOpenModal}
        className={`flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-pink-600 to-red-600 hover:from-pink-700 hover:to-red-700 rounded-lg text-white font-medium transition-all duration-200 shadow-lg shadow-pink-600/25 ${className}`}
      >
        <Gift className="w-4 h-4" />
        <span>Send Treat</span>
      </button>

      {showTippingModal && (
        <TippingModal
          onClose={handleCloseModal}
          onSuccess={handleTipSuccess}
          recipientId={recipientId}
          contentId={contentId}
          contentType={contentType}
        />
      )}
    </>
  );
};