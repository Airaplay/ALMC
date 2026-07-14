import React from 'react';
import { MapPin, Loader2, RefreshCw, Globe } from 'lucide-react';
import { useLocation } from '../hooks/useLocation';
import { getLocationString } from '../lib/locationDetection';

interface LocationDisplayProps {
  format?: 'short' | 'medium' | 'full';
  showRefresh?: boolean;
  showIcon?: boolean;
  className?: string;
}

export const LocationDisplay: React.FC<LocationDisplayProps> = ({
  format = 'medium',
  showRefresh = false,
  showIcon = true,
  className = '',
}) => {
  const { location, isLoading, error, refresh } = useLocation();

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 text-white/60 ${className}`}>
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="font-['Inter',sans-serif] text-sm">Detecting location...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center gap-2 text-red-400 ${className}`}>
        <Globe className="w-4 h-4" />
        <span className="font-['Inter',sans-serif] text-sm">Location unavailable</span>
        {showRefresh && (
          <button
            onClick={refresh}
            className="ml-2 p-1 hover:bg-white/10 rounded transition-colors"
            title="Retry"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  if (!location) {
    return null;
  }

  const locationString = getLocationString(location.location, format);
  const isDetected = location.detected && location.source !== 'fallback';

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {showIcon && (
        <div className={`w-5 h-5 flex items-center justify-center ${
          isDetected ? 'text-green-400' : 'text-white/60'
        }`}>
          <MapPin className="w-4 h-4" />
        </div>
      )}
      <span className="font-['Inter',sans-serif] text-sm text-white/90">
        {locationString}
      </span>
      {showRefresh && (
        <button
          onClick={refresh}
          className="p-1 hover:bg-white/10 rounded transition-colors text-white/60 hover:text-white"
          title="Refresh location"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};

interface LocationBadgeProps {
  className?: string;
}

export const LocationBadge: React.FC<LocationBadgeProps> = ({ className = '' }) => {
  const { location } = useLocation();

  if (!location) return null;

  return (
    <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full ${className}`}>
      <MapPin className="w-3.5 h-3.5 text-green-400" />
      <span className="font-['Inter',sans-serif] text-xs font-medium text-white">
        {location.location.city}, {location.location.countryCode}
      </span>
    </div>
  );
};

interface LocationDetailsProps {
  className?: string;
}

export const LocationDetails: React.FC<LocationDetailsProps> = ({ className = '' }) => {
  const { location, isLoading, refresh } = useLocation();

  if (isLoading) {
    return (
      <div className={`space-y-2 ${className}`}>
        <div className="h-4 bg-white/10 rounded animate-pulse" />
        <div className="h-4 bg-white/10 rounded animate-pulse w-3/4" />
      </div>
    );
  }

  if (!location) return null;

  const { location: loc, source, detected } = location;

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="font-['Inter',sans-serif] font-semibold text-white text-lg">
              Your Location
            </h3>
            {detected && source === 'api' && (
              <span className="px-2 py-0.5 bg-green-600/20 border border-green-500/30 rounded-full text-green-400 text-xs">
                Auto-detected
              </span>
            )}
            {source === 'cache' && (
              <span className="px-2 py-0.5 bg-blue-600/20 border border-blue-500/30 rounded-full text-blue-400 text-xs">
                Cached
              </span>
            )}
          </div>
          <p className="font-['Inter',sans-serif] text-white/60 text-sm">
            Based on your IP address
          </p>
        </div>
        <button
          onClick={refresh}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/60 hover:text-white"
          title="Refresh location"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <p className="font-['Inter',sans-serif] text-white/60 text-xs">City</p>
          <p className="font-['Inter',sans-serif] text-white text-sm font-medium">
            {loc.city}
          </p>
        </div>
        <div className="space-y-1">
          <p className="font-['Inter',sans-serif] text-white/60 text-xs">Region</p>
          <p className="font-['Inter',sans-serif] text-white text-sm font-medium">
            {loc.region}
          </p>
        </div>
        <div className="space-y-1">
          <p className="font-['Inter',sans-serif] text-white/60 text-xs">Country</p>
          <p className="font-['Inter',sans-serif] text-white text-sm font-medium">
            {loc.country}
          </p>
        </div>
        <div className="space-y-1">
          <p className="font-['Inter',sans-serif] text-white/60 text-xs">Timezone</p>
          <p className="font-['Inter',sans-serif] text-white text-sm font-medium">
            {loc.timezone}
          </p>
        </div>
      </div>

      {loc.isp && (
        <div className="pt-3 border-t border-white/10">
          <p className="font-['Inter',sans-serif] text-white/60 text-xs">ISP</p>
          <p className="font-['Inter',sans-serif] text-white text-sm">
            {loc.isp}
          </p>
        </div>
      )}
    </div>
  );
};
