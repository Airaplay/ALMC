import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, ArrowLeft, AlertCircle, Users, ChevronRight, ListMusic } from 'lucide-react';
import { CreatorUploadOptions } from '../../components/CreatorUploadOptions';
import VideoUploadForm from '../../components/VideoUploadForm';
import SingleUploadForm from '../../components/SingleUploadForm';
import AlbumUploadForm from '../../components/AlbumUploadForm';
import { AuthModal } from '../../components/AuthModal';
import { CollaborationMatchCard } from '../../components/CollaborationMatchCard';
import { CreatePlaylistModal } from '../../components/CreatePlaylistModal';
import { supabase, getUserRole, getArtistProfile } from '../../lib/supabase';
import { useUpload } from '../../contexts/UploadContext';
import { getCollaborationMatches, CollaborationMatch } from '../../lib/collaborationMatchingService';
import { useAuth } from '../../contexts/AuthContext';

interface CreateScreenProps {
  onFormVisibilityChange?: (isVisible: boolean) => void;
}

export const CreateScreen = ({ onFormVisibilityChange }: CreateScreenProps): JSX.Element => {
  const navigate = useNavigate();
  const { onModalClose } = useUpload();
  const { isAuthenticated: authIsAuthenticated, isInitialized } = useAuth();
  const [userRole, setUserRole] = useState<string | null>(null);
  const [artistProfile, setArtistProfile] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showArtistForm, setShowArtistForm] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalDismissed, setAuthModalDismissed] = useState(false);
  const [selectedUploadType, setSelectedUploadType] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [recentUploads, setRecentUploads] = useState<any[]>([]);
  const [collaborationMatches, setCollaborationMatches] = useState<CollaborationMatch[]>([]);
  const [isLoadingMatches, setIsLoadingMatches] = useState(false);
  const [showCreatePlaylistModal, setShowCreatePlaylistModal] = useState(false);

  // Handle form visibility changes (exclude auth modal - it's handled globally)
  useEffect(() => {
    const isAnyFormOpen = showArtistForm ||
                         !!selectedUploadType ||
                         showCreatePlaylistModal;
    onFormVisibilityChange?.(isAnyFormOpen);
  }, [showArtistForm, selectedUploadType, showCreatePlaylistModal, onFormVisibilityChange]);

  // Sync upload form closing with progress modal closing
  useEffect(() => {
    const cleanup = onModalClose(() => {
      // Close any open upload form when progress modal closes
      if (selectedUploadType) {
        setSelectedUploadType(null);
      }
    });

    return cleanup;
  }, [onModalClose, selectedUploadType]);

  useEffect(() => {
    checkAuthAndLoadUserData();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        checkAuthAndLoadUserData();
      } else if (event === 'SIGNED_OUT') {
        setUserRole(null);
        setArtistProfile(null);
        setRecentUploads([]);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Navigate to artist registration screen
  useEffect(() => {
    if (showArtistForm) {
      navigate('/become-artist');
      setShowArtistForm(false);
    }
  }, [showArtistForm, navigate]);

  // Load collaboration matches when artist profile is available
  useEffect(() => {
    if (artistProfile?.id && (userRole === 'creator')) {
      // Small delay to ensure screen renders first
      const timer = setTimeout(() => {
        loadCollaborationMatches(artistProfile.id);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [artistProfile?.id, userRole]);

  // Auto-open auth modal for unauthenticated users (only if not dismissed)
  useEffect(() => {
    if (isInitialized && !authIsAuthenticated && !showAuthModal && !authModalDismissed) {
      setShowAuthModal(true);
    }
  }, [isInitialized, authIsAuthenticated]);

  const checkAuthAndLoadUserData = async () => {
    try {
      setConnectionError(null);

      // Use enhanced session getter that automatically refreshes expired sessions
      // In mobile apps, users stay signed in until they explicitly log out
      const { getAuthenticatedSession } = await import('../../lib/supabase');
      const { session, error: authError } = await getAuthenticatedSession();

      if (authError) {
        if (authError.message?.includes('Invalid Refresh Token') ||
            authError.message?.includes('refresh_token_not_found') ||
            authError.message === 'Auth session missing!') {
          console.log('[CreateScreen] No valid session - user not signed in');
          setIsLoading(false);
          return;
        }

        console.warn('[CreateScreen] Auth error but keeping state:', authError.message);
        setConnectionError('Unable to connect to authentication service. Please check your internet connection.');
        setIsLoading(false);
        return;
      }

      if (!session || !session.user) {
        setIsLoading(false);
        return;
      }
      const user = session.user;
      // Check if user exists in our users table, if not create them
      try {
        const { data: existingUser, error: userError } = await supabase
          .from('users')
          .select('id')
          .eq('id', user.id)
          .single();

        if (userError && userError.code !== 'PGRST116') {
          console.error('Error checking user:', userError);
          setConnectionError('Unable to load user data. Please try again.');
          setIsLoading(false);
          return;
        }

        if (!existingUser) {
          // Create user record
          const { error: insertError } = await supabase
            .from('users')
            .insert({
              id: user.id,
              email: user.email || '',
              display_name: user.user_metadata?.display_name || null,
              role: 'listener',
            });

          if (insertError) {
            console.error('Error creating user:', insertError);
            setConnectionError('Unable to create user profile. Please try again.');
            setIsLoading(false);
            return;
          }
        }
      } catch (error) {
        console.error('Network error checking/creating user:', error);
        setConnectionError('Network error. Please check your connection and try again.');
        setIsLoading(false);
        return;
      }

      const role = await getUserRole();
      const profile = await getArtistProfile();

      setUserRole(role);
      setArtistProfile(profile);
      loadRecentUploads();

      // Collaboration matches will be loaded by the useEffect
    } catch (error) {
      console.error('Error loading user data:', error);
      setConnectionError('Unable to connect to the server. Please check your internet connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };


  const handleUploadSuccess = () => {
    setSelectedUploadType(null);
    loadRecentUploads(); // Refresh recent uploads
  };

  const loadRecentUploads = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data, error } = await supabase
        .from('content_uploads')
        .select('id, title, content_type, created_at')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(3);

      if (error) throw error;
      setRecentUploads(data || []);
    } catch (error) {
      console.error('Error loading recent uploads:', error);
    }
  };

  const loadCollaborationMatches = async (artistProfileId: string) => {
    setIsLoadingMatches(true);
    try {
      const matches = await getCollaborationMatches(artistProfileId);
      setCollaborationMatches(matches.slice(0, 3));
    } catch (error) {
      console.error('Error loading collaboration matches:', error);
    } finally {
      setIsLoadingMatches(false);
    }
  };

  const handleAuthSuccess = () => {
    setShowAuthModal(false);
    checkAuthAndLoadUserData();
  };

  const handleRetry = () => {
    setIsLoading(true);
    checkAuthAndLoadUserData();
  };

  const getUploadTypeTitle = (type: string): string => {
    switch (type) {
      case 'single':
        return 'Single';
      case 'album':
        return 'Album/EP';
      case 'mix':
        return 'Mix';
      case 'video':
        return 'Video';
      default:
        return type.charAt(0).toUpperCase() + type.slice(1);
    }
  };

  if (connectionError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen overflow-y-auto bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] content-with-nav px-6">
        <div className="w-full max-w-md p-8 bg-white/5 backdrop-blur-sm border border-red-500/20 rounded-2xl text-center">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="font-bold text-white text-xl mb-4">
            Connection Error
          </h2>
          <p className="text-white/70 text-sm mb-6 leading-relaxed">
            {connectionError}
          </p>
          <button
            onClick={handleRetry}
            className="w-full h-12 bg-gradient-to-r from-[#309605] to-[#3ba208] hover:from-[#3ba208] hover:to-[#309605] rounded-xl font-medium text-white transition-all duration-200 shadow-lg"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!authIsAuthenticated && isInitialized && !isLoading) {
    if (!showAuthModal && !authModalDismissed) {
      setShowAuthModal(true);
    } else if (authModalDismissed) {
      navigate('/');
      return null;
    }

    return (
      <>
        <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] content-with-nav">
          {null}
        </div>

        {showAuthModal && (
          <AuthModal
            onClose={() => {
              setShowAuthModal(false);
              setAuthModalDismissed(true);
              onFormVisibilityChange?.(false);
              navigate('/');
            }}
            onSuccess={handleAuthSuccess}
          />
        )}
      </>
    );
  }

  if (selectedUploadType) {
    return (
      <div className="flex flex-col content-with-nav min-h-screen overflow-y-auto bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white px-5 py-4">
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => setSelectedUploadType(null)}
            className="p-2 hover:bg-white/10 rounded-full transition-all duration-200"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="font-bold text-lg">
            Upload {getUploadTypeTitle(selectedUploadType)}
          </h1>
        </div>

        {selectedUploadType === 'single' && (
          <SingleUploadForm
            onClose={() => setSelectedUploadType(null)}
            onSuccess={handleUploadSuccess}
          />
        )}

        {selectedUploadType === 'album' && (
          <AlbumUploadForm
            onClose={() => setSelectedUploadType(null)}
            onSuccess={handleUploadSuccess}
          />
        )}

        {selectedUploadType === 'video' && (
          <VideoUploadForm
            onClose={() => setSelectedUploadType(null)}
            onSuccess={handleUploadSuccess}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen min-h-[100dvh] overflow-y-auto bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white content-with-nav">
      <header className="w-full py-5 px-5 sticky top-0 z-20 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-sm">
        {isLoading || !isInitialized ? (
          <div>
            <div className="h-3 w-28 bg-white/10 rounded animate-pulse mb-3" />
            <div className="h-9 w-56 bg-white/10 rounded animate-pulse mb-2" />
            <div className="h-4 w-36 bg-white/10 rounded animate-pulse" />
          </div>
        ) : userRole === 'creator' && artistProfile ? (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60 mb-3">
              Creator Studio
            </p>
            <h1 className="text-4xl xl:text-5xl font-black tracking-tight text-white leading-none mb-1">
              Ready to create,
            </h1>
            <p className="text-white/80 font-light">
              {artistProfile.stage_name}
            </p>
          </div>
        ) : userRole === 'listener' ? (
          <div>
            <h1 className="text-4xl xl:text-5xl font-black tracking-tight text-white leading-none mb-2">
              Start creating.
            </h1>
            <p className="text-white/80 font-light text-sm leading-relaxed">
              You're set up as a listener. Start creating your favorite Playlist or Register as an artist to unlock uploads and collaborations.
            </p>
          </div>
        ) : null}
      </header>

      <div className="flex-1 px-5 py-6 space-y-5 pb-24">
        {(isLoading || !isInitialized) && (
          <>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 bg-white/5 rounded-2xl animate-pulse" />
            ))}
          </>
        )}
        {!isLoading && isInitialized && userRole === 'listener' && (
          <>
            {/* Create Playlist Card */}
            <div
              onClick={() => setShowCreatePlaylistModal(true)}
              className="relative overflow-hidden p-6 bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-sm border border-white/10 rounded-2xl cursor-pointer active:scale-[0.98] transition-all duration-200 group"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-[#309605]/10 to-transparent opacity-0 group-active:opacity-100 transition-opacity pointer-events-none"></div>

              <div className="relative flex items-start gap-4">
                <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg shadow-white/20">
                  <ListMusic className="w-7 h-7 text-black" />
                </div>
                <div className="flex-1 pt-0.5">
                  <h3 className="font-bold text-white text-base mb-1.5">
                    Create Playlist
                  </h3>
                  <p className="text-gray-400 text-sm leading-relaxed">
                    Organize your favorite songs into playlists
                  </p>
                </div>
              </div>
            </div>

            {/* Become an Artist Card */}
            <div
              onClick={() => setShowArtistForm(true)}
              className="relative overflow-hidden p-6 bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-sm border border-white/10 rounded-2xl cursor-pointer active:scale-[0.98] transition-all duration-200 group"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-[#309605]/10 to-transparent opacity-0 group-active:opacity-100 transition-opacity pointer-events-none"></div>

              <div className="relative flex items-start gap-4">
                <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg shadow-white/20">
                  <Star className="w-7 h-7 text-black" />
                </div>
                <div className="flex-1 pt-0.5">
                  <h3 className="font-bold text-white text-base mb-1.5">
                    Become an Artist
                  </h3>
                  <p className="text-gray-400 text-sm leading-relaxed mb-3">
                    Share your music with the world. Upload singles, albums, and videos
                  </p>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/10 backdrop-blur-sm rounded-full">
                    <span className="text-white text-xs font-medium">
                      Free Registration
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {!isLoading && isInitialized && (userRole === 'creator') && (
          <>
            {artistProfile && (
              <div className="p-5 bg-white/[0.03] backdrop-blur-sm border border-white/10 rounded-2xl">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Users className="w-4.5 h-4.5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-white text-sm">
                        Find Collaborators
                      </h3>
                      <p className="text-gray-400 text-xs">
                        {isLoadingMatches ? 'Loading...' : 'AI-matched artists'}
                      </p>
                    </div>
                  </div>
                  {!isLoadingMatches && collaborationMatches.length > 0 && (
                    <button
                      onClick={() => navigate('/collaborate')}
                      className="flex items-center gap-1 px-3 py-2 bg-white/10 active:bg-white/20 rounded-xl transition-colors min-h-[44px]"
                    >
                      <span className="text-white text-xs font-medium whitespace-nowrap">
                        View All
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-white" />
                    </button>
                  )}
                </div>

                {isLoadingMatches ? (
                  <div className="flex gap-3 overflow-x-auto pb-2 -mx-5 px-5 scrollbar-hide">
                    {Array.from({ length: 2 }).map((_, i) => (
                      <div key={i} className="flex-shrink-0 w-[240px]">
                        <div className="p-3 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl">
                          <div className="flex items-start gap-2.5 mb-2.5">
                            <div className="w-10 h-10 bg-white/10 rounded-lg animate-pulse" />
                            <div className="flex-1 space-y-1.5">
                              <div className="h-3.5 bg-white/10 rounded animate-pulse w-3/4" />
                              <div className="h-3 bg-white/10 rounded animate-pulse w-1/2" />
                            </div>
                          </div>
                          <div className="space-y-1.5 mb-2.5">
                            <div className="h-2.5 bg-white/10 rounded animate-pulse" />
                            <div className="h-2.5 bg-white/10 rounded animate-pulse w-5/6" />
                          </div>
                          <div className="flex gap-1.5">
                            <div className="h-5 w-14 bg-white/10 rounded-full animate-pulse" />
                            <div className="h-5 w-16 bg-white/10 rounded-full animate-pulse" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : collaborationMatches.length > 0 ? (
                  <div className="flex gap-3 overflow-x-auto pb-2 -mx-5 px-5 scrollbar-hide snap-x snap-mandatory">
                    {collaborationMatches.map((match) => (
                      <div key={match.id} className="snap-start">
                        <CollaborationMatchCard
                          match={match}
                          onViewProfile={(userId) => navigate(`/user/${userId}`)}
                          compact
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-gray-400 text-xs mb-3 leading-relaxed px-4">
                      Upload content to get AI-matched with collaborators
                    </p>
                    <button
                      onClick={() => navigate('/collaborate')}
                      className="px-4 py-2 bg-white/10 active:bg-white/20 rounded-lg font-medium text-white text-xs transition-colors"
                    >
                      Learn More
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Create Playlist Card for Creators */}
            <div
              onClick={() => setShowCreatePlaylistModal(true)}
              className="relative overflow-hidden p-5 bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-sm border border-white/10 rounded-2xl cursor-pointer active:scale-[0.98] transition-all duration-200 group"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-[#309605]/10 to-transparent opacity-0 group-active:opacity-100 transition-opacity pointer-events-none"></div>

              <div className="relative flex items-start gap-3.5">
                <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg shadow-white/20">
                  <ListMusic className="w-6 h-6 text-black" />
                </div>
                <div className="flex-1 pt-0.5">
                  <h3 className="font-bold text-white text-sm mb-1">
                    Create Playlist
                  </h3>
                  <p className="text-gray-400 text-xs leading-relaxed">
                    Organize your favorite songs
                  </p>
                </div>
              </div>
            </div>

            {/* Upload Options */}
            <CreatorUploadOptions onSelectUploadType={setSelectedUploadType} />

            {recentUploads.length > 0 && (
              <div className="p-5 bg-white/[0.03] backdrop-blur-sm border border-white/10 rounded-2xl">
                <h3 className="font-bold text-white text-sm mb-4">
                  Recent Uploads
                </h3>
                <div className="space-y-2.5">
                  {recentUploads.map((upload) => (
                    <div key={upload.id} className="p-3.5 bg-white/[0.05] rounded-xl active:bg-white/[0.12] transition-colors duration-200 min-h-[44px] flex flex-col justify-center">
                      <p className="font-medium text-white text-sm truncate mb-1">
                        {upload.title}
                      </p>
                      <p className="text-gray-400 text-xs">
                        {upload.content_type.charAt(0).toUpperCase() + upload.content_type.slice(1)} • {new Date(upload.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create Playlist Modal */}
      {showCreatePlaylistModal && (
        <CreatePlaylistModal
          onClose={() => setShowCreatePlaylistModal(false)}
          onSuccess={() => {
            setShowCreatePlaylistModal(false);
          }}
        />
      )}
    </div>
  );
};