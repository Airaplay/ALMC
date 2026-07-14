import { X } from 'lucide-react';
import { useEffect } from 'react';

interface ActionItem {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  variant?: 'default' | 'destructive';
}

interface BottomActionSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  actions: ActionItem[];
}

export const BottomActionSheet = ({ isOpen, onClose, title, actions }: BottomActionSheetProps) => {
  useEffect(() => {
    if (isOpen) {
      // Fix iOS scroll jump by using fixed positioning
      const scrollY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';

      return () => {
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        window.scrollTo(0, scrollY);
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110] animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="fixed inset-x-0 bottom-0 z-[110] animate-slide-up pb-20">
        <div className="bg-[#1a1a1a] border-t border-white/10 rounded-t-3xl shadow-2xl">
          <div className="w-12 h-1 bg-white/20 rounded-full mx-auto mt-3 mb-4" />

          {title && (
            <div className="flex items-center justify-between px-6 pb-4 border-b border-white/10">
              <h3 className="text-lg font-semibold text-white">{title}</h3>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/10 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-[#309605] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1a1a]"
                aria-label="Close"
              >
                <X className="w-5 h-5 text-white/60" />
              </button>
            </div>
          )}

          <div className="py-2 px-4 pb-safe">
            {actions.map((action, index) => (
              <button
                key={index}
                onClick={() => {
                  action.onClick();
                  onClose();
                }}
                className={`w-full flex items-center gap-4 px-4 py-4 rounded-xl transition-colors focus-visible:ring-2 focus-visible:ring-[#309605] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1a1a] ${
                  action.variant === 'destructive'
                    ? 'hover:bg-red-500/10 text-red-400 active:bg-red-500/20'
                    : 'hover:bg-white/10 text-white active:bg-white/20'
                }`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  action.variant === 'destructive' ? 'bg-red-500/20' : 'bg-white/10'
                }`}>
                  {action.icon}
                </div>
                <span className="text-base font-medium">{action.label}</span>
              </button>
            ))}
          </div>

          <div className="px-4 pb-6 pt-2">
            <button
              onClick={onClose}
              className="w-full py-4 bg-white/10 hover:bg-white/20 rounded-xl text-white font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slide-up {
          from {
            transform: translateY(100%);
          }
          to {
            transform: translateY(0);
          }
        }

        .animate-slide-up {
          animation: slide-up 0.3s cubic-bezier(0.32, 0.72, 0, 1);
        }

        @supports (padding-bottom: env(safe-area-inset-bottom)) {
          .pb-safe {
            padding-bottom: calc(1.5rem + env(safe-area-inset-bottom));
          }
        }
      `}</style>
    </>
  );
};
