import React, { useState, useEffect } from 'react';
import { Flag, Eye, CheckCircle, XCircle, Clock, Trash2, Search, User, Music, Video, Album, MessageCircle, List, AlertTriangle, Ban, FileText, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Card, CardContent } from '../../components/ui/card';
import { formatDistanceToNowStrict, format, subDays } from 'date-fns';
import { LoadingLogo } from '../../components/LoadingLogo';

interface Report {
  id: string;
  reporter_id: string;
  reported_item_type: string;
  reported_item_id: string;
  reported_user_id: string | null;
  reason: string;
  description: string | null;
  status: 'pending' | 'reviewing' | 'resolved' | 'dismissed';
  admin_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  content_url: string | null;
  reporter?: {
    id: string;
    display_name: string;
    email: string;
    avatar_url: string | null;
  };
  reported_user?: {
    id: string;
    display_name: string;
    email: string;
    avatar_url: string | null;
  };
  reviewer?: {
    display_name: string;
    email: string;
  };
  content?: {
    title?: string;
    thumbnail_url?: string;
    cover_image_url?: string;
  };
  total_reports_count?: number;
  is_high_priority?: boolean;
}

interface ContentItem {
  title?: string;
  thumbnail_url?: string;
  cover_image_url?: string;
}

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDestructive?: boolean;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText,
  onConfirm,
  onCancel,
  isDestructive = false
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <Card className="bg-white border-gray-200 w-full max-w-lg">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${isDestructive ? 'bg-red-100' : 'bg-yellow-100'}`}>
              <AlertTriangle className={`w-6 h-6 ${isDestructive ? 'text-red-600' : 'text-yellow-600'}`} />
            </div>
            <h3 className="font-['Inter',sans-serif] font-bold text-gray-900 text-lg">{title}</h3>
          </div>
          <p className="font-['Inter',sans-serif] text-gray-700 text-sm leading-relaxed">{message}</p>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-3 bg-gray-100 hover:bg-gray-200 rounded-lg font-['Inter',sans-serif] font-medium text-gray-900 text-sm transition-all"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className={`flex-1 px-4 py-3 rounded-lg font-['Inter',sans-serif] font-medium text-white text-sm transition-all ${
                isDestructive ? 'bg-red-600 hover:bg-red-700' : 'bg-[#309605] hover:bg-[#3ba208]'
              }`}
            >
              {confirmText}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export const ReportManagementSection: React.FC = () => {
  const [reports, setReports] = useState<Report[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedReports, setSelectedReports] = useState<Set<string>>(new Set());
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText: string;
    action: () => void;
    isDestructive: boolean;
  }>({
    isOpen: false,
    title: '',
    message: '',
    confirmText: '',
    action: () => {},
    isDestructive: false
  });

  const itemsPerPage = 20;

  useEffect(() => {
    loadReports();
  }, [selectedStatus, selectedType, dateFilter, currentPage]);

  useEffect(() => {
    if (!reports.length) return;

    const url = new URL(window.location.href);
    const reportId = url.searchParams.get('reportId');
    if (!reportId) return;

    const targetReport = reports.find((report) => report.id === reportId);
    if (!targetReport) return;

    setSelectedReport(targetReport);
    setAdminNotes(targetReport.admin_notes || '');
    url.searchParams.delete('reportId');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, [reports]);

  const loadReports = async () => {
    try {
      setIsLoading(true);

      let query = supabase
        .from('reports')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      if (selectedStatus !== 'all') {
        query = query.eq('status', selectedStatus);
      }

      if (selectedType !== 'all') {
        query = query.eq('reported_item_type', selectedType);
      }

      if (dateFilter !== 'all') {
        let dateThreshold: Date;
        switch (dateFilter) {
          case '24h':
            dateThreshold = subDays(new Date(), 1);
            break;
          case '7d':
            dateThreshold = subDays(new Date(), 7);
            break;
          case '30d':
            dateThreshold = subDays(new Date(), 30);
            break;
          default:
            dateThreshold = new Date(0);
        }
        query = query.gte('created_at', dateThreshold.toISOString());
      }

      const from = (currentPage - 1) * itemsPerPage;
      const to = from + itemsPerPage - 1;

      const { data: reportsData, error, count } = await query.range(from, to);

      if (error) throw error;

      if (!reportsData || reportsData.length === 0) {
        setReports([]);
        setTotalPages(1);
        return;
      }

      setTotalPages(Math.ceil((count || 0) / itemsPerPage));

      const userIds = new Set<string>();
      reportsData.forEach(report => {
        userIds.add(report.reporter_id);
        if (report.reported_user_id) userIds.add(report.reported_user_id);
        if (report.reviewed_by) userIds.add(report.reviewed_by);
      });

      const { data: usersData } = await supabase
        .from('users')
        .select('id, display_name, email, avatar_url')
        .in('id', Array.from(userIds));

      const usersMap = new Map(usersData?.map(u => [u.id, u]) || []);

      const enrichedReports = await Promise.all(reportsData.map(async (report) => {
        let content: ContentItem | undefined;
        let totalReportsCount = 0;
        let isHighPriority = false;
        let contentUrl = report.content_url;

        const { count: itemReportsCount } = await supabase
          .from('reports')
          .select('*', { count: 'exact', head: true })
          .eq('reported_item_id', report.reported_item_id);

        totalReportsCount = itemReportsCount || 0;

        const twentyFourHoursAgo = subDays(new Date(), 1);
        const { count: recentReportsCount } = await supabase
          .from('reports')
          .select('*', { count: 'exact', head: true })
          .eq('reported_item_id', report.reported_item_id)
          .gte('created_at', twentyFourHoursAgo.toISOString());

        isHighPriority = (recentReportsCount || 0) > 10;

        if (report.reported_item_type === 'song') {
          const { data } = await supabase
            .from('songs')
            .select('title, cover_image_url')
            .eq('id', report.reported_item_id)
            .single();
          if (data) {
            content = { title: data.title, thumbnail_url: data.cover_image_url };
            if (!contentUrl) contentUrl = `/song/${report.reported_item_id}`;
          }
        } else if (report.reported_item_type === 'video') {
          const { data } = await supabase
            .from('content_uploads')
            .select('title, metadata')
            .eq('id', report.reported_item_id)
            .eq('content_type', 'video')
            .single();
          if (data) {
            content = {
              title: data.title,
              thumbnail_url: data.metadata?.thumbnail_url || data.metadata?.coverImage
            };
            if (!contentUrl) contentUrl = `/video/${report.reported_item_id}`;
          }
        } else if (report.reported_item_type === 'short_clip' || report.reported_item_type === 'clip' || report.reported_item_type === 'shorts') {
          const { data } = await supabase
            .from('content_uploads')
            .select('title, metadata')
            .eq('id', report.reported_item_id)
            .eq('content_type', 'short_clip')
            .single();
          if (data) {
            content = {
              title: data.title,
              thumbnail_url: data.metadata?.thumbnail_url || data.metadata?.coverImage
            };
            if (!contentUrl) contentUrl = `/loops/${report.reported_item_id}`;
          }
        } else if (report.reported_item_type === 'album') {
          const { data } = await supabase
            .from('albums')
            .select('title, cover_image_url')
            .eq('id', report.reported_item_id)
            .single();
          if (data) {
            content = { title: data.title, thumbnail_url: data.cover_image_url };
            if (!contentUrl) contentUrl = `/album/${report.reported_item_id}`;
          }
        } else if (report.reported_item_type === 'user' && report.reported_user_id) {
          if (!contentUrl) contentUrl = `/profile/${report.reported_user_id}`;
        } else if (report.reported_item_type === 'comment') {
          if (!contentUrl) contentUrl = `#comment-${report.reported_item_id}`;
        } else if (report.reported_item_type === 'playlist') {
          if (!contentUrl) contentUrl = `/playlist/${report.reported_item_id}`;
        }

        return {
          ...report,
          content_url: contentUrl,
          reporter: usersMap.get(report.reporter_id),
          reported_user: report.reported_user_id ? usersMap.get(report.reported_user_id) : undefined,
          reviewer: report.reviewed_by ? usersMap.get(report.reviewed_by) : undefined,
          content,
          total_reports_count: totalReportsCount,
          is_high_priority: isHighPriority
        };
      }));

      setReports(enrichedReports);
    } catch (err) {
      console.error('Error loading reports:', err);
      alert('Failed to load reports');
    } finally {
      setIsLoading(false);
    }
  };

  const showConfirmModal = (
    title: string,
    message: string,
    confirmText: string,
    action: () => void,
    isDestructive: boolean = false
  ) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      confirmText,
      action,
      isDestructive
    });
  };

  const handleConfirm = () => {
    confirmModal.action();
    setConfirmModal({ ...confirmModal, isOpen: false });
  };

  const handleCancel = () => {
    setConfirmModal({ ...confirmModal, isOpen: false });
  };

  const logAdminAction = async (action: string, reportId: string, details: any) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase.from('admin_action_logs').insert({
        admin_id: user.id,
        action_type: action,
        target_type: 'report',
        target_id: reportId,
        details: details,
        created_at: new Date().toISOString()
      });
    } catch (err) {
      console.error('Error logging admin action:', err);
    }
  };

  const handleUpdateStatus = async (reportId: string, newStatus: 'reviewing' | 'resolved' | 'dismissed') => {
    try {
      setIsUpdating(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const updates: any = {
        status: newStatus,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      };

      if (adminNotes.trim()) {
        updates.admin_notes = adminNotes.trim();
      }

      const { error } = await supabase
        .from('reports')
        .update(updates)
        .eq('id', reportId);

      if (error) throw error;

      await logAdminAction('update_report_status', reportId, { new_status: newStatus, notes: adminNotes });

      setSelectedReport(null);
      setAdminNotes('');
      await loadReports();
      alert(`Report marked as ${newStatus}`);
    } catch (err) {
      console.error('Error updating report:', err);
      alert('Failed to update report');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleRemoveContent = async (report: Report) => {
    const action = async () => {
      try {
        setIsUpdating(true);

        const tableName = report.reported_item_type === 'song' ? 'songs' :
                         report.reported_item_type === 'album' ? 'albums' :
                         (report.reported_item_type === 'video' ||
                          report.reported_item_type === 'short_clip' ||
                          report.reported_item_type === 'clip' ||
                          report.reported_item_type === 'shorts') ? 'content_uploads' : null;

        if (tableName) {
          const { error } = await supabase
            .from(tableName)
            .delete()
            .eq('id', report.reported_item_id);

          if (error) throw error;
        }

        await handleUpdateStatus(report.id, 'resolved');
        await logAdminAction('remove_content', report.id, { content_type: report.reported_item_type, content_id: report.reported_item_id });

        alert('Content removed successfully');
      } catch (err) {
        console.error('Error removing content:', err);
        alert('Failed to remove content');
      } finally {
        setIsUpdating(false);
      }
    };

    showConfirmModal(
      'Remove Content',
      'Are you sure you want to permanently delete this content? This action cannot be undone.',
      'Remove Content',
      action,
      true
    );
  };

  const handleWarnUser = async (report: Report) => {
    const action = async () => {
      try {
        setIsUpdating(true);

        if (!report.reported_user_id) {
          alert('No user associated with this report');
          return;
        }

        const { error } = await supabase.from('user_warnings').insert({
          user_id: report.reported_user_id,
          reason: report.reason,
          description: `Warning issued based on report: ${report.description || 'N/A'}`,
          created_at: new Date().toISOString()
        });

        if (error) throw error;

        await handleUpdateStatus(report.id, 'resolved');
        await logAdminAction('warn_user', report.id, { user_id: report.reported_user_id, reason: report.reason });

        alert('User warned successfully');
      } catch (err) {
        console.error('Error warning user:', err);
        alert('Failed to warn user');
      } finally {
        setIsUpdating(false);
      }
    };

    showConfirmModal(
      'Warn User',
      `Are you sure you want to issue a warning to ${report.reported_user?.display_name || 'this user'}?`,
      'Issue Warning',
      action,
      false
    );
  };

  const handleBanUser = async (report: Report) => {
    const action = async () => {
      try {
        setIsUpdating(true);

        if (!report.reported_user_id) {
          alert('No user associated with this report');
          return;
        }

        const { error } = await supabase
          .from('users')
          .update({ is_banned: true, banned_at: new Date().toISOString() })
          .eq('id', report.reported_user_id);

        if (error) throw error;

        await handleUpdateStatus(report.id, 'resolved');
        await logAdminAction('ban_user', report.id, { user_id: report.reported_user_id, reason: report.reason });

        alert('User banned successfully');
      } catch (err) {
        console.error('Error banning user:', err);
        alert('Failed to ban user');
      } finally {
        setIsUpdating(false);
      }
    };

    showConfirmModal(
      'Ban User',
      `Are you sure you want to permanently ban ${report.reported_user?.display_name || 'this user'}? This is a severe action.`,
      'Ban User',
      action,
      true
    );
  };

  const handleAddNote = async (reportId: string) => {
    try {
      setIsUpdating(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('reports')
        .update({
          admin_notes: adminNotes.trim(),
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', reportId);

      if (error) throw error;

      await logAdminAction('add_note', reportId, { note: adminNotes });

      setSelectedReport(null);
      setAdminNotes('');
      await loadReports();
      alert('Note added successfully');
    } catch (err) {
      console.error('Error adding note:', err);
      alert('Failed to add note');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteReport = async (reportId: string) => {
    const action = async () => {
      try {
        const { error } = await supabase
          .from('reports')
          .delete()
          .eq('id', reportId);

        if (error) throw error;

        await logAdminAction('delete_report', reportId, {});

        setSelectedReport(null);
        await loadReports();
        alert('Report deleted successfully');
      } catch (err) {
        console.error('Error deleting report:', err);
        alert('Failed to delete report');
      }
    };

    showConfirmModal(
      'Delete Report',
      'Are you sure you want to permanently delete this report? This action cannot be undone.',
      'Delete Report',
      action,
      true
    );
  };

  const handleBulkAction = async (action: 'reviewing' | 'resolved' | 'dismissed') => {
    if (selectedReports.size === 0) {
      alert('Please select at least one report');
      return;
    }

    const bulkAction = async () => {
      try {
        setIsUpdating(true);

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        const { error } = await supabase
          .from('reports')
          .update({
            status: action,
            reviewed_by: user.id,
            reviewed_at: new Date().toISOString()
          })
          .in('id', Array.from(selectedReports));

        if (error) throw error;

        for (const reportId of selectedReports) {
          await logAdminAction('bulk_update_status', reportId, { new_status: action });
        }

        setSelectedReports(new Set());
        await loadReports();
        alert(`${selectedReports.size} reports updated to ${action}`);
      } catch (err) {
        console.error('Error performing bulk action:', err);
        alert('Failed to perform bulk action');
      } finally {
        setIsUpdating(false);
      }
    };

    showConfirmModal(
      'Bulk Action',
      `Are you sure you want to mark ${selectedReports.size} reports as ${action}?`,
      'Confirm',
      bulkAction,
      false
    );
  };

  const toggleSelectReport = (reportId: string) => {
    const newSelected = new Set(selectedReports);
    if (newSelected.has(reportId)) {
      newSelected.delete(reportId);
    } else {
      newSelected.add(reportId);
    }
    setSelectedReports(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedReports.size === filteredReports.length) {
      setSelectedReports(new Set());
    } else {
      setSelectedReports(new Set(filteredReports.map(r => r.id)));
    }
  };

  const getReportTypeIcon = (type: string) => {
    switch (type) {
      case 'song': return <Music className="w-4 h-4" />;
      case 'video': return <Video className="w-4 h-4" />;
      case 'short_clip':
      case 'clip':
      case 'shorts': return <Video className="w-4 h-4" />;
      case 'album': return <Album className="w-4 h-4" />;
      case 'comment': return <MessageCircle className="w-4 h-4" />;
      case 'user': return <User className="w-4 h-4" />;
      case 'playlist': return <List className="w-4 h-4" />;
      default: return <Flag className="w-4 h-4" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      pending: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      reviewing: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      resolved: 'bg-green-500/20 text-green-400 border-green-500/30',
      dismissed: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    };

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium border ${styles[status as keyof typeof styles]}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const filteredReports = reports.filter(report => {
    if (!searchQuery) return true;

    const query = searchQuery.toLowerCase();
    return (
      report.reason.toLowerCase().includes(query) ||
      report.reporter?.display_name?.toLowerCase().includes(query) ||
      report.reporter?.email?.toLowerCase().includes(query) ||
      report.reported_user?.display_name?.toLowerCase().includes(query) ||
      report.description?.toLowerCase().includes(query) ||
      report.content?.title?.toLowerCase().includes(query)
    );
  });

  const stats = {
    total: reports.length,
    pending: reports.filter(r => r.status === 'pending').length,
    reviewing: reports.filter(r => r.status === 'reviewing').length,
    resolved: reports.filter(r => r.status === 'resolved').length,
    dismissed: reports.filter(r => r.status === 'dismissed').length,
  };

  return (
    <div className="space-y-4 min-h-full">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
          <Flag className="w-4 h-4 text-red-500" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900 leading-tight">Report Management</h2>
          <p className="text-sm text-gray-400 mt-0.5">Review and take action on user-submitted content reports</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Total', value: stats.total, color: 'text-gray-900', bg: 'bg-white', icon: <Flag className="w-4 h-4 text-gray-300" /> },
          { label: 'Pending', value: stats.pending, color: 'text-orange-700', bg: 'bg-orange-50', icon: <Clock className="w-4 h-4 text-orange-300" /> },
          { label: 'Reviewed', value: stats.reviewing, color: 'text-blue-700', bg: 'bg-blue-50', icon: <Eye className="w-4 h-4 text-blue-300" /> },
          { label: 'Action Taken', value: stats.resolved, color: 'text-green-700', bg: 'bg-green-50', icon: <CheckCircle className="w-4 h-4 text-green-300" /> },
          { label: 'Dismissed', value: stats.dismissed, color: 'text-gray-700', bg: 'bg-gray-50', icon: <XCircle className="w-4 h-4 text-gray-300" /> },
        ].map((stat) => (
          <div key={stat.label} className={`${stat.bg} rounded-xl border border-gray-100 shadow-sm p-4`}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-gray-500">{stat.label}</p>
              {stat.icon}
            </div>
            <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col md:flex-row gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search reports..."
              className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#309605] focus:border-transparent"
            />
          </div>
          {[
            {
              value: selectedStatus, onChange: setSelectedStatus,
              options: [['all','All Status'],['pending','Pending'],['reviewing','Reviewed'],['resolved','Action Taken'],['dismissed','Dismissed']]
            },
            {
              value: selectedType, onChange: setSelectedType,
              options: [['all','All Types'],['song','Songs'],['video','Videos'],['short_clip','Clips (Shorts)'],['album','Albums'],['comment','Comments'],['user','Users'],['playlist','Playlists']]
            },
            {
              value: dateFilter, onChange: setDateFilter,
              options: [['all','All Time'],['24h','Last 24 Hours'],['7d','Last 7 Days'],['30d','Last 30 Days']]
            },
          ].map((sel, i) => (
            <select
              key={i}
              value={sel.value}
              onChange={(e) => sel.onChange(e.target.value)}
              className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#309605] focus:border-transparent"
            >
              {sel.options.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
            </select>
          ))}
        </div>

        {selectedReports.size > 0 && (
          <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 rounded-lg">
            <span className="text-sm font-medium text-blue-700">{selectedReports.size} selected</span>
            <div className="flex gap-1.5 ml-auto">
              {[
                { label: 'Mark Reviewed', action: 'reviewing' as const, cls: 'bg-blue-600 hover:bg-blue-700' },
                { label: 'Action Taken', action: 'resolved' as const, cls: 'bg-green-600 hover:bg-green-700' },
                { label: 'Dismiss', action: 'dismissed' as const, cls: 'bg-gray-600 hover:bg-gray-700' },
              ].map((btn) => (
                <button
                  key={btn.action}
                  onClick={() => handleBulkAction(btn.action)}
                  disabled={isUpdating}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 ${btn.cls} disabled:opacity-50 rounded-lg text-white text-xs font-medium transition-colors`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="overflow-x-auto bg-white rounded-xl border border-gray-100 shadow-sm">
        {isLoading ? (
          <div className="flex items-center gap-3 py-10 justify-center">
            <LoadingLogo variant="pulse" size={24} />
            <p className="text-sm text-gray-500">Loading reports...</p>
          </div>
        ) : filteredReports.length === 0 ? (
          <div className="p-10 text-center">
            <Flag className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-400">{searchQuery ? 'No reports match your search' : 'No reports found'}</p>
          </div>
        ) : (
          <>
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedReports.size === filteredReports.length && filteredReports.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-gray-300 bg-white text-[#309605] focus:ring-[#309605] focus:ring-offset-0"
                    />
                  </th>
                  {['Thumbnail','Type','Reason','Reporter','Status','Date','Action'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredReports.map((report) => (
                  <tr
                    key={report.id}
                    className={`hover:bg-gray-50 transition-colors ${report.is_high_priority ? 'border-l-2 border-red-400' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedReports.has(report.id)}
                        onChange={() => toggleSelectReport(report.id)}
                        className="w-4 h-4 rounded border-gray-300 bg-white text-[#309605] focus:ring-[#309605] focus:ring-offset-0"
                      />
                    </td>
                    <td className="px-4 py-3">
                      {report.content?.thumbnail_url || report.content?.cover_image_url ? (
                        <img
                          src={report.content.thumbnail_url || report.content.cover_image_url}
                          alt="Thumbnail"
                          className="w-9 h-9 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400">
                          {getReportTypeIcon(report.reported_item_type)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-gray-600">
                        {getReportTypeIcon(report.reported_item_type)}
                        <span className="text-xs capitalize">{report.reported_item_type.replace(/_/g, ' ')}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-900">
                        {report.reason.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </p>
                      {report.content?.title && (
                        <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[160px]">{report.content.title}</p>
                      )}
                      {report.total_reports_count && report.total_reports_count > 1 && (
                        <p className="text-xs text-orange-500 mt-0.5">{report.total_reports_count} total reports</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-900">{report.reporter?.display_name || 'Unknown'}</p>
                      <p className="text-xs text-gray-400">{report.reporter?.email || 'No email'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {getStatusBadge(report.status)}
                        {report.is_high_priority && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-red-50 text-red-500 border border-red-100 rounded-full text-xs font-medium">
                            <AlertTriangle className="w-3 h-3" />
                            High Priority
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-gray-500">{formatDistanceToNowStrict(new Date(report.created_at), { addSuffix: true })}</p>
                      <p className="text-xs text-gray-400">{format(new Date(report.created_at), 'MMM d, yyyy')}</p>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => { setSelectedReport(report); setAdminNotes(report.admin_notes || ''); }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-[#309605] hover:bg-[#3ba208] rounded-lg text-white text-xs font-medium transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <p className="text-xs text-gray-500">Page {currentPage} of {totalPages}</p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-1.5 bg-gray-50 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed border border-gray-200 rounded-lg transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4 text-gray-600" />
                  </button>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="p-1.5 bg-gray-50 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed border border-gray-200 rounded-lg transition-colors"
                  >
                    <ChevronRight className="w-4 h-4 text-gray-600" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {selectedReport && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="bg-white border-gray-200 w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
              <div>
                <h3 className="font-['Inter',sans-serif] font-bold text-gray-900 text-xl">
                  Report Details
                </h3>
                {selectedReport.is_high_priority && (
                  <div className="flex items-center gap-2 mt-2">
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                    <span className="font-['Inter',sans-serif] text-red-600 text-sm font-medium">
                      High Priority - Multiple reports in 24h
                    </span>
                  </div>
                )}
              </div>
              <button
                onClick={() => {
                  setSelectedReport(null);
                  setAdminNotes('');
                }}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <XCircle className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              <div className="p-6 space-y-6">
                {selectedReport.content?.thumbnail_url || selectedReport.content?.cover_image_url ? (
                  <div className="w-full aspect-video bg-black rounded-xl overflow-hidden">
                    <img
                      src={selectedReport.content.thumbnail_url || selectedReport.content.cover_image_url}
                      alt="Content preview"
                      className="w-full h-full object-contain"
                    />
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="font-['Inter',sans-serif] text-gray-600 text-xs mb-1">Report Type</p>
                    <div className="flex items-center gap-2">
                      {getReportTypeIcon(selectedReport.reported_item_type)}
                      <p className="font-['Inter',sans-serif] text-gray-900 text-sm">
                        {selectedReport.reported_item_type.charAt(0).toUpperCase() + selectedReport.reported_item_type.slice(1)}
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="font-['Inter',sans-serif] text-gray-600 text-xs mb-1">Status</p>
                    {getStatusBadge(selectedReport.status)}
                  </div>

                  <div>
                    <p className="font-['Inter',sans-serif] text-gray-600 text-xs mb-1">Reason</p>
                    <p className="font-['Inter',sans-serif] text-gray-900 text-sm">
                      {selectedReport.reason.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </p>
                  </div>

                  <div>
                    <p className="font-['Inter',sans-serif] text-gray-600 text-xs mb-1">Submitted</p>
                    <p className="font-['Inter',sans-serif] text-gray-900 text-sm">
                      {formatDistanceToNowStrict(new Date(selectedReport.created_at), { addSuffix: true })}
                    </p>
                  </div>

                  {selectedReport.content?.title && (
                    <div className="col-span-2">
                      <p className="font-['Inter',sans-serif] text-gray-600 text-xs mb-1">Content Title</p>
                      <p className="font-['Inter',sans-serif] text-gray-900 text-sm font-medium">
                        {selectedReport.content.title}
                      </p>
                    </div>
                  )}

                  {selectedReport.content_url && (
                    <div className="col-span-2">
                      <p className="font-['Inter',sans-serif] text-gray-600 text-xs mb-1">Content URL</p>
                      <a
                        href={selectedReport.content_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-[#309605]/10 hover:bg-[#309605]/20 border border-[#309605] rounded-lg font-['Inter',sans-serif] text-[#309605] text-sm font-medium transition-all"
                      >
                        <ExternalLink className="w-4 h-4" />
                        View Reported Content
                      </a>
                    </div>
                  )}

                  {selectedReport.total_reports_count && selectedReport.total_reports_count > 1 && (
                    <div className="col-span-2">
                      <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
                        <p className="font-['Inter',sans-serif] text-orange-700 text-sm font-medium">
                          This content has been reported {selectedReport.total_reports_count} times
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <p className="font-['Inter',sans-serif] text-gray-600 text-xs mb-2">Reporter</p>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#309605]/20 rounded-full flex items-center justify-center">
                      <User className="w-5 h-5 text-[#309605]" />
                    </div>
                    <div>
                      <p className="font-['Inter',sans-serif] text-gray-900 text-sm font-medium">
                        {selectedReport.reporter?.display_name || 'Unknown'}
                      </p>
                      <p className="font-['Inter',sans-serif] text-gray-600 text-xs">
                        {selectedReport.reporter?.email || 'No email'}
                      </p>
                    </div>
                  </div>
                </div>

                {selectedReport.reported_user && (
                  <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                    <p className="font-['Inter',sans-serif] text-red-600 text-xs mb-2">Reported User</p>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                        <User className="w-5 h-5 text-red-600" />
                      </div>
                      <div>
                        <p className="font-['Inter',sans-serif] text-gray-900 text-sm font-medium">
                          {selectedReport.reported_user.display_name}
                        </p>
                        <p className="font-['Inter',sans-serif] text-gray-600 text-xs">
                          {selectedReport.reported_user.email}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {selectedReport.description && (
                  <div>
                    <p className="font-['Inter',sans-serif] text-gray-600 text-xs mb-2">Description</p>
                    <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                      <p className="font-['Inter',sans-serif] text-gray-900 text-sm leading-relaxed">
                        {selectedReport.description}
                      </p>
                    </div>
                  </div>
                )}

                {selectedReport.admin_notes && (
                  <div>
                    <p className="font-['Inter',sans-serif] text-gray-600 text-xs mb-2">Previous Admin Notes</p>
                    <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                      <p className="font-['Inter',sans-serif] text-gray-700 text-sm leading-relaxed">
                        {selectedReport.admin_notes}
                      </p>
                    </div>
                  </div>
                )}

                <div>
                  <label className="font-['Inter',sans-serif] text-gray-900 text-sm font-medium mb-2 block">
                    Admin Notes
                  </label>
                  <textarea
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    placeholder="Add notes about your review..."
                    rows={4}
                    className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-[#309605] focus:border-[#309605] resize-none"
                  />
                </div>

                {selectedReport.status === 'pending' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <button
                        onClick={() => handleUpdateStatus(selectedReport.id, 'reviewing')}
                        disabled={isUpdating}
                        className="px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-['Inter',sans-serif] font-medium text-white text-sm transition-all flex items-center justify-center gap-2"
                      >
                        <Eye className="w-4 h-4" />
                        Mark as Reviewed
                      </button>

                      <button
                        onClick={() => handleUpdateStatus(selectedReport.id, 'resolved')}
                        disabled={isUpdating}
                        className="px-4 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-['Inter',sans-serif] font-medium text-white text-sm transition-all flex items-center justify-center gap-2"
                      >
                        <CheckCircle className="w-4 h-4" />
                        Action Taken
                      </button>

                      <button
                        onClick={() => handleUpdateStatus(selectedReport.id, 'dismissed')}
                        disabled={isUpdating}
                        className="px-4 py-3 bg-gray-600 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-['Inter',sans-serif] font-medium text-white text-sm transition-all flex items-center justify-center gap-2"
                      >
                        <XCircle className="w-4 h-4" />
                        Dismiss Report
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {selectedReport.reported_item_type !== 'user' && (
                        <button
                          onClick={() => handleRemoveContent(selectedReport)}
                          disabled={isUpdating}
                          className="px-4 py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-['Inter',sans-serif] font-medium text-white text-sm transition-all flex items-center justify-center gap-2"
                        >
                          <Trash2 className="w-4 h-4" />
                          Remove Content
                        </button>
                      )}

                      {selectedReport.reported_user_id && (
                        <>
                          <button
                            onClick={() => handleWarnUser(selectedReport)}
                            disabled={isUpdating}
                            className="px-4 py-3 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-['Inter',sans-serif] font-medium text-white text-sm transition-all flex items-center justify-center gap-2"
                          >
                            <AlertTriangle className="w-4 h-4" />
                            Warn User
                          </button>

                          <button
                            onClick={() => handleBanUser(selectedReport)}
                            disabled={isUpdating}
                            className="px-4 py-3 bg-red-800 hover:bg-red-900 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-['Inter',sans-serif] font-medium text-white text-sm transition-all flex items-center justify-center gap-2"
                          >
                            <Ban className="w-4 h-4" />
                            Ban User
                          </button>
                        </>
                      )}
                    </div>

                    <button
                      onClick={() => handleAddNote(selectedReport.id)}
                      disabled={isUpdating || !adminNotes.trim()}
                      className="w-full px-4 py-3 bg-[#309605] hover:bg-[#3ba208] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-['Inter',sans-serif] font-medium text-white text-sm transition-all flex items-center justify-center gap-2"
                    >
                      <FileText className="w-4 h-4" />
                      Add Note
                    </button>
                  </div>
                )}

                <button
                  onClick={() => handleDeleteReport(selectedReport.id)}
                  className="w-full px-4 py-3 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg font-['Inter',sans-serif] font-medium text-red-700 text-sm transition-all flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Report
                </button>

                {selectedReport.reviewed_by && (
                  <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <p className="font-['Inter',sans-serif] text-gray-600 text-xs mb-2">Review Information</p>
                    <div className="space-y-1">
                      <p className="font-['Inter',sans-serif] text-gray-900 text-sm">
                        Reviewed by: {selectedReport.reviewer?.display_name || 'Unknown'}
                      </p>
                      {selectedReport.reviewed_at && (
                        <p className="font-['Inter',sans-serif] text-gray-600 text-xs">
                          {formatDistanceToNowStrict(new Date(selectedReport.reviewed_at), { addSuffix: true })}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={confirmModal.confirmText}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        isDestructive={confirmModal.isDestructive}
      />
    </div>
  );
};
