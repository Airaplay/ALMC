import { MapPin, Music, Users, TrendingUp, Sparkles } from 'lucide-react';
import { CollaborationMatch } from '../lib/collaborationMatchingService';
import { LazyImage } from './LazyImage';

interface CollaborationMatchCardProps {
  match: CollaborationMatch;
  onViewProfile: (artistId: string) => void;
  compact?: boolean;
}

export const CollaborationMatchCard = ({ match, onViewProfile, compact = false }: CollaborationMatchCardProps): JSX.Element => {
  const { matchedArtist, compatibilityScore, matchFactors, genreOverlap } = match;

  const getCompatibilityColor = (score: number): string => {
    if (score >= 80) return 'from-[#309605] to-[#3ba208]';
    if (score >= 60) return 'from-blue-500 to-blue-600';
    return 'from-orange-500 to-orange-600';
  };

  const getCompatibilityLabel = (score: number): string => {
    if (score >= 80) return 'Excellent Match';
    if (score >= 60) return 'Good Match';
    return 'Potential Match';
  };

  if (compact) {
    return (
      <div
        onClick={() => onViewProfile(matchedArtist.userId)}
        className="relative flex-shrink-0 w-[280px] bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl overflow-hidden cursor-pointer hover:bg-white/10 transition-all duration-300 group"
      >
        <div className="p-4">
          <div className="flex items-start gap-3 mb-3">
            <div className="relative flex-shrink-0">
              {matchedArtist.profilePhotoUrl ? (
                <LazyImage
                  src={matchedArtist.profilePhotoUrl}
                  alt={matchedArtist.stageName}
                  className="w-14 h-14 rounded-full object-cover border border-white/10"
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center">
                  <Music className="w-6 h-6 text-white" />
                </div>
              )}
              {matchedArtist.isVerified && (
                <div className="absolute -bottom-0.5 -right-0.5 w-4.5 h-4.5 bg-white rounded-full flex items-center justify-center border-2 border-[#0d0d0d]">
                  <Sparkles className="w-2.5 h-2.5 text-black" />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <h3 className="font-['Inter',sans-serif] font-semibold text-white text-sm truncate mb-1">
                {matchedArtist.stageName}
              </h3>
              {matchedArtist.country && (
                <div className="flex items-center gap-1 text-gray-400 text-xs mb-2">
                  <MapPin className="w-3 h-3" />
                  <span className="truncate">{matchedArtist.country}</span>
                </div>
              )}
            </div>

            <div className="px-2.5 py-1 bg-white/10 rounded-full">
              <span className="font-['Inter',sans-serif] font-semibold text-white text-xs">
                {compatibilityScore}%
              </span>
            </div>
          </div>

          {genreOverlap.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {genreOverlap.slice(0, 2).map((genre, index) => (
                <span
                  key={index}
                  className="px-2 py-0.5 bg-white/10 text-white rounded-lg text-xs font-['Inter',sans-serif] font-medium"
                >
                  {genre}
                </span>
              ))}
              {genreOverlap.length > 2 && (
                <span className="px-2 py-0.5 bg-white/5 text-gray-400 rounded-lg text-xs font-['Inter',sans-serif] font-medium">
                  +{genreOverlap.length - 2}
                </span>
              )}
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-gray-400">
            <div className="flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              <span>{matchedArtist.followerCount.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>{matchedArtist.totalPlays.toLocaleString()} plays</span>
            </div>
          </div>
        </div>

        <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
      </div>
    );
  }

  return (
    <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl overflow-hidden">
      <div className="p-5">
        <div className="flex items-start gap-4 mb-4">
          <div className="relative flex-shrink-0">
            {matchedArtist.profilePhotoUrl ? (
              <LazyImage
                src={matchedArtist.profilePhotoUrl}
                alt={matchedArtist.stageName}
                className="w-16 h-16 rounded-full object-cover border border-white/10"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
                <Music className="w-7 h-7 text-white" />
              </div>
            )}
            {matchedArtist.isVerified && (
              <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-white rounded-full flex items-center justify-center border-2 border-[#0d0d0d]">
                <Sparkles className="w-3 h-3 text-black" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3 mb-1.5">
              <h3 className="font-['Inter',sans-serif] font-semibold text-white text-base">
                {matchedArtist.stageName}
              </h3>
              <div className="px-3 py-1 bg-white/10 rounded-full flex-shrink-0">
                <span className="font-['Inter',sans-serif] font-semibold text-white text-xs">
                  {compatibilityScore}%
                </span>
              </div>
            </div>

            {matchedArtist.country && (
              <div className="flex items-center gap-1 text-gray-400 text-xs mb-2.5">
                <MapPin className="w-3.5 h-3.5" />
                <span>{matchedArtist.country}</span>
              </div>
            )}

            <p className="font-['Inter',sans-serif] text-gray-400 text-xs mb-3">
              {getCompatibilityLabel(compatibilityScore)}
            </p>

            <div className="flex items-center gap-4 text-xs text-gray-400">
              <div className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                <span>{matchedArtist.followerCount.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>{matchedArtist.totalPlays.toLocaleString()} plays</span>
              </div>
            </div>
          </div>
        </div>

        {matchedArtist.bio && (
          <p className="font-['Inter',sans-serif] text-gray-400 text-xs mb-4 line-clamp-2 leading-relaxed">
            {matchedArtist.bio}
          </p>
        )}

        {genreOverlap.length > 0 && (
          <div className="mb-4">
            <p className="font-['Inter',sans-serif] font-medium text-white text-xs mb-2">
              Shared Genres
            </p>
            <div className="flex flex-wrap gap-2">
              {genreOverlap.map((genre, index) => (
                <span
                  key={index}
                  className="px-2.5 py-1 bg-white/10 text-white rounded-lg text-xs font-['Inter',sans-serif] font-medium"
                >
                  {genre}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="p-3 bg-white/5 rounded-xl border border-white/5">
            <p className="font-['Inter',sans-serif] text-gray-400 text-xs mb-1">Genre Match</p>
            <p className="font-['Inter',sans-serif] font-semibold text-white text-sm">
              {matchFactors.genreMatch}%
            </p>
          </div>
          <div className="p-3 bg-white/5 rounded-xl border border-white/5">
            <p className="font-['Inter',sans-serif] text-gray-400 text-xs mb-1">Audience</p>
            <p className="font-['Inter',sans-serif] font-semibold text-white text-sm">
              {matchFactors.audienceOverlap}%
            </p>
          </div>
        </div>

        <button
          onClick={() => onViewProfile(matchedArtist.userId)}
          className="w-full py-2.5 bg-white/10 hover:bg-white/15 rounded-xl font-['Inter',sans-serif] font-medium text-white text-sm transition-all duration-200 active:scale-95"
        >
          View Profile
        </button>
      </div>
    </div>
  );
};
