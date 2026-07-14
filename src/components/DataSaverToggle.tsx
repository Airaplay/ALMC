import React, { useState, useEffect } from 'react';
import { Database, Wifi } from 'lucide-react';

export const DataSaverToggle: React.FC = () => {
  const [isEnabled, setIsEnabled] = useState(false);
  const [savedData, setSavedData] = useState(0);

  useEffect(() => {
    const saved = localStorage.getItem('dataSaverMode');
    setIsEnabled(saved === 'true');

    const dataSaved = localStorage.getItem('dataSavedBytes');
    if (dataSaved) {
      setSavedData(parseInt(dataSaved, 10));
    }
  }, []);

  const toggleDataSaver = () => {
    const newState = !isEnabled;
    setIsEnabled(newState);
    localStorage.setItem('dataSaverMode', String(newState));

    window.dispatchEvent(new CustomEvent('dataSaverChanged', { detail: newState }));

    window.location.reload();
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
            <Database className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-['Inter',sans-serif] font-semibold text-white text-base mb-1 tracking-tight">Data Saver Mode</h3>
            <p className="font-['Inter',sans-serif] text-white/60 text-sm leading-relaxed">Reduce data usage and improve performance</p>
          </div>
        </div>

        <button
          onClick={toggleDataSaver}
          className={`relative inline-flex h-7 w-12 items-center rounded-full transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-[#309605]/50 focus:ring-offset-2 focus:ring-offset-[#0d0d0d] flex-shrink-0 ${
            isEnabled ? 'bg-gradient-to-r from-[#309605] to-[#3ba208] shadow-lg shadow-[#309605]/25' : 'bg-white/20'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-all duration-300 ${
              isEnabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {isEnabled && (
        <div className="rounded-xl bg-[#309605]/10 border border-[#309605]/30 p-4">
          <div className="flex items-center gap-2">
            <Wifi className="w-5 h-5 text-[#309605] flex-shrink-0" />
            <span className="font-['Inter',sans-serif] text-white/70 text-sm">Data saved:</span>
            <span className="font-['Inter',sans-serif] text-white font-semibold text-sm">{formatBytes(savedData)}</span>
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-5">
        <h4 className="font-['Inter',sans-serif] font-semibold text-white text-base mb-4">When enabled:</h4>
        <ul className="space-y-3">
          <li className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 bg-gray-400 rounded-full mt-2 flex-shrink-0"></div>
            <span className="font-['Inter',sans-serif] text-gray-300 text-sm leading-relaxed">Lower quality images for faster loading</span>
          </li>
          <li className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 bg-gray-400 rounded-full mt-2 flex-shrink-0"></div>
            <span className="font-['Inter',sans-serif] text-gray-300 text-sm leading-relaxed">Reduced data consumption on cellular</span>
          </li>
          <li className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 bg-gray-400 rounded-full mt-2 flex-shrink-0"></div>
            <span className="font-['Inter',sans-serif] text-gray-300 text-sm leading-relaxed">Minimal animations and effects</span>
          </li>
          <li className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 bg-gray-400 rounded-full mt-2 flex-shrink-0"></div>
            <span className="font-['Inter',sans-serif] text-gray-300 text-sm leading-relaxed">Faster page loads on slow connections</span>
          </li>
        </ul>
      </div>
    </div>
  );
};
