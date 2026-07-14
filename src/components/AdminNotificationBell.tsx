import React, { useMemo, useState, useEffect } from 'react';
import { Bell, X, Check, AlertTriangle, DollarSign, HelpCircle, TrendingUp, Trash2, Square, CheckSquare } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface NotificationCounts {
  withdrawal_requests: number;
  financial_alerts: number;
  support_tickets: number;
  payment_monitoring: number;
  total: number;
}

interface Notification {
  id: string;
  notification_type: string;
  reference_id: string | null;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

interface AdminNotificationBellProps {
  onNavigateToSection?: (_section: string) => void;
}

export const AdminNotificationBell: React.FC<AdminNotificationBellProps> = ({ onNavigateToSection }) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [counts, setCounts] = useState<NotificationCounts>({
    withdrawal_requests: 0,
    financial_alerts: 0,
    support_tickets: 0,
    payment_monitoring: 0,
    total: 0
  });
  const [recentNotifications, setRecentNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchNotificationCounts();
    fetchRecentNotifications();

    // Subscribe to realtime updates
    const channel = supabase
      .channel('admin-notifications')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'admin_action_notifications'
        },
        () => {
          fetchNotificationCounts();
          fetchRecentNotifications();
        }
      )
      .subscribe();

    // Poll every 30 seconds for updates
    const interval = setInterval(() => {
      fetchNotificationCounts();
      fetchRecentNotifications();
    }, 30000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, []);

  const fetchNotificationCounts = async () => {
    try {
      const { data, error } = await supabase.rpc('get_admin_notification_counts');

      if (error) throw error;

      if (data && data.length > 0) {
        setCounts(data[0]);
      }
    } catch (error) {
      console.error('Error fetching notification counts:', error);
    }
  };

  const fetchRecentNotifications = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase.rpc('get_admin_notifications', {
        p_limit: 10,
        p_offset: 0
      });

      if (error) throw error;

      setRecentNotifications(data || []);
      setSelectedIds(new Set());
    } catch (error) {
      console.error('Error fetching recent notifications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMarkAsRead = async (notificationId: string) => {
    try {
      await supabase.rpc('mark_notification_read', {
        p_notification_id: notificationId
      });

      fetchNotificationCounts();
      fetchRecentNotifications();
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await supabase.rpc('mark_all_admin_action_notifications_read');

      fetchNotificationCounts();
      fetchRecentNotifications();
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  };

  const handleDeleteNotification = async (notificationId: string) => {
    try {
      setIsDeleting(true);
      const { error } = await supabase.rpc('delete_admin_action_notification', {
        p_notification_id: notificationId
      });
      if (error) throw error;

      fetchNotificationCounts();
      fetchRecentNotifications();
    } catch (error) {
      console.error('Error deleting notification:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const selectedCount = useMemo(() => selectedIds.size, [selectedIds]);
  const allSelected = useMemo(() => {
    if (recentNotifications.length === 0) return false;
    return selectedIds.size === recentNotifications.length;
  }, [recentNotifications.length, selectedIds]);

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      if (recentNotifications.length === 0) return prev;
      if (prev.size === recentNotifications.length) return new Set();
      return new Set(recentNotifications.map(n => n.id));
    });
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    try {
      setIsDeleting(true);
      const { error } = await supabase.rpc('delete_admin_action_notifications', {
        p_notification_ids: Array.from(selectedIds)
      });
      if (error) throw error;

      fetchNotificationCounts();
      fetchRecentNotifications();
    } catch (error) {
      console.error('Error deleting selected notifications:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    // Mark as read
    if (!notification.is_read) {
      handleMarkAsRead(notification.id);
    }

    // Navigate to appropriate section
    if (onNavigateToSection) {
      if (notification.notification_type === 'withdrawal_request') {
        onNavigateToSection('earnings');
      } else if (notification.notification_type === 'support_ticket') {
        onNavigateToSection('support');
      } else if (notification.notification_type === 'payment_monitoring' || notification.notification_type === 'financial_alert') {
        onNavigateToSection('payment_monitoring');
      } else if (notification.notification_type === 'report_submitted') {
        if (notification.reference_id) {
          const url = new URL(window.location.href);
          url.searchParams.set('reportId', notification.reference_id);
          window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
        }
        onNavigateToSection('reports');
      }
    }

    setShowDropdown(false);
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'withdrawal_request':
        return <DollarSign className="w-4 h-4 text-yellow-600" />;
      case 'support_ticket':
        return <HelpCircle className="w-4 h-4 text-blue-600" />;
      case 'financial_alert':
        return <AlertTriangle className="w-4 h-4 text-red-600" />;
      case 'payment_monitoring':
        return <TrendingUp className="w-4 h-4 text-orange-600" />;
      case 'report_submitted':
        return <AlertTriangle className="w-4 h-4 text-red-500" />;
      default:
        return <Bell className="w-4 h-4 text-gray-600" />;
    }
  };

  const formatNotificationType = (type: string) => {
    return type
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="relative p-2 hover:bg-gray-100 rounded-lg transition-colors"
        title="Notifications"
      >
        <Bell className="w-5 h-5 text-gray-700" />
        {counts.total > 0 && (
          <span className="absolute top-0 right-0 w-5 h-5 bg-red-600 text-white text-xs font-bold rounded-full flex items-center justify-center">
            {counts.total > 99 ? '99+' : counts.total}
          </span>
        )}
      </button>

      {showDropdown && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowDropdown(false)}
          />
          <div className="absolute right-0 mt-2 w-96 bg-white rounded-lg shadow-2xl border border-gray-200 z-50 max-h-[600px] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 text-lg">Notifications</h3>
              <div className="flex items-center gap-2">
                {recentNotifications.length > 0 && (
                  <>
                    <button
                      onClick={toggleSelectAll}
                      className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                      title={allSelected ? 'Unselect all' : 'Select all'}
                      aria-label={allSelected ? 'Unselect all' : 'Select all'}
                    >
                      {allSelected ? (
                        <CheckSquare className="w-4 h-4 text-gray-700" />
                      ) : (
                        <Square className="w-4 h-4 text-gray-700" />
                      )}
                    </button>
                    <button
                      onClick={handleDeleteSelected}
                      disabled={isDeleting || selectedCount === 0}
                      className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 disabled:pointer-events-none"
                      title={selectedCount > 0 ? `Delete selected (${selectedCount})` : 'Select notifications to delete'}
                      aria-label="Delete selected notifications"
                    >
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </button>
                  </>
                )}
                {counts.total > 0 && (
                  <button
                    onClick={handleMarkAllAsRead}
                    className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Mark all as read"
                  >
                    <Check className="w-4 h-4 text-[#309605]" />
                  </button>
                )}
                <button
                  onClick={() => setShowDropdown(false)}
                  className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>
            </div>

            {/* Stats Summary */}
            <div className="p-4 bg-gray-50 border-b border-gray-200">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2 p-2 bg-white rounded-lg">
                  <DollarSign className="w-4 h-4 text-yellow-600" />
                  <div className="flex-1">
                    <p className="text-xs text-gray-600">Withdrawals</p>
                    <p className="text-sm font-bold text-gray-900">{counts.withdrawal_requests}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-2 bg-white rounded-lg">
                  <HelpCircle className="w-4 h-4 text-blue-600" />
                  <div className="flex-1">
                    <p className="text-xs text-gray-600">Support</p>
                    <p className="text-sm font-bold text-gray-900">{counts.support_tickets}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-2 bg-white rounded-lg">
                  <TrendingUp className="w-4 h-4 text-orange-600" />
                  <div className="flex-1">
                    <p className="text-xs text-gray-600">Payments</p>
                    <p className="text-sm font-bold text-gray-900">{counts.payment_monitoring}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-2 bg-white rounded-lg">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                  <div className="flex-1">
                    <p className="text-xs text-gray-600">Alerts</p>
                    <p className="text-sm font-bold text-gray-900">{counts.financial_alerts}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Notifications List */}
            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center p-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#309605]"></div>
                </div>
              ) : recentNotifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-8 text-center">
                  <Bell className="w-12 h-12 text-gray-400 mb-3" />
                  <p className="text-gray-600 font-medium">No notifications</p>
                  <p className="text-gray-500 text-sm mt-1">You&apos;re all caught up</p>
                </div>
              ) : (
                <div>
                  {recentNotifications.map((notification) => (
                    <div
                      key={notification.id}
                      onClick={() => handleNotificationClick(notification)}
                      className={`w-full p-4 border-b border-gray-200 hover:bg-gray-50 transition-colors text-left ${
                        !notification.is_read ? 'bg-blue-50' : ''
                      } cursor-pointer`}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleNotificationClick(notification);
                        }
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          className="flex-shrink-0 mt-1 p-1 rounded hover:bg-white/70"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleSelected(notification.id);
                          }}
                          aria-label={selectedIds.has(notification.id) ? 'Unselect notification' : 'Select notification'}
                          title={selectedIds.has(notification.id) ? 'Unselect' : 'Select'}
                        >
                          {selectedIds.has(notification.id) ? (
                            <CheckSquare className="w-4 h-4 text-gray-700" />
                          ) : (
                            <Square className="w-4 h-4 text-gray-700" />
                          )}
                        </button>
                        <div className="flex-shrink-0 w-8 h-8 bg-white rounded-lg flex items-center justify-center border border-gray-200">
                          {getNotificationIcon(notification.notification_type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <p className="text-xs font-medium text-gray-600">
                              {formatNotificationType(notification.notification_type)}
                            </p>
                            <span className="text-xs text-gray-500">
                              {formatTimeAgo(notification.created_at)}
                            </span>
                          </div>
                          <p className="text-sm font-semibold text-gray-900 mb-1">
                            {notification.title}
                          </p>
                          <p className="text-xs text-gray-600 line-clamp-2">
                            {notification.message}
                          </p>
                        </div>
                        {!notification.is_read && (
                          <div className="flex-shrink-0 w-2 h-2 bg-blue-600 rounded-full mt-2"></div>
                        )}
                        <button
                          className="flex-shrink-0 p-1.5 rounded-lg hover:bg-white/70 disabled:opacity-50 disabled:pointer-events-none"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleDeleteNotification(notification.id);
                          }}
                          disabled={isDeleting}
                          aria-label="Delete notification"
                          title="Delete notification"
                        >
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
