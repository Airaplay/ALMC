import React from 'react';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';

interface CustomAlertModalProps {
  isOpen: boolean;
  title?: string;
  message: string;
  type?: 'info' | 'success' | 'error' | 'warning';
  onClose: () => void;
}

export const CustomAlertModal: React.FC<CustomAlertModalProps> = ({
  isOpen,
  title,
  message,
  type = 'info',
  onClose,
}) => {
  if (!isOpen) return null;

  const getIcon = () => {
    switch (type) {
      case 'success':
        return <CheckCircle className="w-10 h-10 text-[#309605]" />;
      case 'error':
        return <AlertCircle className="w-10 h-10 text-red-500" />;
      case 'warning':
        return <AlertCircle className="w-10 h-10 text-yellow-500" />;
      default:
        return <Info className="w-10 h-10 text-[#309605]" />;
    }
  };

  const getColors = () => {
    switch (type) {
      case 'success':
        return {
          iconBg: 'bg-white',
          button: 'bg-gradient-to-r from-[#309605] to-[#3ba208] hover:from-[#3ba208] hover:to-[#309605]',
        };
      case 'error':
        return {
          iconBg: 'bg-white',
          button: 'bg-red-500 hover:bg-red-600 active:bg-red-700',
        };
      case 'warning':
        return {
          iconBg: 'bg-white',
          button: 'bg-yellow-500 hover:bg-yellow-600 active:bg-yellow-700',
        };
      default:
        return {
          iconBg: 'bg-white',
          button: 'bg-gradient-to-r from-[#309605] to-[#3ba208] hover:from-[#3ba208] hover:to-[#309605]',
        };
    }
  };

  const colors = getColors();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-5 animate-in fade-in duration-200">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/90 backdrop-blur-sm"
        onClick={onClose}
      ></div>

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[340px] animate-in zoom-in-95 duration-200">
        {/* Content */}
        <div className="p-6 text-center bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] rounded-2xl">
          {/* Icon */}
          <div className={`w-14 h-14 ${colors.iconBg} rounded-full flex items-center justify-center mx-auto mb-4`}>
            {getIcon()}
          </div>

          {/* Title */}
          {title && (
            <h3 className="font-['Inter',sans-serif] text-lg font-semibold text-white mb-2">
              {title}
            </h3>
          )}

          {/* Message */}
          {message && (
            <p className="font-['Inter',sans-serif] text-[15px] text-white/80 leading-relaxed mb-6">
              {message}
            </p>
          )}

          {/* Button */}
          <button
            onClick={onClose}
            className="w-full bg-white hover:bg-gray-100 active:bg-gray-200 text-black font-['Inter',sans-serif] font-semibold py-3.5 px-6 rounded-xl transition-all duration-200 active:scale-[0.98] shadow-sm"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};
