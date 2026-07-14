import React, { useState, useEffect } from 'react';
import { X, Bell, CheckCircle, Trash2, Loader2 } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';

interface NotificationsModalProps {
  onClose: () => void;
  onSuccess?: () => void;
}

interface Notification {
  id: string;
  user_id: string;
  title?: string;
  type: string;
  message: string;
  metadata: any;
  creator_request_id?: string;
  is_read: boolean;
  created_at: string;
}

export const NotificationsModal: React.FC<NotificationsModalProps> = ({
  onClose,
  onSuccess,
}) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState<string | null>(null);

  useEffect(() => {
    fetchNotifications();
  }, []);

  const fetchNotifications = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('User not authenticated.');
        setIsLoading(false);
        return;
      }

      const { data, error: fetchError } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (fetchError) {
        throw new Error(fetchError.message);
      }
      setNotifications(data || []);
    } catch (err) {
      console.error('Error fetching notifications:', err);
      setError(err instanceof Error ? err.message : 'Failed to load notifications');
    } finally {
      setIsLoading(false);
    }
  };

  const markAsRead = async (id: string) => {
    setIsUpdating(id);
    try {
      const { error: updateError } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id);

      if (updateError) {
        throw new Error(updateError.message);
      }
      setNotifications(prev => prev.map(notif =>
        notif.id === id ? { ...notif, is_read: true } : notif
      ));
      onSuccess?.();
    } catch (err) {
      console.error('Error marking notification as read:', err);
      setError(err instanceof Error ? err.message : 'Failed to mark as read');
    } finally {
      setIsUpdating(null);
    }
  };

  const deleteNotification = async (id: string) => {
    setIsUpdating(id);
    try {
      const { error: deleteError } = await supabase
        .from('notifications')
        .delete()
        .eq('id', id);

      if (deleteError) {
        throw new Error(deleteError.message);
      }
      setNotifications(prev => prev.filter(notif => notif.id !== id));
      onSuccess?.();
    } catch (err) {
      console.error('Error deleting notification:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete notification');
    } finally {
      setIsUpdating(null);
    }
  };

  const formatTimeAgo = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    const years = Math.floor(months / 12);
    return `${years}y ago`;
  };

  const getBgColor = (notif: Notification) => {
    if (notif.type === 'creator_request') {
      const status = notif.metadata?.request_status;
      if (status === 'approved') return 'bg-emerald-500/10 border-emerald-500/20';
      if (status === 'rejected') return 'bg-rose-500/10 border-rose-500/20';
      if (status === 'banned') return 'bg-muted/50 border-border/30';
    }
    return 'bg-muted/30 border-border/30';
  };

  const getIconColor = (notif: Notification) => {
    if (notif.type === 'creator_request') {
      const status = notif.metadata?.request_status;
      if (status === 'approved') return 'bg-emerald-500/15 text-emerald-400';
      if (status === 'rejected') return 'bg-rose-500/15 text-rose-400';
      if (status === 'banned') return 'bg-muted text-muted-foreground';
    }
    return 'bg-primary/15 text-primary';
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="notifications-modal-title"
        className={cn(
          'w-full flex flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl sm:max-w-md',
          'bg-background border border-border/50 shadow-2xl',
          'max-h-[90vh] sm:max-h-[85vh]'
        )}
        style={{ maxHeight: 'min(90vh, calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom)))' }}
      >
        {/* Header — same design system as NotificationScreen */}
        <div
          className={cn(
            'flex-shrink-0 flex items-center justify-between px-4 sm:px-5 py-4 sm:py-5 border-b border-border/50'
          )}
          style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px) * 0.25)', paddingBottom: '1.25rem' }}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary/15 flex items-center justify-center flex-shrink-0">
              <Bell className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/40 mb-0.5">Inbox</p>
              <h2 id="notifications-modal-title" className="text-lg sm:text-xl font-black tracking-tight text-foreground">
                Notifications
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2.5 rounded-lg hover:bg-secondary active:bg-secondary/80 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center touch-manipulation"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center py-12 px-4">
            <div className="flex flex-col items-center gap-4">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-[12px] font-medium text-muted-foreground">
                Loading notifications...
              </p>
            </div>
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="p-5 bg-destructive/10 border border-destructive/20 rounded-xl text-center max-w-sm">
              <p className="text-[13px] font-medium text-destructive mb-4">{error}</p>
              <button
                onClick={fetchNotifications}
                className="px-5 py-2.5 rounded-xl bg-destructive/20 hover:bg-destructive/30 text-destructive text-[13px] font-bold transition-colors min-h-[44px] touch-manipulation"
              >
                Try Again
              </button>
            </div>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-6 min-h-[240px]">
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-muted/40 flex items-center justify-center mx-auto mb-3">
                <Bell className="w-6 h-6 text-muted-foreground/30" />
              </div>
              <p className="text-sm font-semibold text-foreground mb-1">
                No new notifications
              </p>
              <p className="text-[12px] text-muted-foreground">
                You&apos;re all caught up!
              </p>
            </div>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="p-3 sm:p-4 space-y-2">
              {notifications.map((notif) => (
                <div
                  key={notif.id}
                  className={cn(
                    'rounded-xl border transition-all duration-200',
                    notif.is_read && 'opacity-75',
                    getBgColor(notif)
                  )}
                >
                  <div className="p-4 flex items-start gap-3">
                    <div className={cn('w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0', getIconColor(notif))}>
                      <Bell className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      {notif.title && (
                        <p className={cn(
                          'text-[11px] font-bold uppercase tracking-wide mb-0.5',
                          notif.is_read ? 'text-muted-foreground/60' : 'text-foreground/80'
                        )}>
                          {notif.title}
                        </p>
                      )}
                      <p className={cn(
                        'text-[13px] font-medium mb-1',
                        notif.is_read ? 'text-muted-foreground' : 'text-foreground'
                      )}>
                        {notif.message}
                      </p>
                      <p className="text-[10px] text-muted-foreground/50 font-mono">
                        {formatTimeAgo(notif.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {!notif.is_read && (
                        <button
                          onClick={() => markAsRead(notif.id)}
                          disabled={isUpdating === notif.id}
                          className="p-2.5 rounded-lg hover:bg-primary/10 active:bg-primary/15 transition-colors disabled:opacity-50 disabled:pointer-events-none min-h-[44px] min-w-[44px] flex items-center justify-center touch-manipulation"
                          title="Mark as read"
                          aria-label="Mark as read"
                        >
                          {isUpdating === notif.id ? (
                            <Loader2 className="w-4 h-4 text-primary animate-spin" />
                          ) : (
                            <CheckCircle className="w-4 h-4 text-primary" />
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => deleteNotification(notif.id)}
                        disabled={isUpdating === notif.id}
                        className="p-2.5 rounded-lg hover:bg-destructive/10 active:bg-destructive/15 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50 disabled:pointer-events-none min-h-[44px] min-w-[44px] flex items-center justify-center touch-manipulation"
                        title="Delete notification"
                        aria-label="Delete notification"
                      >
                        {isUpdating === notif.id ? (
                          <Loader2 className="w-4 h-4 text-destructive animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
};
