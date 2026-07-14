import React, { useState, useEffect } from 'react';
import { HelpCircle, Clock, CheckCircle, XCircle, AlertCircle, RefreshCw, MessageSquare, User, Send, Mail } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { LoadingLogo } from '../../components/LoadingLogo';

interface SupportTicket {
  id: string;
  ticket_number: string;
  user_id: string;
  user_email: string;
  user_display_name: string;
  subject: string;
  message: string;
  category: string;
  status: 'pending' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  admin_notes: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

interface SupportTicketReply {
  id: string;
  body: string;
  is_staff: boolean;
  author_id: string;
  author_display_name: string | null;
  created_at: string;
}

export const SupportTicketsSection = (): JSX.Element => {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [adminNotes, setAdminNotes] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [newPriority, setNewPriority] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [replies, setReplies] = useState<SupportTicketReply[]>([]);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  useEffect(() => {
    fetchTickets();
  }, [statusFilter]);

  useEffect(() => {
    if (!showModal || !selectedTicket) {
      setReplies([]);
      setReplyBody('');
      return;
    }

    const loadReplies = async () => {
      setLoadingReplies(true);
      try {
        const { data, error: rpcError } = await supabase.rpc('admin_get_support_ticket_replies', {
          p_ticket_id: selectedTicket.id
        });
        if (rpcError) throw rpcError;
        setReplies((data as SupportTicketReply[]) || []);
      } catch (err) {
        console.error('Error loading ticket replies:', err);
        setReplies([]);
      } finally {
        setLoadingReplies(false);
      }
    };

    void loadReplies();
  }, [showModal, selectedTicket?.id]);

  const fetchTickets = async () => {
    try {
      setIsLoading(true);
      setError(null);
      setSuccessMessage(null);

      const { data, error } = await supabase.rpc('admin_get_support_tickets', {
        p_status: statusFilter === 'all' ? null : statusFilter,
        p_limit: 100,
        p_offset: 0
      });

      if (error) throw error;

      setTickets(data || []);
    } catch (err: any) {
      console.error('Error fetching tickets:', err);
      setError(err.message || 'Failed to load support tickets');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTicketClick = (ticket: SupportTicket) => {
    setSelectedTicket(ticket);
    setAdminNotes(ticket.admin_notes || '');
    setNewStatus(ticket.status === 'closed' ? 'resolved' : ticket.status);
    setNewPriority(ticket.priority);
    setShowModal(true);
  };

  const handleUpdateTicket = async () => {
    if (!selectedTicket) return;

    try {
      setIsUpdating(true);
      setError(null);
      setSuccessMessage(null);

      const { error: rpcError } = await supabase.rpc('admin_update_support_ticket', {
        p_ticket_id: selectedTicket.id,
        p_status: newStatus,
        p_priority: newPriority,
        p_admin_notes: adminNotes || null
      });
      if (rpcError) throw rpcError;

      setShowModal(false);
      setSelectedTicket(null);
      fetchTickets();
    } catch (err: any) {
      console.error('Error updating ticket:', err);
      setError(err.message || 'Failed to update ticket');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleMarkResolved = async () => {
    if (!selectedTicket) return;
    try {
      setIsUpdating(true);
      setError(null);
      setSuccessMessage(null);
      const { error: rpcError } = await supabase.rpc('admin_update_support_ticket', {
        p_ticket_id: selectedTicket.id,
        p_status: 'resolved',
        p_priority: newPriority,
        p_admin_notes: adminNotes || null
      });
      if (rpcError) throw rpcError;
      setNewStatus('resolved');
      setShowModal(false);
      setSelectedTicket(null);
      fetchTickets();
    } catch (err: any) {
      console.error('Error resolving ticket:', err);
      setError(err.message || 'Failed to mark ticket resolved');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSendReply = async () => {
    if (!selectedTicket) return;
    const trimmed = replyBody.trim();
    if (!trimmed) {
      setError('Enter a message to send to the user.');
      return;
    }
    try {
      setSendingReply(true);
      setError(null);
      setSuccessMessage(null);
      const { data: replyResult, error: rpcError } = await supabase.rpc('admin_reply_support_ticket', {
        p_ticket_id: selectedTicket.id,
        p_message: trimmed
      });
      if (rpcError) throw rpcError;
      setReplyBody('');
      await processQueuedSupportEmail();
      const { data: repliesData, error: reloadErr } = await supabase.rpc('admin_get_support_ticket_replies', {
        p_ticket_id: selectedTicket.id
      });
      if (!reloadErr) setReplies((repliesData as SupportTicketReply[]) || []);
      const result = replyResult as { recipient_email?: string } | null;
      if (result?.recipient_email) {
        setSuccessMessage(`Reply queued from support@airaplay.com to ${result.recipient_email}.`);
      }
      fetchTickets();
    } catch (err: any) {
      console.error('Error sending reply:', err);
      setError(err.message || 'Failed to send reply');
    } finally {
      setSendingReply(false);
    }
  };

  const processQueuedSupportEmail = async () => {
    try {
      await supabase.functions.invoke('process-email-queue', {
        method: 'POST',
        body: { ignore_scheduled_for: true },
      });
    } catch (err) {
      console.warn('Support email queued but not processed immediately:', err);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'bg-red-100 text-red-700 border-red-200';
      case 'high':
        return 'bg-orange-100 text-orange-700 border-orange-200';
      case 'medium':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'low':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4" />;
      case 'in_progress':
        return <AlertCircle className="w-4 h-4" />;
      case 'resolved':
        return <CheckCircle className="w-4 h-4" />;
      default:
        return <HelpCircle className="w-4 h-4" />;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="space-y-4 min-h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
            <HelpCircle className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 leading-tight">Support Tickets</h2>
            <p className="text-sm text-gray-400 mt-0.5">Review and respond to user support requests</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#309605]"
          >
            <option value="pending">Pending</option>
            <option value="in_progress">In Process</option>
            <option value="resolved">Resolved</option>
            <option value="all">All Tickets</option>
          </select>

          <button
            onClick={fetchTickets}
            className="p-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg text-gray-600 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-100 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {successMessage && (
        <div className="p-3 bg-green-50 border border-green-100 rounded-lg">
          <p className="text-sm text-green-700">{successMessage}</p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <LoadingLogo variant="pulse" size={32} />
          <p className="ml-4 text-gray-700">Loading support tickets...</p>
        </div>
      ) : tickets.length === 0 ? (
        <div className="p-8 bg-white rounded-xl border border-gray-100 shadow-sm text-center">
          <HelpCircle className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No {statusFilter === 'all' ? '' : statusFilter} support tickets found.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {tickets.map((ticket) => (
            <button
              key={ticket.id}
              onClick={() => handleTicketClick(ticket)}
              className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:shadow-md transition-shadow text-left"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-start gap-3 flex-1">
                  <div className={`p-2 rounded-lg ${getPriorityColor(ticket.priority)} border`}>
                    {getStatusIcon(ticket.status)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold text-gray-900 text-base">{ticket.subject}</h4>
                      <span className="px-2 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                        {ticket.ticket_number}
                      </span>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getPriorityColor(ticket.priority)}`}>
                        {ticket.priority.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                      <User className="w-3 h-3" />
                      <span>{ticket.user_display_name || 'User'}</span>
                      <span>•</span>
                      <Mail className="w-3 h-3" />
                      <span>{ticket.user_email}</span>
                      <span>•</span>
                      <span className="text-xs">{ticket.category}</span>
                      <span>•</span>
                      <span className="text-xs">
                        {ticket.assigned_to_name ? `Assigned to ${ticket.assigned_to_name}` : 'Unassigned'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 line-clamp-2">{ticket.message}</p>
                  </div>
                </div>
                <div className="text-right ml-4 flex-shrink-0">
                  <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium border ${
                    ticket.status === 'pending'
                      ? 'bg-yellow-100 text-yellow-700 border-yellow-200'
                      : ticket.status === 'in_progress'
                      ? 'bg-blue-100 text-blue-700 border-blue-200'
                      : ticket.status === 'resolved'
                      ? 'bg-green-100 text-green-700 border-green-200'
                      : 'bg-gray-100 text-gray-700 border-gray-200'
                  }`}>
                    {ticket.status === 'in_progress' ? 'IN PROCESS' : ticket.status.replace('_', ' ').toUpperCase()}
                  </span>
                  <p className="text-xs text-gray-500 mt-2">{formatDate(ticket.created_at)}</p>
                </div>
              </div>

              {ticket.admin_notes && (
                <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <MessageSquare className="w-3 h-3 text-blue-600" />
                    <span className="text-xs font-medium text-blue-900">Admin Notes</span>
                  </div>
                  <p className="text-sm text-blue-700">{ticket.admin_notes}</p>
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Ticket Details Modal */}
      {showModal && selectedTicket && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-gray-900">Support Ticket Details</h3>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-2 hover:bg-gray-100 rounded-full"
                >
                  <XCircle className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Ticket Info */}
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="grid grid-cols-2 gap-4 mb-3">
                    <div>
                      <label className="text-xs font-medium text-gray-600">Ticket Number</label>
                      <p className="text-sm font-semibold text-gray-900">{selectedTicket.ticket_number}</p>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600">User</label>
                      <p className="text-sm font-medium text-gray-900">
                        {selectedTicket.user_display_name || selectedTicket.user_email}
                      </p>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600">Email Address</label>
                      <p className="text-sm font-medium text-gray-900 break-all">{selectedTicket.user_email}</p>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600">Category</label>
                      <p className="text-sm font-medium text-gray-900">{selectedTicket.category}</p>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600">Assigned Rep</label>
                      <p className="text-sm font-medium text-gray-900">
                        {selectedTicket.assigned_to_name || 'Unassigned'}
                      </p>
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="text-xs font-medium text-gray-600">Subject</label>
                    <p className="text-sm font-semibold text-gray-900">{selectedTicket.subject}</p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600">Message</label>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{selectedTicket.message}</p>
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-xs text-gray-500">
                      Submitted: {formatDate(selectedTicket.created_at)}
                    </p>
                  </div>
                </div>

                {/* Staff replies (stored thread; emails are queued through ZeptoMail) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Staff replies</label>
                  {loadingReplies ? (
                    <p className="text-sm text-gray-500 py-2">Loading replies...</p>
                  ) : replies.length === 0 ? (
                    <p className="text-sm text-gray-500 py-2 border border-dashed border-gray-200 rounded-lg px-3">
                      No staff replies yet. Use "Reply to user" below to email the user.
                    </p>
                  ) : (
                    <ul className="space-y-2 max-h-40 overflow-y-auto border border-gray-100 rounded-lg p-3 bg-gray-50/80">
                      {replies.map((r) => (
                        <li key={r.id} className="text-sm">
                          <span className="text-xs text-gray-500">
                            {formatDate(r.created_at)}
                            {r.author_display_name ? ` - ${r.author_display_name}` : ''}
                            {r.is_staff ? ' - Staff' : ''}
                          </span>
                          <p className="text-gray-800 whitespace-pre-wrap mt-0.5">{r.body}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Status Update */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value)}
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                  >
                    <option value="pending">Pending</option>
                    <option value="in_progress">In Process</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </div>

                {/* Priority Update */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Priority</label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value)}
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>

                {/* Admin Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Admin Notes</label>
                  <textarea
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    rows={4}
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605] resize-none"
                    placeholder="Add notes about this ticket..."
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Internal only. Use "Reply to user" to email the user.
                  </p>
                </div>

                {/* User-visible reply (queued through ZeptoMail email_queue) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Reply to user</label>
                  <div className="mb-2 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">
                    Emails are sent as <strong>Airaplay Support &lt;support@airaplay.com&gt;</strong>. Users can reply to that address; keep the ticket number in the subject when handling mailbox replies.
                  </div>
                  <textarea
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    rows={3}
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605] resize-none"
                    placeholder={`Write a reply... It will be sent to ${selectedTicket.user_email}.`}
                  />
                  <button
                    type="button"
                    onClick={() => void handleSendReply()}
                    disabled={sendingReply || !replyBody.trim()}
                    className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-all disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                    {sendingReply ? 'Queueing email...' : 'Send as support@airaplay.com'}
                  </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 mt-6">
                <button
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg text-gray-700 transition-all"
                >
                  Cancel
                </button>
                {selectedTicket.status !== 'resolved' && selectedTicket.status !== 'closed' && (
                  <button
                    type="button"
                    onClick={() => void handleMarkResolved()}
                    disabled={isUpdating}
                    className="flex-1 px-4 py-2 bg-white hover:bg-gray-50 border border-[#309605] text-[#309605] rounded-lg transition-all disabled:opacity-50 font-medium"
                  >
                    {isUpdating ? 'Saving...' : 'Mark as resolved'}
                  </button>
                )}
                <button
                  onClick={() => void handleUpdateTicket()}
                  disabled={isUpdating}
                  className="flex-1 px-4 py-2 bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg transition-all disabled:opacity-50 font-medium"
                >
                  {isUpdating ? 'Updating...' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
