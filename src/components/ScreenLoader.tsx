import React from 'react';

export const ScreenLoader: React.FC = () => (
  <div className="fixed inset-0 z-50 bg-gradient-to-b from-[#0a0a0a] via-[#0d0d0d] to-[#111111] flex items-center justify-center">
    <div className="relative">
      <img
        src="/official_airaplay_logo.png"
        alt="Loading"
        className="w-32 h-32 object-contain drop-shadow-2xl"
        style={{ animation: 'breathe 3s ease-in-out infinite' }}
      />
      <div className="absolute inset-0 -z-10 blur-3xl opacity-30 bg-[#00ad74] scale-75 animate-pulse" />
    </div>
    <style>{`
      @keyframes breathe {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.05); opacity: 0.9; }
      }
    `}</style>
  </div>
);
