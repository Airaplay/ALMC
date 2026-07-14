import React from 'react';
import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  className = '',
}) => {
  return (
    <div className={`flex flex-col items-center justify-center py-12 px-6 ${className}`}>
      <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center mb-4 animate-in fade-in duration-500">
        <Icon className="w-12 h-12 text-white/40" />
      </div>
      <h3 className="text-white text-lg font-semibold mb-2 animate-in fade-in duration-500 delay-100">
        {title}
      </h3>
      <p className="text-white/70 text-sm text-center mb-6 max-w-xs animate-in fade-in duration-500 delay-200">
        {description}
      </p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="px-6 py-3 bg-gradient-to-r from-[#309605] to-[#3ba208] rounded-full text-white font-medium transition-all duration-200 hover:from-[#3ba208] hover:to-[#309605] shadow-lg hover:shadow-xl active:scale-95 focus-visible:ring-2 focus-visible:ring-[#309605] focus-visible:ring-offset-2 focus-visible:ring-offset-black animate-in fade-in duration-500 delay-300"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};
