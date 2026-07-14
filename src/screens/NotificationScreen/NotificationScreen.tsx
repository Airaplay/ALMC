import { useState, useEffect, useMemo, useCallback } from 'react';
import { Spinner } from '../../components/Spinner';
import { ArrowLeft, Send, DollarSign, XCircle, CheckCircle, FileText, AlertCircle, X, Trash2, MessageCircle, CheckCheck, UserPlus, Users, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { persistentCache } from '../../lib/persistentCache';
import { insertNotificationSafe } from '../../lib/notificationService';

const NOTIFICATIONS_CACHE_TTL = 2 * 60 * 1000; // 2 minutes
import { formatDistanceToNow, isToday, isYesterday, isThisWeek } from 'date-fns';
import { CustomConfirmDialog } from '../../components/CustomConfirmDialog';
import { ToastNotification } from '../../components/ToastNotification';

interface Notification {
  id: string;
  user_id: string;
  type: string;
  message: string;
  metadata: any;
  is_read: boolean;
  created_at: string;
  message_id?: string;
  thread_id?: string;
  sender_id?: string;
  sender?: {
    id: string;
    display_name: string;
    username: string | null;
    avatar_url: string | null;
  };
}

export const NotificationScreen = () => {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'all' | 'unread'>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [notificationToDelete, setNotificationToDelete] = useState<Notification | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [processingCollabRequestId, setProcessingCollabRequestId] = useState<string | null>(null);
  const [showConfirmDeleteAll, setShowConfirmDeleteAll] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  useEffect(() => {
    fetchNotifications();
    setupRealtimeSubscription();

    return () => {
      const channel = supabase.channel('notifications');
      channel.unsubscribe();
    };
  }, []);

  const setupRealtimeSubscription = () => {
    const channel = supabase
      .channel('notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
        },
        async (payload) => {
          const newNotif = payload.new as any;

          let sender = null;
          if ((newNotif.type === 'message' || newNotif.type === 'reply') && newNotif.sender_id) {
            const { data: senderData } = await supabase
              .from('users')
              .select('id, display_name, username, avatar_url')
              .eq('id', newNotif.sender_id)
              .maybeSingle();
            sender = senderData;
          }

          setNotifications(prev => [{ ...newNotif, sender }, ...prev]);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
        },
        (payload) => {
          const updated = payload.new as any;
          setNotifications(prev => prev.map(n => n.id === updated.id ? { ...n, ...updated } : n));
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'notifications',
        },
        (payload) => {
          const deleted = payload.old as any;
          setNotifications(prev => prev.filter(n => n.id !== deleted.id));
        }
      )
      .subscribe();
  };

  const fetchNotifications = async () => {
    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setIsLoading(false);
        return;
      }

      const cacheKey = `notifications_list_${user.id}`;
      const cached = await persistentCache.get<Notification[]>(cacheKey);
      if (cached && Array.isArray(cached)) {
        setNotifications(cached);
        setIsLoading(false);
        // Background revalidate
        fetchNotificationsInner(user.id, cacheKey).then((list) => {
          if (list) {
            setNotifications(list);
            persistentCache.set(cacheKey, list, NOTIFICATIONS_CACHE_TTL).catch(() => {});
          }
        }).catch(() => {});
        return;
      }

      const list = await fetchNotificationsInner(user.id, cacheKey);
      if (list) {
        setNotifications(list);
        await persistentCache.set(cacheKey, list, NOTIFICATIONS_CACHE_TTL);
      }
    } catch (err) {
      console.error('Error fetching notifications:', err);
      setToast({
        message: 'Failed to load notifications',
        type: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchNotificationsInner = async (userId: string, cacheKey: string): Promise<Notification[] | null> => {
    try {
      const { data, error: fetchError } = await supabase
        .from('notifications')
        .select(`
          *,
          sender:users!sender_id(
            id,
            display_name,
            username,
            avatar_url
          )
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (fetchError) {
        const { data: notificationsData, error: notifError } = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });

        if (notifError) throw notifError;

        const senderIds = [...new Set(
          (notificationsData || [])
            .filter((n: any) => (n.type === 'message' || n.type === 'reply') && n.sender_id)
            .map((n: any) => n.sender_id)
        )];

        const { data: sendersData } = await supabase
          .from('users')
          .select('id, display_name, username, avatar_url')
          .in('id', senderIds);

        const sendersMap = new Map(sendersData?.map((s: any) => [s.id, s]) || []);
        return (notificationsData || []).map((notif: any) => ({
          ...notif,
          sender: sendersMap.get(notif.sender_id) || null,
        }));
      }

      const transformedData = (data || []).map((notif: any) => ({
        ...notif,
        sender: notif.sender || null,
      }));
      return transformedData;
    } catch (err) {
      console.error('Error fetching notifications:', err);
      return null;
    }
  };

  const markAsRead = useCallback(async (id: string) => {
    setNotifications(prev => prev.map(notif =>
      notif.id === id ? { ...notif, is_read: true } : notif
    ));

    try {
      const { error: updateError } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id);

      if (updateError) throw updateError;
    } catch (err) {
      console.error('Error marking notification as read:', err);
      setNotifications(prev => prev.map(notif =>
        notif.id === id ? { ...notif, is_read: false } : notif
      ));
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setIsMarkingAllRead(true);
    setNotifications(prev => prev.map(notif => ({ ...notif, is_read: true })));

    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', user.id)
        .eq('is_read', false);

      if (error) throw error;

      setToast({
        message: 'All notifications marked as read',
        type: 'success',
      });
    } catch (err) {
      console.error('Error marking all as read:', err);
      fetchNotifications();
      setToast({
        message: 'Failed to mark all as read',
        type: 'error',
      });
    } finally {
      setIsMarkingAllRead(false);
    }
  }, []);

  const handleAcceptCollabRequest = async (notif: Notification, e: React.MouseEvent) => {
    e.stopPropagation();

    const requestId = notif.metadata?.request_id;
    if (!requestId) {
      setToast({ message: 'Invalid request', type: 'error' });
      return;
    }

    setProcessingCollabRequestId(requestId);

    try {
      const { data: request } = await supabase
        .from('collaboration_requests')
        .select(`
          sender_artist_id,
          recipient_artist_id,
          sender_artist:artist_profiles!collaboration_requests_sender_artist_id_fkey(stage_name),
          recipient_artist:artist_profiles!collaboration_requests_recipient_artist_id_fkey(stage_name)
        `)
        .eq('id', requestId)
        .single();

      if (!request) throw new Error('Request not found');

      const { error: updateError } = await supabase
        .from('collaboration_requests')
        .update({
          status: 'accepted',
          updated_at: new Date().toISOString()
        })
        .eq('id', requestId);

      if (updateError) throw updateError;

      const { data: senderUserData } = await supabase
        .from('artist_profiles')
        .select('user_id')
        .eq('id', request.sender_artist_id)
        .single();

      if (senderUserData) {
        await insertNotificationSafe({
          user_id: senderUserData.user_id,
          title: 'Collaboration Request Accepted',
          message: `${request.recipient_artist?.stage_name || 'An artiste'} accepted your collaboration request!`,
          type: 'collaboration_accepted',
          is_read: false
        });
      }

      await supabase
        .from('notifications')
        .delete()
        .eq('id', notif.id);

      setToast({ message: 'Collaboration request accepted!', type: 'success' });
      fetchNotifications();
    } catch (error) {
      console.error('Error accepting collaboration request:', error);
      setToast({ message: 'Failed to accept request', type: 'error' });
    } finally {
      setProcessingCollabRequestId(null);
    }
  };

  const handleDeclineCollabRequest = async (notif: Notification, e: React.MouseEvent) => {
    e.stopPropagation();

    const requestId = notif.metadata?.request_id;
    if (!requestId) {
      setToast({ message: 'Invalid request', type: 'error' });
      return;
    }

    setProcessingCollabRequestId(requestId);

    try {
      const { data: request } = await supabase
        .from('collaboration_requests')
        .select(`
          sender_artist_id,
          recipient_artist_id,
          sender_artist:artist_profiles!collaboration_requests_sender_artist_id_fkey(stage_name),
          recipient_artist:artist_profiles!collaboration_requests_recipient_artist_id_fkey(stage_name)
        `)
        .eq('id', requestId)
        .single();

      if (!request) throw new Error('Request not found');

      const { error: updateError } = await supabase
        .from('collaboration_requests')
        .update({
          status: 'declined',
          updated_at: new Date().toISOString()
        })
        .eq('id', requestId);

      if (updateError) throw updateError;

      const { data: senderUserData } = await supabase
        .from('artist_profiles')
        .select('user_id')
        .eq('id', request.sender_artist_id)
        .single();

      if (senderUserData) {
        await insertNotificationSafe({
          user_id: senderUserData.user_id,
          title: 'Collaboration Request Declined',
          message: `${request.recipient_artist?.stage_name || 'An artiste'} declined your collaboration request`,
          type: 'collaboration_declined',
          is_read: false
        });
      }

      await supabase
        .from('notifications')
        .delete()
        .eq('id', notif.id);

      setToast({ message: 'Request declined', type: 'success' });
      fetchNotifications();
    } catch (error) {
      console.error('Error declining collaboration request:', error);
      setToast({ message: 'Failed to decline request', type: 'error' });
    } finally {
      setProcessingCollabRequestId(null);
    }
  };

  const handleNotificationClick = (notif: Notification) => {
    if (!notif.is_read) {
      markAsRead(notif.id);
    }

    if ((notif.type === 'message' || notif.type === 'reply') && notif.thread_id) {
      navigate(`/messages/${notif.thread_id}`);
    } else if (notif.type === 'collaboration_request' || notif.type === 'collaboration_accepted' || notif.type === 'collaboration_declined') {
      navigate('/collaboration-inbox');
    }
  };

  const handleDeleteClick = (notif: Notification, e: React.MouseEvent) => {
    e.stopPropagation();
    setNotificationToDelete(notif);
    setShowConfirmDelete(true);
  };

  const handleConfirmDelete = async () => {
    if (!notificationToDelete) return;

    setDeletingId(notificationToDelete.id);
    setShowConfirmDelete(false);

    try {
      // Check if this is a collapsed message notification with multiple IDs
      const allIds = notificationToDelete.metadata?.allNotificationIds;

      if (allIds && allIds.length > 1) {
        // Delete all notifications from this conversation
        const { error } = await supabase
          .from('notifications')
          .delete()
          .in('id', allIds);

        if (error) throw error;

        setNotifications(prev => prev.filter(notif => !allIds.includes(notif.id)));
        setToast({
          message: `Deleted ${allIds.length} notifications`,
          type: 'success',
        });
      } else {
        // Delete single notification
        const { error } = await supabase
          .from('notifications')
          .delete()
          .eq('id', notificationToDelete.id);

        if (error) throw error;

        setNotifications(prev => prev.filter(notif => notif.id !== notificationToDelete.id));
        setToast({
          message: 'Notification deleted',
          type: 'success',
        });
      }
    } catch (err) {
      console.error('Error deleting notification:', err);
      setToast({
        message: 'Failed to delete notification',
        type: 'error',
      });
    } finally {
      setDeletingId(null);
      setNotificationToDelete(null);
    }
  };

  const handleDeleteAllNotifications = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setShowConfirmDeleteAll(false);
    setIsDeletingAll(true);

    try {
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('user_id', user.id);

      if (error) throw error;

      setNotifications([]);
      setToast({
        message: 'All notifications deleted',
        type: 'success',
      });
    } catch (err) {
      console.error('Error deleting all notifications:', err);
      setToast({
        message: 'Failed to delete all notifications',
        type: 'error',
      });
    } finally {
      setIsDeletingAll(false);
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'message':
      case 'reply':
        return <MessageCircle className="w-5 h-5 text-[#309605]" />;
      case 'collaboration_request':
        return <UserPlus className="w-5 h-5 text-[#309605]" />;
      case 'collaboration_accepted':
        return <Users className="w-5 h-5 text-green-400" />;
      case 'collaboration_declined':
        return <XCircle className="w-5 h-5 text-orange-400" />;
      case 'donation':
      case 'donation_successful':
        return <Send className="w-5 h-5 text-green-400" />;
      case 'deposit':
      case 'usdt_deposit':
        return <DollarSign className="w-5 h-5 text-blue-400" />;
      case 'donation_cancelled':
      case 'cancelled':
        return <XCircle className="w-5 h-5 text-red-400" />;
      case 'campaign':
      case 'campaign_completed':
        return <CheckCircle className="w-5 h-5 text-orange-400" />;
      case 'campaign_published':
      case 'ongoing':
        return <FileText className="w-5 h-5 text-orange-400" />;
      default:
        return <AlertCircle className="w-5 h-5 text-gray-400" />;
    }
  };

  const getNotificationColor = (type: string) => {
    switch (type.toLowerCase()) {
      case 'message':
      case 'reply':
        return 'bg-[#309605]/10';
      case 'collaboration_request':
        return 'bg-[#309605]/10';
      case 'collaboration_accepted':
        return 'bg-green-500/10';
      case 'collaboration_declined':
        return 'bg-orange-500/10';
      case 'donation':
      case 'donation_successful':
        return 'bg-green-500/10';
      case 'deposit':
      case 'usdt_deposit':
        return 'bg-blue-500/10';
      case 'donation_cancelled':
      case 'cancelled':
        return 'bg-red-500/10';
      case 'campaign':
      case 'campaign_completed':
      case 'campaign_published':
      case 'ongoing':
        return 'bg-orange-500/10';
      default:
        return 'bg-gray-500/10';
    }
  };

  const getNotificationTitle = (notif: Notification) => {
    if ((notif.type === 'message' || notif.type === 'reply') && notif.sender) {
      return notif.sender.display_name || notif.sender.username || 'Someone';
    }

    const message = notif.message;
    const firstLine = message.split('\n')[0] || message.substring(0, 50);
    return firstLine;
  };

  const getNotificationDescription = (notif: Notification) => {
    if (notif.type === 'message' || notif.type === 'reply') {
      return notif.message;
    }

    const message = notif.message;
    const lines = message.split('\n');
    return lines.length > 1 ? lines.slice(1).join(' ') : message.substring(50);
  };

  const collapseMessageNotifications = useCallback((notifs: Notification[]): Notification[] => {
    // Group message notifications by sender (conversation)
    const messagesByConversation = new Map<string, Notification[]>();
    const otherNotifications: Notification[] = [];

    notifs.forEach(notif => {
      if (notif.type === 'message' || notif.type === 'reply') {
        const conversationKey = notif.thread_id || notif.sender_id || 'unknown';
        if (!messagesByConversation.has(conversationKey)) {
          messagesByConversation.set(conversationKey, []);
        }
        messagesByConversation.get(conversationKey)!.push(notif);
      } else {
        otherNotifications.push(notif);
      }
    });

    // For each conversation, keep only the latest message but track unread count
    const collapsedMessages: Notification[] = [];
    messagesByConversation.forEach((messages) => {
      // Sort by created_at descending (latest first)
      const sortedMessages = messages.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      const latestMessage = sortedMessages[0];
      const unreadCount = messages.filter(m => !m.is_read).length;

      // Add unread count to metadata for display
      collapsedMessages.push({
        ...latestMessage,
        metadata: {
          ...latestMessage.metadata,
          unreadCount,
          totalMessages: messages.length,
          allNotificationIds: messages.map(m => m.id), // For batch deletion
        },
      });
    });

    // Combine and sort all notifications by created_at
    return [...collapsedMessages, ...otherNotifications].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, []);

  const groupNotifications = useCallback((notifs: Notification[]) => {
    const groups: { title: string; notifications: Notification[] }[] = [];

    const todayNotifs = notifs.filter(n => isToday(new Date(n.created_at)));
    const yesterdayNotifs = notifs.filter(n => isYesterday(new Date(n.created_at)));
    const thisWeekNotifs = notifs.filter(n => {
      const date = new Date(n.created_at);
      return isThisWeek(date, { weekStartsOn: 1 }) && !isToday(date) && !isYesterday(date);
    });
    const olderNotifs = notifs.filter(n => {
      const date = new Date(n.created_at);
      return !isThisWeek(date, { weekStartsOn: 1 });
    });

    if (todayNotifs.length > 0) groups.push({ title: 'Today', notifications: todayNotifs });
    if (yesterdayNotifs.length > 0) groups.push({ title: 'Yesterday', notifications: yesterdayNotifs });
    if (thisWeekNotifs.length > 0) groups.push({ title: 'This Week', notifications: thisWeekNotifs });
    if (olderNotifs.length > 0) groups.push({ title: 'Earlier', notifications: olderNotifs });

    return groups;
  }, []);

  const filteredNotifications = useMemo(
    () => activeTab === 'unread' ? notifications.filter(n => !n.is_read) : notifications,
    [activeTab, notifications]
  );

  const collapsedNotifications = useMemo(
    () => collapseMessageNotifications(filteredNotifications),
    [filteredNotifications]
  );

  const groupedNotifications = useMemo(
    () => groupNotifications(collapsedNotifications),
    [collapsedNotifications]
  );

  const unreadCount = useMemo(
    () => notifications.filter(n => !n.is_read).length,
    [notifications]
  );

  const NotificationCard = ({ notif }: { notif: Notification }) => {
    const unreadCount = notif.metadata?.unreadCount || 0;
    const totalMessages = notif.metadata?.totalMessages || 1;
    const isMessageNotif = notif.type === 'message' || notif.type === 'reply';
    const isCollabRequest = notif.type === 'collaboration_request';
    const requestId = notif.metadata?.request_id;

    return (
      <div key={notif.id} className="space-y-2">
        <div
          className={`flex items-start gap-3 sm:gap-4 p-4 rounded-2xl border transition-all ${
            !isCollabRequest ? 'active:scale-[0.98] cursor-pointer' : ''
          } ${
            notif.is_read
              ? 'bg-white/5 border-white/10 hover:bg-white/[0.07]'
              : 'bg-white/5 border-white/10 border-l-[3px] border-l-[#309605] hover:bg-white/[0.08]'
          }`}
          onClick={() => !isCollabRequest && handleNotificationClick(notif)}
        >
          {/* Icon/Avatar — Invite & Earn style rounded-2xl box */}
          {isMessageNotif && notif.sender?.avatar_url ? (
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl flex-shrink-0 overflow-hidden border border-white/10">
              <img
                src={notif.sender.avatar_url}
                alt={notif.sender.display_name}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className={`w-11 h-11 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center flex-shrink-0 border border-white/10 relative ${getNotificationColor(notif.type)}`}>
              {getNotificationIcon(notif.type)}
              {isMessageNotif && unreadCount > 0 && (
                <div className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-[#309605]/20 border border-[#309605]/30 flex items-center justify-center">
                  <span className="text-[10px] font-bold text-[#309605] tabular-nums">{unreadCount}</span>
                </div>
              )}
            </div>
          )}

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-0.5">
              <h3 className={`text-sm font-bold text-white leading-tight flex-1 break-words ${notif.is_read ? 'text-white/90' : ''}`}>
                {getNotificationTitle(notif)}
              </h3>
              {isMessageNotif && totalMessages > 1 && (
                <span className="text-[10px] font-bold text-white/50 flex-shrink-0 tabular-nums">
                  {totalMessages}
                </span>
              )}
            </div>
            <p className="text-[11px] text-white/50 mt-0.5 font-medium">
              {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true }).replace('about ', '')}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {!isCollabRequest && (
              <button
                type="button"
                onClick={(e) => handleDeleteClick(notif, e)}
                disabled={deletingId === notif.id}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl hover:bg-white/10 active:bg-white/15 transition-all disabled:opacity-50"
                aria-label="Delete notification"
              >
                {deletingId === notif.id ? (
                  <Spinner size={16} className="text-white" />
                ) : (
                  <Trash2 className="w-4 h-4 text-white/50" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Collaboration Request — Invite & Earn button style */}
        {isCollabRequest && requestId && (
          <div className="grid grid-cols-2 gap-3 px-1">
            <button
              type="button"
              onClick={(e) => handleAcceptCollabRequest(notif, e)}
              disabled={processingCollabRequestId === requestId}
              className="min-h-[48px] flex items-center justify-center gap-2 rounded-xl bg-white text-black text-sm font-bold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {processingCollabRequestId === requestId ? (
                <Spinner size={16} className="text-black" />
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Accept
                </>
              )}
            </button>
            <button
              type="button"
              onClick={(e) => handleDeclineCollabRequest(notif, e)}
              disabled={processingCollabRequestId === requestId}
              className="min-h-[48px] flex items-center justify-center gap-2 rounded-xl border border-white/10 hover:bg-white/5 hover:border-white/20 text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
            >
              {processingCollabRequestId === requestId ? (
                <Spinner size={16} className="text-white" />
              ) : (
                <>
                  <X className="w-4 h-4" />
                  Decline
                </>
              )}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen min-h-[100dvh] overflow-x-hidden bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white content-with-nav overflow-y-auto">
      {/* Sticky header — Invite & Earn style */}
        <div
          className="sticky top-0 z-10 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-sm border-b border-white/10 px-4 py-3.5 flex items-center gap-3"
          style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px) * 0.25)', paddingBottom: '1.25rem' }}
        >
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
            className="min-w-[44px] min-h-[44px] p-2 rounded-full hover:bg-white/10 active:bg-white/15 transition-colors flex items-center justify-center -ml-1"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5 text-white/80" />
          </button>
          <div className="min-w-0 flex-1 flex items-center gap-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60 mb-0.5">
                Inbox
              </p>
              <h1 className="text-[15px] font-black tracking-tight text-white leading-none">
                Notifications
              </h1>
            </div>
            {unreadCount > 0 && (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#309605]/20 border border-[#309605]/30 flex-shrink-0">
                <span className="text-[10px] font-bold text-[#309605] tabular-nums">{unreadCount}</span>
                <span className="text-[10px] font-bold text-[#309605] uppercase tracking-wider">unread</span>
              </div>
            )}
          </div>
        </div>

        {/* Tabs + Mark all read — Invite & Earn card style */}
        <div className="px-4 sm:px-6 py-4 space-y-3 max-w-[600px] mx-auto">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60 px-1">
            Filter
          </p>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`flex-1 min-h-[44px] py-2.5 rounded-xl text-sm font-bold transition-all active:scale-[0.98] ${
                activeTab === 'all'
                  ? 'bg-white text-black shadow-sm'
                  : 'text-white/60 hover:text-white/80 hover:bg-white/5'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('unread')}
              className={`flex-1 min-h-[44px] py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 active:scale-[0.98] ${
                activeTab === 'unread'
                  ? 'bg-white text-black shadow-sm'
                  : 'text-white/60 hover:text-white/80 hover:bg-white/5'
              }`}
            >
              Unread
              {unreadCount > 0 && activeTab !== 'unread' && (
                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#309605]/20 border border-[#309605]/30 flex items-center justify-center text-[10px] font-bold text-[#309605]">
                  {unreadCount}
                </span>
              )}
            </button>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                disabled={isMarkingAllRead}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white transition-all disabled:opacity-50"
                aria-label="Mark all as read"
              >
                {isMarkingAllRead ? (
                  <Spinner size={20} className="text-white" />
                ) : (
                  <CheckCheck className="w-5 h-5" />
                )}
              </button>
            )}
            {notifications.length > 0 && (
              <button
                type="button"
                onClick={() => setShowConfirmDeleteAll(true)}
                disabled={isDeletingAll}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-white/5 hover:bg-red-500/10 border border-white/10 text-white/50 hover:text-red-400 transition-all disabled:opacity-50"
                aria-label="Delete all notifications"
                title="Delete all"
              >
                {isDeletingAll ? (
                  <Spinner size={20} className="text-white" />
                ) : (
                  <Trash2 className="w-5 h-5" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Content — Invite & Earn layout */}
        <div className="px-4 sm:px-6 py-2 sm:py-4 space-y-6 sm:space-y-8 max-w-[600px] mx-auto">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-20 sm:h-24 bg-white/5 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
              <div className="p-8 sm:p-10 text-center">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white/10 flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="w-8 h-8 sm:w-10 sm:h-10 text-white/40" />
                </div>
                <h3 className="text-lg sm:text-xl font-black text-white tracking-tight mb-2">
                  {activeTab === 'unread' ? 'All Caught Up!' : 'No Notifications'}
                </h3>
                <p className="text-[13px] sm:text-sm text-white/50 leading-relaxed max-w-xs mx-auto">
                  {activeTab === 'unread'
                    ? 'No unread notifications. Check back later for updates!'
                    : "You don't have any notifications yet."}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-6 sm:space-y-8">
              {groupedNotifications.map((group, groupIndex) => (
                <div key={groupIndex} className="space-y-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60 px-1">
                    {group.title}
                  </p>
                  <div className="space-y-2">
                    {group.notifications.map((notif) => (
                      <NotificationCard key={notif.id} notif={notif} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      {/* Delete single — Confirmation */}
      <CustomConfirmDialog
        isOpen={showConfirmDelete}
        title="Delete Notification?"
        message="This notification will be permanently deleted. This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          setShowConfirmDelete(false);
          setNotificationToDelete(null);
        }}
        isLoading={deletingId !== null}
      />

      {/* Delete all — Confirmation */}
      <CustomConfirmDialog
        isOpen={showConfirmDeleteAll}
        title="Delete All Notifications?"
        message="All your notifications will be permanently deleted. This action cannot be undone."
        confirmText="Delete All"
        cancelText="Cancel"
        variant="danger"
        onConfirm={handleDeleteAllNotifications}
        onCancel={() => setShowConfirmDeleteAll(false)}
        isLoading={isDeletingAll}
      />

      {/* Toast Notification */}
      {toast && (
        <ToastNotification
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
};
