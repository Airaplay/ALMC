import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, Check, X, Send, Inbox, UserPlus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useAlert } from '../../contexts/AlertContext';

interface CollaborationRequest {
  id: string;
  senderArtistId: string;
  recipientArtistId: string;
  message: string;
  collabType: string;
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn';
  createdAt: string;
  updatedAt: string;
  senderArtist: {
    stageName: string;
    profilePhotoUrl: string | null;
    bio: string | null;
    isVerified: boolean;
  };
  recipientArtist: {
    stageName: string;
    profilePhotoUrl: string | null;
  };
}

export function CollaborationInboxScreen() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showAlert } = useAlert();
  const [activeTab, setActiveTab] = useState<'received' | 'sent'>('received');
  const [requests, setRequests] = useState<CollaborationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      verifyCreatorAccessAndLoadData();
    }
  }, [user, activeTab]);

  const verifyCreatorAccessAndLoadData = async () => {
    try {
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
      loadRequests();
      subscribeToRequests();
    } catch (error) {
      console.error('Error verifying creator access:', error);
      showAlert('An error occurred. Please try again.', 'error');
      navigate('/');
    }
  };

  const subscribeToRequests = () => {
    const channel = supabase
      .channel('collaboration_requests_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'collaboration_requests',
          filter: `recipient_user_id=eq.${user?.id}`
        },
        () => {
          loadRequests();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const loadRequests = async () => {
    if (!user) return;

    try {
      setLoading(true);

      const query = supabase
        .from('collaboration_requests')
        .select(`
          id,
          sender_artist_id,
          recipient_artist_id,
          message,
          collab_type,
          status,
          created_at,
          updated_at,
          sender_artist:artist_profiles!collaboration_requests_sender_artist_id_fkey(
            stage_name,
            profile_photo_url,
            bio,
            is_verified
          ),
          recipient_artist:artist_profiles!collaboration_requests_recipient_artist_id_fkey(
            stage_name,
            profile_photo_url
          )
        `)
        .order('created_at', { ascending: false });

      if (activeTab === 'received') {
        query.eq('recipient_user_id', user.id);
      } else {
        query.eq('sender_user_id', user.id);
      }

      const { data, error } = await query;

      if (error) throw error;

      const formattedRequests: CollaborationRequest[] = (data || []).map((req: any) => ({
        id: req.id,
        senderArtistId: req.sender_artist_id,
        recipientArtistId: req.recipient_artist_id,
        message: req.message,
        collabType: req.collab_type,
        status: req.status,
        createdAt: req.created_at,
        updatedAt: req.updated_at,
        senderArtist: {
          stageName: req.sender_artist?.stage_name || 'Unknown Artist',
          profilePhotoUrl: req.sender_artist?.profile_photo_url,
          bio: req.sender_artist?.bio,
          isVerified: req.sender_artist?.is_verified || false
        },
        recipientArtist: {
          stageName: req.recipient_artist?.stage_name || 'Unknown Artist',
          profilePhotoUrl: req.recipient_artist?.profile_photo_url
        }
      }));

      setRequests(formattedRequests);
    } catch (error) {
      console.error('Error loading requests:', error);
      showAlert('Failed to load collaboration requests', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async (requestId: string) => {
    setProcessingId(requestId);
    try {
      const request = requests.find(r => r.id === requestId);
      if (!request) return;

      const { error } = await supabase
        .from('collaboration_requests')
        .update({
          status: 'accepted',
          updated_at: new Date().toISOString()
        })
        .eq('id', requestId);

      if (error) throw error;

      const { data: senderUserData } = await supabase
        .from('artist_profiles')
        .select('user_id')
        .eq('id', request.senderArtistId)
        .single();

      if (senderUserData) {
        await supabase
          .from('notifications')
          .insert({
            user_id: senderUserData.user_id,
            title: 'Collaboration Request Accepted',
            message: `${request.recipientArtist.stageName} accepted your collaboration request!`,
            type: 'collaboration_accepted',
            is_read: false
          });
      }

      showAlert('Collaboration request accepted!', 'success');
      loadRequests();
    } catch (error) {
      console.error('Error accepting request:', error);
      showAlert('Failed to accept request', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleDecline = async (requestId: string) => {
    setProcessingId(requestId);
    try {
      const request = requests.find(r => r.id === requestId);
      if (!request) return;

      const { error } = await supabase
        .from('collaboration_requests')
        .update({
          status: 'declined',
          updated_at: new Date().toISOString()
        })
        .eq('id', requestId);

      if (error) throw error;

      const { data: senderUserData } = await supabase
        .from('artist_profiles')
        .select('user_id')
        .eq('id', request.senderArtistId)
        .single();

      if (senderUserData) {
        await supabase
          .from('notifications')
          .insert({
            user_id: senderUserData.user_id,
            title: 'Collaboration Request Declined',
            message: `${request.recipientArtist.stageName} declined your collaboration request`,
            type: 'collaboration_declined',
            is_read: false
          });
      }

      showAlert('Collaboration request declined', 'success');
      loadRequests();
    } catch (error) {
      console.error('Error declining request:', error);
      showAlert('Failed to decline request', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleWithdraw = async (requestId: string) => {
    setProcessingId(requestId);
    try {
      const { error } = await supabase
        .from('collaboration_requests')
        .update({
          status: 'withdrawn',
          updated_at: new Date().toISOString()
        })
        .eq('id', requestId);

      if (error) throw error;

      showAlert('Request withdrawn successfully', 'success');
      loadRequests();
    } catch (error) {
      console.error('Error withdrawing request:', error);
      showAlert('Failed to withdraw request', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) {
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      accepted: 'bg-green-500/20 text-green-400 border-green-500/30',
      declined: 'bg-red-500/20 text-red-400 border-red-500/30',
      withdrawn: 'bg-gray-500/20 text-gray-400 border-gray-500/30'
    };

    const icons = {
      pending: <Clock className="w-3 h-3" />,
      accepted: <Check className="w-3 h-3" />,
      declined: <X className="w-3 h-3" />,
      withdrawn: <X className="w-3 h-3" />
    };

    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${styles[status as keyof typeof styles]}`}>
        {icons[status as keyof typeof icons]}
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const getCollabTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      feature: 'Feature',
      remix: 'Remix',
      joint_project: 'Joint Project',
      sample: 'Sample',
      production: 'Production'
    };
    return labels[type] || type;
  };

  const pendingReceivedCount = requests.filter(r => r.status === 'pending' && activeTab === 'received').length;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] pb-24">
      <div className="sticky top-0 z-10 bg-[#0d0d0d]/95 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center gap-4 p-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-white/5 rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <div className="flex-1">
            <h1 className="font-['Inter',sans-serif] font-bold text-white text-xl">
              Collaboration Requests
            </h1>
            <p className="font-['Inter',sans-serif] text-white/50 text-sm">
              Manage your collaboration inbox
            </p>
          </div>
        </div>

        <div className="flex border-b border-white/5">
          <button
            onClick={() => setActiveTab('received')}
            className={`flex-1 px-4 py-3 font-['Inter',sans-serif] font-medium text-sm transition-colors relative ${
              activeTab === 'received'
                ? 'text-white'
                : 'text-white/50 hover:text-white/70'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <Inbox className="w-4 h-4" />
              Received
              {pendingReceivedCount > 0 && (
                <span className="bg-gradient-to-r from-[#309605] to-[#3ba208] text-white text-xs font-bold px-2 py-0.5 rounded-full shadow-md shadow-[#309605]/20">
                  {pendingReceivedCount}
                </span>
              )}
            </div>
            {activeTab === 'received' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('sent')}
            className={`flex-1 px-4 py-3 font-['Inter',sans-serif] font-medium text-sm transition-colors relative ${
              activeTab === 'sent'
                ? 'text-white'
                : 'text-white/50 hover:text-white/70'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <Send className="w-4 h-4" />
              Sent
            </div>
            {activeTab === 'sent' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />
            )}
          </button>
        </div>
      </div>

      <div className="p-4">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white/5 rounded-2xl p-4 animate-pulse">
                <div className="flex gap-4">
                  <div className="w-16 h-16 bg-white/10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-white/10 rounded w-1/3" />
                    <div className="h-3 bg-white/10 rounded w-full" />
                    <div className="h-3 bg-white/10 rounded w-2/3" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : requests.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
              {activeTab === 'received' ? (
                <Inbox className="w-10 h-10 text-white/30" />
              ) : (
                <Send className="w-10 h-10 text-white/30" />
              )}
            </div>
            <h3 className="font-['Inter',sans-serif] font-semibold text-white text-lg mb-2">
              No {activeTab === 'received' ? 'Received' : 'Sent'} Requests
            </h3>
            <p className="font-['Inter',sans-serif] text-white/50 text-sm">
              {activeTab === 'received'
                ? 'You have no collaboration requests yet'
                : 'You haven\'t sent any collaboration requests'}
            </p>
            <button
              onClick={() => navigate('/collaborate')}
              className="mt-6 px-6 py-3 bg-gradient-to-r from-[#309605] to-[#3ba208] hover:from-[#3ba208] hover:to-[#309605] text-white font-['Inter',sans-serif] font-semibold rounded-full transition-colors inline-flex items-center gap-2 shadow-lg shadow-[#309605]/25"
            >
              <UserPlus className="w-4 h-4" />
              Find Collaborators
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map(request => (
              <div
                key={request.id}
                className="bg-white/5 backdrop-blur-xl rounded-2xl p-4 border border-white/10 hover:border-white/20 transition-all"
              >
                <div className="flex gap-4">
                  <div className="relative flex-shrink-0">
                    {activeTab === 'received' ? (
                      <>
                        <img
                          src={request.senderArtist.profilePhotoUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${request.senderArtist.stageName}`}
                          alt={request.senderArtist.stageName}
                          className="w-16 h-16 rounded-full object-cover border-2 border-[#309605]/30"
                        />
                        {request.senderArtist.isVerified && (
                          <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-gradient-to-r from-[#309605] to-[#3ba208] rounded-full flex items-center justify-center border-2 border-[#0d0d0d]">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        )}
                      </>
                    ) : (
                      <img
                        src={request.recipientArtist.profilePhotoUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${request.recipientArtist.stageName}`}
                        alt={request.recipientArtist.stageName}
                        className="w-16 h-16 rounded-full object-cover border-2 border-white/20"
                      />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-['Inter',sans-serif] font-semibold text-white text-base truncate">
                          {activeTab === 'received'
                            ? request.senderArtist.stageName
                            : request.recipientArtist.stageName}
                        </h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-white/50 text-xs font-['Inter',sans-serif]">
                            {getCollabTypeLabel(request.collabType)}
                          </span>
                          <span className="text-white/30">•</span>
                          <span className="text-white/50 text-xs font-['Inter',sans-serif]">
                            {formatDate(request.createdAt)}
                          </span>
                        </div>
                      </div>
                      {getStatusBadge(request.status)}
                    </div>

                    {request.message && (
                      <p className="font-['Inter',sans-serif] text-white/70 text-sm mb-3 line-clamp-2">
                        {request.message}
                      </p>
                    )}

                    {activeTab === 'received' && request.status === 'pending' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAccept(request.id)}
                          disabled={processingId === request.id}
                          className="flex-1 px-4 py-2 bg-gradient-to-r from-[#309605] to-[#3ba208] hover:from-[#3ba208] hover:to-[#309605] text-white font-['Inter',sans-serif] font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-md shadow-[#309605]/20"
                        >
                          <Check className="w-4 h-4" />
                          Accept
                        </button>
                        <button
                          onClick={() => handleDecline(request.id)}
                          disabled={processingId === request.id}
                          className="flex-1 px-4 py-2 bg-white/10 hover:bg-white/20 text-white font-['Inter',sans-serif] font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                          <X className="w-4 h-4" />
                          Decline
                        </button>
                      </div>
                    )}

                    {activeTab === 'sent' && request.status === 'pending' && (
                      <button
                        onClick={() => handleWithdraw(request.id)}
                        disabled={processingId === request.id}
                        className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white font-['Inter',sans-serif] font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        <X className="w-4 h-4" />
                        Withdraw Request
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
