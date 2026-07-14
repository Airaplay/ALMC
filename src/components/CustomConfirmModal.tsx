import React from 'react';
import { AlertTriangle, HelpCircle, Trash2, X } from 'lucide-react';

interface CustomConfirmModalProps {
  isOpen: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
}

export const CustomConfirmModal: React.FC<CustomConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  const getIcon = () => {
    switch (variant) {
      case 'danger':
        return <Trash2 className="w-12 h-12 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="w-12 h-12 text-yellow-500" />;
      default:
        return <HelpCircle className="w-12 h-12 text-blue-500" />;
    }
  };

  const getColors = () => {
    switch (variant) {
      case 'danger':
        return {
          iconBg: 'bg-red-500/20',
          confirmButton: 'bg-red-600 hover:bg-red-700',
        };
      case 'warning':
        return {
          iconBg: 'bg-yellow-500/20',
          confirmButton: 'bg-yellow-600 hover:bg-yellow-700',
        };
      default:
        return {
          iconBg: 'bg-blue-500/20',
          confirmButton: 'bg-[#309605] hover:bg-[#3ba208]',
        };
    }
  };

  const colors = getColors();

  const handleConfirm = () => {
    onConfirm();
    onCancel(); // Close the modal
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      ></div>

      {/* Modal */}
      <div className="relative bg-gradient-to-b from-[#1a1a1a] to-[#0d0d0d] rounded-3xl shadow-2xl border border-white/10 w-full max-w-sm animate-in zoom-in-95 duration-200">
        {/* Close Button */}
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4 text-white/70" />
        </button>

        {/* Content */}
        <div className="p-6 text-center">
          {/* Icon */}
          <div className={`w-16 h-16 ${colors.iconBg} rounded-full flex items-center justify-center mx-auto mb-4`}>
            {getIcon()}
          </div>

          {/* Title */}
          {title && (
            <h3 className="text-xl font-bold text-white mb-2">
              {title}
            </h3>
          )}

          {/* Message */}
          <p className="text-white/70 text-sm leading-relaxed mb-6">
            {message}
          </p>

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 bg-white/10 hover:bg-white/15 text-white font-semibold py-3 px-6 rounded-xl transition-colors active:scale-95 transform duration-150 border border-white/20"
            >
              {cancelText}
            </button>
            <button
              onClick={handleConfirm}
              className={`flex-1 ${colors.confirmButton} text-white font-semibold py-3 px-6 rounded-xl transition-colors active:scale-95 transform duration-150`}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
