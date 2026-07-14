import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Send, X, Sparkles, Clock, Inbox, RefreshCw } from 'lucide-react';
import { CollaborationMatchCard } from '../../components/CollaborationMatchCard';
import { LockedMatchCard } from '../../components/LockedMatchCard';
import { CollabUnlockModal } from '../../components/CollabUnlockModal';
import { supabase } from '../../lib/supabase';
import {
  getCollaborationMatches,
  sendCollaborationRequest,
  trackCollaborationInteraction,
  getNextRefreshTime,
  CollaborationMatch
} from '../../lib/collaborationMatchingService';
import {
  getCollaborationUnlockSettings,
  getUserUnlockStatus,
  purchaseCollaborationUnlock,
  CollaborationUnlockSettings
} from '../../lib/collaborationUnlockService';
import { useMusicPlayer } from '../../contexts/MusicPlayerContext';
import { useAlert } from '../../contexts/AlertContext';

export const CollaborateScreen = (): JSX.Element => {
  const navigate = useNavigate();
  const { isMiniPlayerVisible } = useMusicPlayer();
  const { showAlert } = useAlert();
  const [matches, setMatches] = useState<CollaborationMatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [artistId, setArtistId] = useState<string | null>(null);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<CollaborationMatch | null>(null);
  const [requestMessage, setRequestMessage] = useState('');
  const [collabType, setCollabType] = useState('feature');
  const [isSending, setIsSending] = useState(false);
  const [nextRefreshTime, setNextRefreshTime] = useState<Date | null>(null);
  const [timeUntilRefresh, setTimeUntilRefresh] = useState('');
  const [hasAutoRefreshed, setHasAutoRefreshed] = useState(false);

  // Unlock feature state
  const [unlockSettings, setUnlockSettings] = useState<CollaborationUnlockSettings | null>(null);
  const [unlockedArtistIds, setUnlockedArtistIds] = useState<Set<string>>(new Set());
  const [totalUnlockedCount, setTotalUnlockedCount] = useState(0);
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);
  const [selectedUnlockMatch, setSelectedUnlockMatch] = useState<CollaborationMatch | null>(null);
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);

  useEffect(() => {
    verifyCreatorAccessAndLoadData();
  }, []);

  const verifyCreatorAccessAndLoadData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        showAlert('Please sign in to access collaboration features', 'error');
        navigate('/');
        return;
      }

      // Verify user is a creator or admin
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single();

      if (userError || !userData) {
        showAlert('Unable to verify user role', 'error');
        navigate('/');
        return;
      }

      if (userData.role !== 'creator' && userData.role !== 'admin') {
        showAlert('This feature is only available to creators', 'error');
        navigate('/create');
        return;
      }

      // User is a creator or admin, proceed with loading data
      loadMatches();
      loadPendingRequestsCount();
    } catch (error) {
      console.error('Error verifying creator access:', error);
      showAlert('An error occurred. Please try again.', 'error');
      navigate('/');
    }
  };

  const loadPendingRequestsCount = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { count, error } = await supabase
        .from('collaboration_requests')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_user_id', user.id)
        .eq('status', 'pending');

      if (!error && count) {
        setPendingRequestsCount(count);
      }
    } catch (error) {
      console.error('Error loading pending requests count:', error);
    }
  };

  useEffect(() => {
    if (!nextRefreshTime) return;

    const updateCountdown = () => {
      const now = new Date();
      const diff = nextRefreshTime.getTime() - now.getTime();

      if (diff <= 0) {
        if (!hasAutoRefreshed) {
          setTimeUntilRefresh('Ready to refresh');
          setHasAutoRefreshed(true);
        }
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeUntilRefresh(`${hours}h ${minutes}m ${seconds}s`);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [nextRefreshTime, hasAutoRefreshed]);

  const loadMatches = async () => {
    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        showAlert('Please sign in to view collaboration matches', 'error');
        navigate('/');
        return;
      }

      const { data: artistProfile } = await supabase
        .from('artist_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!artistProfile) {
        showAlert('Artist profile not found', 'error');
        navigate('/create');
        return;
      }

      setArtistId(artistProfile.id);

      // Load matches
      const matchesData = await getCollaborationMatches(artistProfile.id);
      setMatches(matchesData);

      const nextRefresh = await getNextRefreshTime(artistProfile.id);
      setNextRefreshTime(nextRefresh);
      setHasAutoRefreshed(false);

      // Load unlock settings
      const settings = await getCollaborationUnlockSettings();
      setUnlockSettings(settings);

      // Load wallet balance
      const { data: wallet } = await supabase
        .from('treat_wallets')
        .select('balance')
        .eq('user_id', user.id)
        .single();
      setWalletBalance(wallet?.balance || 0);

      // Load unlocked artist IDs for current rotation
      if (settings && settings.isEnabled) {
        const rotationPeriod = new Date();
        const hours = rotationPeriod.getUTCHours();
        const rotationHour = Math.floor(hours / 6) * 6;
        const rotationStart = new Date(Date.UTC(
          rotationPeriod.getUTCFullYear(),
          rotationPeriod.getUTCMonth(),
          rotationPeriod.getUTCDate(),
          rotationHour,
          0,
          0,
          0
        ));

        const { data: unlocks } = await supabase
          .from('collaboration_unlocks')
          .select('artist_id')
          .eq('user_id', user.id)
          .eq('rotation_period', rotationStart.toISOString());

        if (unlocks) {
          setUnlockedArtistIds(new Set(unlocks.map(u => u.artist_id)));
          setTotalUnlockedCount(unlocks.length);
        }
      }
    } catch (error) {
      console.error('Error loading collaboration matches:', error);
      showAlert('Failed to load collaboration matches', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefreshMatches = async () => {
    if (!artistId || isRefreshing) return;

    setIsRefreshing(true);
    try {
      // Force clear cache and regenerate matches
      const matchesData = await getCollaborationMatches(artistId);
      setMatches(matchesData);

      const nextRefresh = await getNextRefreshTime(artistId);
      setNextRefreshTime(nextRefresh);
      setHasAutoRefreshed(false);

      if (matchesData.length > 0) {
        showAlert('Matches refreshed successfully!', 'success');
      } else {
        showAlert('No new matches found. Try uploading more content.', 'info');
      }
    } catch (error) {
      console.error('Error refreshing matches:', error);
      showAlert('Failed to refresh matches. Please try again.', 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleViewProfile = (userId: string) => {
    navigate(`/user/${userId}`);
  };

  const handleConnectClick = (match: CollaborationMatch) => {
    setSelectedMatch(match);
    setShowRequestModal(true);
    trackCollaborationInteraction(match.matchedArtist.id, 'interested');
  };

  const handleSendRequest = async () => {
    if (!selectedMatch || !requestMessage.trim()) {
      showAlert('Please enter a message', 'error');
      return;
    }

    setIsSending(true);
    try {
      const result = await sendCollaborationRequest(
        selectedMatch.matchedArtist.id,
        requestMessage,
        collabType
      );

      if (result.success) {
        showAlert('Collaboration request sent successfully!', 'success');
        setShowRequestModal(false);
        setRequestMessage('');
        setSelectedMatch(null);
        loadPendingRequestsCount();
      } else {
        showAlert(result.error || 'Failed to send request', 'error');
      }
    } catch (error) {
      console.error('Error sending collaboration request:', error);
      showAlert('Failed to send collaboration request', 'error');
    } finally {
      setIsSending(false);
    }
  };

  const handleUnlockClick = (match: CollaborationMatch) => {
    setSelectedUnlockMatch(match);
    setShowUnlockModal(true);
  };

  const handleUnlockConfirm = async () => {
    if (!selectedUnlockMatch) return;

    setIsUnlocking(true);
    try {
      // Use the matched artist's ID, not our own
      const result = await purchaseCollaborationUnlock(selectedUnlockMatch.matchedArtist.id);

      if (result.success) {
        // Add the unlocked artist to the set and increment count
        setUnlockedArtistIds(prev => new Set([...prev, selectedUnlockMatch.matchedArtist.id]));
        setTotalUnlockedCount(prev => prev + 1);

        setShowUnlockModal(false);
        setSelectedUnlockMatch(null);

        // Reload wallet balance
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: wallet } = await supabase
            .from('treat_wallets')
            .select('balance')
            .eq('user_id', user.id)
            .single();
          setWalletBalance(wallet?.balance || 0);
        }
      } else {
        showAlert(result.error || 'Failed to unlock match', 'error');
      }
    } catch (error) {
      console.error('Error unlocking match:', error);
      showAlert('Failed to unlock match', 'error');
    } finally {
      setIsUnlocking(false);
    }
  };

  const calculateBottomPadding = () => {
    const navBarHeight = 64;
    const miniPlayerHeight = 56;
    const adBannerHeight = 50;
    const baseSpacing = 32;

    let totalPadding = navBarHeight + baseSpacing;

    if (isMiniPlayerVisible) {
      totalPadding += miniPlayerHeight;

      if (document.body.classList.contains('ad-banner-active')) {
        totalPadding += adBannerHeight;
      }
    }

    return totalPadding;
  };

  const calculateModalBottomPadding = () => {
    const miniPlayerHeight = 64;
    const adBannerHeight = 60;
    const baseSpacing = 8;

    let totalPadding = baseSpacing;

    if (isMiniPlayerVisible) {
      totalPadding += miniPlayerHeight;

      if (document.body.classList.contains('ad-banner-active')) {
        totalPadding += adBannerHeight;
      }
    }

    return totalPadding;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000]" style={{ paddingBottom: `${calculateBottomPadding()}px` }}>
      <div className="sticky top-0 z-10 bg-[#0d0d0d]/95 backdrop-blur-xl border-b border-white/0">
        <div className="flex items-center gap-4 px-5 py-4">
          <div className="flex-1 min-w-0">
            <h1 className="font-['Inter',sans-serif] font-semibold text-white text-lg tracking-tight">
              Find Collaborators
            </h1>
            <p className="font-['Inter',sans-serif] text-gray-400 text-xs mt-0.5">
              AI-matched artists for you
            </p>
          </div>
          <button
            onClick={handleRefreshMatches}
            disabled={isRefreshing || isLoading}
            className="w-9 h-9 flex items-center justify-center hover:bg-white/5 rounded-full transition-all flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-5 h-5 text-white ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => navigate('/collaboration-inbox')}
            className="relative w-9 h-9 flex items-center justify-center hover:bg-white/5 rounded-full transition-all flex-shrink-0"
          >
            <Inbox className="w-5 h-5 text-white" />
            {pendingRequestsCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-gradient-to-r from-[#309605] to-[#3ba208] text-white text-xs font-bold rounded-full flex items-center justify-center border-2 border-[#0d0d0d] shadow-md shadow-[#309605]/20">
                {pendingRequestsCount > 9 ? '9+' : pendingRequestsCount}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="px-5 pt-5">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center min-h-[calc(100vh-250px)] py-12">
            <div className="w-12 h-12 border-3 border-white/10 border-t-white rounded-full animate-spin mb-4"></div>
            <p className="font-['Inter',sans-serif] text-gray-400 text-sm">
              Finding collaborators...
            </p>
          </div>
        ) : matches.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[calc(100vh-250px)] py-12">
            <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mb-4 transition-all duration-300">
              <Users className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="font-['Inter',sans-serif] font-semibold text-white text-base mb-2">
              No Matches Yet
            </h3>
            <p className="font-['Inter',sans-serif] text-gray-400 text-sm text-center max-w-xs mb-6 leading-relaxed">
              Upload more content and engage with the community to improve your matches
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleRefreshMatches}
                disabled={isRefreshing}
                className="px-6 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl font-['Inter',sans-serif] font-medium text-sm transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                {isRefreshing ? 'Refreshing...' : 'Refresh'}
              </button>
              <button
                onClick={() => navigate('/create')}
                className="px-6 py-2.5 bg-white text-black hover:bg-gray-100 rounded-xl font-['Inter',sans-serif] font-medium text-sm transition-all duration-200 active:scale-95"
              >
                Upload Content
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-4 mb-5">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Clock className="w-4.5 h-4.5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-['Inter',sans-serif] font-medium text-white text-sm mb-1">
                    Refreshes Every 6 Hours
                  </h3>
                  <p className="font-['Inter',sans-serif] text-gray-400 text-xs leading-relaxed mb-2">
                    {unlockSettings && unlockSettings.isEnabled
                      ? `${unlockSettings.freeMatchesCount} free match${unlockSettings.freeMatchesCount !== 1 ? 'es' : ''} per rotation. Unlock more for ${unlockSettings.unlockCostTreats} Treats.`
                      : 'Curated matches refresh automatically to keep things fresh.'
                    }
                  </p>
                  {timeUntilRefresh && (
                    <div className="flex items-center gap-2 mt-2.5">
                      <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></div>
                      <p className="font-['Inter',sans-serif] text-white text-xs font-medium">
                        Next in {timeUntilRefresh}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mb-5">
              <h2 className="font-['Inter',sans-serif] font-semibold text-white text-base mb-1">
                Your Matches
              </h2>
              <p className="font-['Inter',sans-serif] text-gray-400 text-xs">
                {(() => {
                  if (!unlockSettings || !unlockSettings.isEnabled) {
                    return `${matches.length} artist${matches.length !== 1 ? 's' : ''} available`;
                  }

                  // Count visible matches (free + unlocked)
                  const visibleCount = matches.filter((match, index) =>
                    index < unlockSettings.freeMatchesCount || unlockedArtistIds.has(match.matchedArtist.id)
                  ).length;

                  if (visibleCount === matches.length) {
                    return `${matches.length} artist${matches.length !== 1 ? 's' : ''} available`;
                  }

                  return `${visibleCount} of ${matches.length} unlocked`;
                })()}
              </p>
            </div>

            {(() => {
              // Determine free and locked matches based on settings
              if (!unlockSettings || !unlockSettings.isEnabled) {
                // Feature disabled, show all matches
                const allMatches = matches;
                return (
                  <>
                    {allMatches.map((match) => (
                      <div key={match.id} className="space-y-3 mb-4">
                        <CollaborationMatchCard
                          match={match}
                          onViewProfile={handleViewProfile}
                        />
                        <button
                          onClick={() => handleConnectClick(match)}
                          className="w-full py-3 bg-white text-black hover:bg-gray-100 rounded-xl font-['Inter',sans-serif] font-medium text-sm transition-all duration-200 active:scale-95 flex items-center justify-center gap-2"
                        >
                          <Send className="w-4 h-4" />
                          Send Request
                        </button>
                      </div>
                    ))}
                  </>
                );
              }

              // Feature enabled - separate free and potentially locked matches
              const freeMatches: CollaborationMatch[] = [];
              const lockedMatches: CollaborationMatch[] = [];
              const hasReachedMaxUnlocks = totalUnlockedCount >= unlockSettings.maxUnlockableMatches;

              matches.forEach((match, index) => {
                const isUnlocked = unlockedArtistIds.has(match.matchedArtist.id);
                const isFree = index < unlockSettings.freeMatchesCount;

                if (isFree || isUnlocked) {
                  freeMatches.push(match);
                } else {
                  lockedMatches.push(match);
                }
              });

              return (
                <>
                  {/* Free Matches */}
                  {freeMatches.map((match) => (
                    <div key={match.id} className="space-y-3 mb-4">
                      <CollaborationMatchCard
                        match={match}
                        onViewProfile={handleViewProfile}
                      />
                      <button
                        onClick={() => handleConnectClick(match)}
                        className="w-full py-3 bg-white text-black hover:bg-gray-100 rounded-xl font-['Inter',sans-serif] font-medium text-sm transition-all duration-200 active:scale-95 flex items-center justify-center gap-2"
                      >
                        <Send className="w-4 h-4" />
                        Send Request
                      </button>
                    </div>
                  ))}

                  {/* Max Unlocks Notice */}
                  {hasReachedMaxUnlocks && lockedMatches.length > 0 && (
                    <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-4 mb-4">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center flex-shrink-0">
                          <Sparkles className="w-4.5 h-4.5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-['Inter',sans-serif] font-medium text-white text-sm mb-1">
                            Max Unlocks Reached
                          </h3>
                          <p className="font-['Inter',sans-serif] text-gray-400 text-xs leading-relaxed">
                            You've unlocked {totalUnlockedCount}/{unlockSettings.maxUnlockableMatches} matches this rotation. More available after refresh.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Locked Matches */}
                  {lockedMatches.length > 0 && lockedMatches.map((match) => (
                    <div key={match.id} className="mb-4">
                      <LockedMatchCard
                        compatibilityScore={match.compatibilityScore}
                        unlockCost={unlockSettings.unlockCostTreats}
                        onUnlock={() => handleUnlockClick(match)}
                        isDisabled={hasReachedMaxUnlocks}
                      />
                    </div>
                  ))}
                </>
              );
            })()}
          </div>
        )}
      </div>

      {showRequestModal && selectedMatch && (
        <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-[#0d0d0d] rounded-t-3xl border-t border-white/10 shadow-2xl animate-in slide-in-from-bottom duration-300" style={{ marginBottom: `${calculateModalBottomPadding()}px` }}>
            <div className="p-6">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="font-['Inter',sans-serif] font-semibold text-white text-lg mb-1">
                    Send Request
                  </h2>
                  <p className="font-['Inter',sans-serif] text-gray-400 text-sm">
                    to {selectedMatch.matchedArtist.stageName}
                  </p>
                </div>
                <button
                  onClick={() => setShowRequestModal(false)}
                  className="w-8 h-8 flex items-center justify-center hover:bg-white/5 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="font-['Inter',sans-serif] text-white text-sm font-medium mb-2 block">
                    Collaboration Type
                  </label>
                  <select
                    value={collabType}
                    onChange={(e) => setCollabType(e.target.value)}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white font-['Inter',sans-serif] text-sm focus:outline-none focus:border-white/20 transition-colors"
                  >
                    <option value="feature">Feature</option>
                    <option value="remix">Remix</option>
                    <option value="joint_project">Joint Project</option>
                    <option value="production">Production</option>
                  </select>
                </div>

                <div>
                  <label className="font-['Inter',sans-serif] text-white text-sm font-medium mb-2 block">
                    Message
                  </label>
                  <textarea
                    value={requestMessage}
                    onChange={(e) => setRequestMessage(e.target.value)}
                    placeholder="Hey! I'd love to collaborate with you..."
                    rows={4}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white font-['Inter',sans-serif] text-sm placeholder:text-gray-500 focus:outline-none focus:border-white/20 transition-colors resize-none"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setShowRequestModal(false)}
                    className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-xl font-['Inter',sans-serif] font-medium text-white text-sm transition-all duration-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSendRequest}
                    disabled={isSending || !requestMessage.trim()}
                    className="flex-1 py-3 bg-white text-black hover:bg-gray-100 rounded-xl font-['Inter',sans-serif] font-medium text-sm transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isSending ? (
                      <>
                        <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        Send
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Unlock Modal */}
      {unlockSettings && selectedUnlockMatch && (
        <CollabUnlockModal
          isOpen={showUnlockModal}
          onClose={() => {
            setShowUnlockModal(false);
            setSelectedUnlockMatch(null);
          }}
          onConfirm={handleUnlockConfirm}
          unlockCost={unlockSettings.unlockCostTreats}
          currentBalance={walletBalance}
          compatibilityScore={selectedUnlockMatch.compatibilityScore}
          isProcessing={isUnlocking}
        />
      )}
    </div>
  );
};
