import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { X, Check, Ban, Eye, Search, Filter, Download, Image as ImageIcon } from 'lucide-react';

interface CreatorRequest {
  id: string;
  user_id: string;
  artist_name: string;
  real_name: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  country: string;
  genre: string;
  bio: string | null;
  social_links: any;
  id_document_url: string | null;
  cover_art_url: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'banned';
  rejection_reason: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

interface Stats {
  total: number;
  active: number;
  banned: number;
  pending: number;
}

export const CreatorRequestsSection: React.FC = () => {
  const [requests, setRequests] = useState<CreatorRequest[]>([]);
  const [filteredRequests, setFilteredRequests] = useState<CreatorRequest[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, banned: 0, pending: 0 });
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<CreatorRequest | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showBanModal, setShowBanModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Badge config state
  const [badgeFile, setBadgeFile] = useState<File | null>(null);
  const [badgePreview, setBadgePreview] = useState('');
  const [uploadingBadge, setUploadingBadge] = useState(false);
  const [approvalMode, setApprovalMode] = useState<'manual' | 'automatic'>('manual');
  const [approvalModeLoading, setApprovalModeLoading] = useState(true);
  const [updatingApprovalMode, setUpdatingApprovalMode] = useState(false);

  useEffect(() => {
    fetchRequests();
    fetchBadgeConfig();
    fetchApprovalMode();
  }, []);

  useEffect(() => {
    filterRequests();
  }, [requests, statusFilter, searchQuery]);

  const fetchRequests = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('creator_requests')
        .select('*')
        .order('submitted_at', { ascending: false });

      if (error) {
        if (error.message?.includes('permission denied')) {
          console.error('RLS permission denied for creator_requests:', error);
        }
        throw error;
      }

      setRequests(data || []);
      calculateStats(data || []);
    } catch (error: any) {
      console.error('Error fetching creator requests:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchBadgeConfig = async () => {
    try {
      const { data, error } = await supabase
        .from('verified_badge_config')
        .select('badge_url, updated_at')
        .maybeSingle();

      if (error) {
        console.warn('Error fetching badge config:', error);
        return;
      }

      if (data?.badge_url) {
        setBadgePreview(data.badge_url);
        console.log('Badge config loaded successfully', {
          url: data.badge_url,
          updatedAt: data.updated_at
        });
      } else {
        console.warn('No badge configuration found in database');
        setBadgePreview('');
      }
    } catch (error) {
      console.error('Error fetching badge config:', error);
    }
  };

  const fetchApprovalMode = async () => {
    try {
      setApprovalModeLoading(true);
      const { data, error } = await supabase
        .from('creator_request_settings')
        .select('approval_mode')
        .eq('single_row_marker', 1)
        .maybeSingle();

      if (error) {
        console.warn('Error fetching creator request approval mode:', error);
        return;
      }

      if (data?.approval_mode === 'automatic' || data?.approval_mode === 'manual') {
        setApprovalMode(data.approval_mode);
      }
    } catch (error) {
      console.error('Error fetching creator request approval mode:', error);
    } finally {
      setApprovalModeLoading(false);
    }
  };

  const handleApprovalModeChange = async (mode: 'manual' | 'automatic') => {
    if (mode === approvalMode || updatingApprovalMode) return;

    try {
      setUpdatingApprovalMode(true);

      const { error } = await supabase
        .from('creator_request_settings')
        .update({
          approval_mode: mode,
          updated_at: new Date().toISOString()
        })
        .eq('single_row_marker', 1);

      if (error) throw error;

      setApprovalMode(mode);

      if (mode === 'automatic') {
        const { data: approvedCount, error: autoApproveError } = await supabase.rpc(
          'auto_approve_pending_creator_requests'
        );

        if (autoApproveError) {
          console.error('Error auto-approving pending creator requests:', autoApproveError);
          alert(
            `Mode set to automatic, but failed to approve existing pending requests: ${autoApproveError.message}`
          );
        } else if (approvedCount && approvedCount > 0) {
          await fetchRequests();
          alert(
            `Creator request mode updated to automatic. ${approvedCount} pending request(s) were approved.`
          );
          return;
        }
      }

      alert(`Creator request mode updated to ${mode}.`);
    } catch (error: any) {
      console.error('Error updating creator request approval mode:', error);
      alert(error?.message || 'Failed to update creator request mode');
    } finally {
      setUpdatingApprovalMode(false);
    }
  };

  const calculateStats = (data: CreatorRequest[]) => {
    const stats = {
      total: data.length,
      active: data.filter(r => r.status === 'approved').length,
      banned: data.filter(r => r.status === 'banned').length,
      pending: data.filter(r => r.status === 'pending').length,
    };
    setStats(stats);
  };

  const filterRequests = () => {
    let filtered = [...requests];

    if (statusFilter !== 'all') {
      filtered = filtered.filter(r => r.status === statusFilter);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(r =>
        r.artist_name.toLowerCase().includes(query) ||
        r.real_name.toLowerCase().includes(query) ||
        (r.full_name && r.full_name.toLowerCase().includes(query)) ||
        r.email.toLowerCase().includes(query) ||
        r.country.toLowerCase().includes(query)
      );
    }

    setFilteredRequests(filtered);
  };

  const handleApprove = async (requestId: string) => {
    try {
      setActionLoading(true);
      const { error } = await supabase.rpc('approve_creator_request', {
        request_id: requestId
      });

      if (error) throw error;

      await fetchRequests();
      setSelectedRequest(null);
      alert('Creator request approved! Notification sent to user.');
    } catch (error: any) {
      console.error('Error approving request:', error);
      alert(error.message || 'Failed to approve request');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (requestId: string) => {
    try {
      setActionLoading(true);
      const { error } = await supabase.rpc('reject_creator_request', {
        request_id: requestId,
        reason: rejectionReason || null
      });

      if (error) throw error;

      await fetchRequests();
      setSelectedRequest(null);
      setShowRejectModal(false);
      setRejectionReason('');
      alert('Creator request rejected! Notification sent to user with reason.');
    } catch (error: any) {
      console.error('Error rejecting request:', error);
      alert(error.message || 'Failed to reject request');
    } finally {
      setActionLoading(false);
    }
  };

  const handleBan = async (requestId: string) => {
    try {
      setActionLoading(true);
      const { error } = await supabase.rpc('ban_creator_request', {
        request_id: requestId,
        reason: rejectionReason || null
      });

      if (error) throw error;

      await fetchRequests();
      setSelectedRequest(null);
      setShowBanModal(false);
      setRejectionReason('');
      alert('User account suspended! Suspension notification sent to user.');
    } catch (error: any) {
      console.error('Error banning user:', error);
      alert(error.message || 'Failed to ban user');
    } finally {
      setActionLoading(false);
    }
  };

  const handleBadgeUpload = async () => {
    if (!badgeFile) {
      alert('Please select a badge image');
      return;
    }

    try {
      setUploadingBadge(true);
      console.log('Badge upload started', { fileName: badgeFile.name, fileSize: badgeFile.size });

      // Step 1: Get authenticated user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated. Please log in and try again.');
      console.log('Step 1 - Auth verified', { userId: user.id });

      // Step 2: Verify admin status and account active
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id, role, is_active, email')
        .eq('id', user.id)
        .maybeSingle();

      if (userError) {
        console.error('Error fetching user data:', userError);
        throw new Error('Failed to verify admin status. Please try again.');
      }

      if (!userData) {
        throw new Error('User profile not found in system.');
      }

      if (userData.role !== 'admin') {
        throw new Error(`Access denied. Your role is "${userData.role}". Only admins can upload badges.`);
      }

      if (!userData.is_active) {
        throw new Error('Your admin account is not active. Please contact support.');
      }

      console.log('Step 2 - Admin verification passed', { role: userData.role, isActive: userData.is_active, email: userData.email });

      // Step 3: Upload file to storage with secure path
      const { validateImageFile, getValidatedExtension, sanitizeFileName, ALLOWED_IMAGE_EXTENSIONS } = await import('../../lib/fileSecurity');
      const validation = validateImageFile(badgeFile);
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid badge image file');
      }
      const fileExt = getValidatedExtension(badgeFile.name, ALLOWED_IMAGE_EXTENSIONS);
      if (!fileExt) {
        throw new Error('Invalid file extension. Allowed: jpg, jpeg, png, webp, gif');
      }
      const sanitizedFileName = sanitizeFileName(badgeFile.name);
      const fileName = `verified-badge-${Date.now()}.${fileExt}`;
      const filePath = `badges/${fileName}`;

      console.log('Step 3 - Uploading file to storage', { filePath, bucketName: 'thumbnails' });

      const { error: uploadError } = await supabase.storage
        .from('thumbnails')
        .upload(filePath, badgeFile, { upsert: true });

      if (uploadError) {
        console.error('Storage upload failed:', uploadError);
        throw new Error(`Failed to upload badge file to storage: ${uploadError.message}`);
      }

      console.log('Step 3 - Storage upload succeeded', { filePath });

      // Step 4: Get public URL with cache-busting parameter
      const { data: urlData } = supabase.storage
        .from('thumbnails')
        .getPublicUrl(filePath);

      const cacheBustParam = `?t=${Date.now()}`;
      const newBadgeUrl = urlData.publicUrl + cacheBustParam;
      console.log('Step 4 - Got public URL with cache-busting', { badgeUrl: newBadgeUrl });

      const timestamp = new Date().toISOString();

      // Step 5: Update badge config using UPSERT pattern
      // Since we enforce exactly one row in the database, we update that row
      console.log('Step 5 - Updating badge config in database using UPSERT');

      const { data: updateResult, error: updateError } = await supabase
        .from('verified_badge_config')
        .update({
          badge_url: newBadgeUrl,
          updated_at: timestamp,
          updated_by: user.id
        })
        .eq('single_row_marker', 1)
        .select('id, badge_url, updated_at')
        .maybeSingle();

      if (updateError) {
        console.error('Badge update database error:', {
          message: updateError.message,
          code: updateError.code,
          hint: updateError.hint,
          details: updateError.details,
          adminRole: userData.role,
          adminActive: userData.is_active
        });

        if (updateError.message?.includes('row-level security') || updateError.message?.includes('permission denied')) {
          throw new Error(`RLS policy blocked badge update. Verify admin permissions are active. Error: ${updateError.message}`);
        }
        throw new Error(`Failed to update badge in database: ${updateError.message}`);
      }

      if (!updateResult) {
        // No row exists - insert it (fallback, should not happen with constraint)
        console.log('No badge config found - creating new one');
        const { data: insertResult, error: insertError } = await supabase
          .from('verified_badge_config')
          .insert({
            badge_url: newBadgeUrl,
            updated_at: timestamp,
            updated_by: user.id
          })
          .select('id, badge_url, updated_at')
          .maybeSingle();

        if (insertError) {
          console.error('Badge insert database error:', {
            message: insertError.message,
            code: insertError.code,
            hint: insertError.hint,
            details: insertError.details
          });

          if (insertError.message?.includes('row-level security') || insertError.message?.includes('permission denied')) {
            throw new Error(`RLS policy blocked badge creation. Verify admin permissions are active. Error: ${insertError.message}`);
          }
          throw new Error(`Failed to create badge in database: ${insertError.message}`);
        }

        if (!insertResult) {
          throw new Error('Badge configuration could not be created. Please try again.');
        }

        console.log('Step 5 - Badge config created successfully', insertResult);
      } else {
        console.log('Step 5 - Badge config updated successfully', updateResult);
      }

      // Step 6: Verify badge was actually saved by fetching it back
      console.log('Step 6 - Verifying badge persistence by fetching from database');
      const { data: verifyData, error: verifyError } = await supabase
        .from('verified_badge_config')
        .select('badge_url, updated_at')
        .maybeSingle();

      if (verifyError) {
        console.warn('Could not verify badge (non-critical):', verifyError);
      } else if (verifyData?.badge_url) {
        console.log('Step 6 - Badge persistence verified', {
          fetchedUrl: verifyData.badge_url,
          uploadedUrl: newBadgeUrl,
          match: verifyData.badge_url === newBadgeUrl
        });
      }

      // Step 7: Sync all creator badges
      console.log('Step 7 - Syncing badges for all creators');
      try {
        await supabase.rpc('sync_creator_verified_badges');
        console.log('Step 7 - Badge sync completed');
      } catch (syncError: any) {
        console.warn('Failed to sync badges (non-critical):', syncError);
      }

      // Step 8: Update UI with new badge and fetch fresh from DB
      console.log('Step 8 - Updating UI and fetching fresh badge config');
      await fetchBadgeConfig();
      setBadgeFile(null);

      console.log('Badge upload completed successfully', { newBadgeUrl });
      alert('Verified badge updated successfully for all creators!');
    } catch (error: any) {
      console.error('Badge upload error:', error);
      const errorMessage = error?.message || 'Failed to upload badge. Please check your admin permissions and try again.';
      console.error('Full error details:', {
        message: error?.message,
        code: error?.code,
        status: error?.status,
        stack: error?.stack
      });
      alert(errorMessage);
    } finally {
      setUploadingBadge(false);
    }
  };

  const handleBadgeFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setBadgeFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setBadgePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'approved': return 'bg-green-100 text-green-800';
      case 'rejected': return 'bg-red-100 text-red-800';
      case 'banned': return 'bg-gray-900 text-white';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 leading-tight">Artiste/Creator Requests</h2>
          <p className="text-sm text-gray-400 mt-0.5">Review and manage creator applications</p>
        </div>
        {stats.pending > 0 && (
          <span className="px-2.5 py-1 bg-amber-500 text-white rounded-full text-xs font-semibold">
            {stats.pending} Pending
          </span>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Creators', value: stats.total, color: 'text-gray-900' },
          { label: 'Active (Approved)', value: stats.active, color: 'text-green-600' },
          { label: 'Banned', value: stats.banned, color: 'text-gray-700' },
          { label: 'Pending', value: stats.pending, color: 'text-amber-600' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-500">{stat.label}</p>
            <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Verified Badge Manager */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
            <ImageIcon className="w-4 h-4 text-green-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900 leading-tight">Verified Badge Manager</h3>
            <p className="text-xs text-gray-400 mt-0.5">Upload a new badge to update all existing creators automatically</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Current Badge</label>
            {badgePreview ? (
              <div className="flex items-center gap-3">
                <img key={badgePreview} src={badgePreview} alt="Verified Badge" className="w-12 h-12 object-contain rounded-lg border border-gray-100"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <span className="text-sm text-gray-500">Current verified badge</span>
              </div>
            ) : (
              <div className="text-sm text-gray-400">No badge configured</div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Upload New Badge</label>
            <div className="flex items-center gap-2">
              <label className="flex-1 flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                <ImageIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span className="text-sm text-gray-600 truncate">{badgeFile ? badgeFile.name : 'Choose file'}</span>
                <input type="file" accept="image/*" onChange={handleBadgeFileChange} className="hidden" />
              </label>
              <button
                onClick={handleBadgeUpload}
                disabled={!badgeFile || uploadingBadge}
                className="px-3 py-2 bg-[#309605] text-white text-sm rounded-lg hover:bg-[#3ba208] disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              >
                {uploadingBadge ? 'Uploading...' : 'Update Badge'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1.5">Recommended: PNG or SVG, 24x24px or larger</p>
          </div>
        </div>
      </div>

      {/* Creator Request Approval Mode */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 leading-tight">Creator Request Mode</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Choose whether new creator requests require admin review or are approved instantly
            </p>
          </div>
          {approvalModeLoading ? (
            <span className="text-xs text-gray-400">Loading mode...</span>
          ) : (
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                approvalMode === 'automatic'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-amber-100 text-amber-700'
              }`}
            >
              {approvalMode === 'automatic' ? 'Automatic' : 'Manual'}
            </span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={() => handleApprovalModeChange('manual')}
            disabled={approvalModeLoading || updatingApprovalMode}
            className={`px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
              approvalMode === 'manual'
                ? 'border-[#309605] bg-[#e6f7f1] text-[#1f6e03]'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            Manual Review
          </button>

          <button
            onClick={() => handleApprovalModeChange('automatic')}
            disabled={approvalModeLoading || updatingApprovalMode}
            className={`px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
              approvalMode === 'automatic'
                ? 'border-[#309605] bg-[#e6f7f1] text-[#1f6e03]'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            Automatic Approval
          </button>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name, artist name, email, or country..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#309605]"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#309605]"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="banned">Banned</option>
          </select>
        </div>
      </div>

      {/* Requests Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center">
            <div className="animate-spin w-6 h-6 border-2 border-[#309605] border-t-transparent rounded-full mx-auto"></div>
            <p className="mt-3 text-sm text-gray-500">Loading requests...</p>
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">
            No creator requests found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Artist Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Real Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Full Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Country</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Submitted</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredRequests.map((request) => (
                  <tr key={request.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900">{request.artist_name}</div>
                      <div className="text-xs text-gray-500">{request.genre}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{request.real_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{request.full_name || 'N/A'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{request.email}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{request.country}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${getStatusColor(request.status)}`}>
                        {request.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(request.submitted_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => setSelectedRequest(request)} className="p-1.5 text-[#309605] hover:bg-green-50 rounded-lg transition-colors">
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* View Details Modal */}
      {selectedRequest && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h3 className="text-xl font-bold">Creator Request Details</h3>
              <button
                onClick={() => setSelectedRequest(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Status Badge */}
              <div>
                <span className={`px-3 py-1 text-sm font-semibold rounded-full ${getStatusColor(selectedRequest.status)}`}>
                  {selectedRequest.status.toUpperCase()}
                </span>
                {selectedRequest.rejection_reason && (
                  <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
                    <strong>Reason:</strong> {selectedRequest.rejection_reason}
                  </div>
                )}
              </div>

              {/* Basic Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Artist Name</label>
                  <p className="mt-1 text-gray-900">{selectedRequest.artist_name}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Real Name</label>
                  <p className="mt-1 text-gray-900">{selectedRequest.real_name}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Full Name</label>
                  <p className="mt-1 text-gray-900">{selectedRequest.full_name || 'N/A'}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Email</label>
                  <p className="mt-1 text-gray-900">{selectedRequest.email}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Phone</label>
                  <p className="mt-1 text-gray-900">{selectedRequest.phone || 'N/A'}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Country</label>
                  <p className="mt-1 text-gray-900">{selectedRequest.country}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Genre</label>
                  <p className="mt-1 text-gray-900">{selectedRequest.genre}</p>
                </div>
              </div>

              {/* Bio */}
              {selectedRequest.bio && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Bio</label>
                  <p className="mt-1 text-gray-900 whitespace-pre-wrap">{selectedRequest.bio}</p>
                </div>
              )}

              {/* Social Links */}
              {selectedRequest.social_links && Object.keys(selectedRequest.social_links).length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Social Media</label>
                  <div className="space-y-1">
                    {Object.entries(selectedRequest.social_links).map(([platform, url]: [string, any]) => (
                      <div key={platform} className="flex items-center gap-2">
                        <span className="text-sm font-medium capitalize">{platform}:</span>
                        <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm text-[#309605] hover:underline">
                          {url}
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* File Downloads */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {selectedRequest.id_document_url && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">ID Document</label>
                    <a
                      href={selectedRequest.id_document_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 border border-gray-300 rounded hover:bg-gray-200"
                    >
                      <Download className="w-4 h-4" />
                      <span className="text-sm">Download ID</span>
                    </a>
                  </div>
                )}
                {selectedRequest.cover_art_url && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Cover Art</label>
                    <a
                      href={selectedRequest.cover_art_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 border border-gray-300 rounded hover:bg-gray-200"
                    >
                      <Download className="w-4 h-4" />
                      <span className="text-sm">Download Cover</span>
                    </a>
                  </div>
                )}
              </div>

              {/* Timestamps */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
                <div>
                  <strong>Submitted:</strong> {new Date(selectedRequest.submitted_at).toLocaleString()}
                </div>
                {selectedRequest.reviewed_at && (
                  <div>
                    <strong>Reviewed:</strong> {new Date(selectedRequest.reviewed_at).toLocaleString()}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              {selectedRequest.status === 'pending' && (
                <div className="flex gap-3 pt-4 border-t border-gray-200">
                  <button
                    onClick={() => handleApprove(selectedRequest.id)}
                    disabled={actionLoading}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                  >
                    <Check className="w-5 h-5" />
                    {actionLoading ? 'Processing...' : 'Approve'}
                  </button>
                  <button
                    onClick={() => {
                      setShowRejectModal(true);
                      setRejectionReason('');
                    }}
                    disabled={actionLoading}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                  >
                    <X className="w-5 h-5" />
                    Reject
                  </button>
                  <button
                    onClick={() => {
                      setShowBanModal(true);
                      setRejectionReason('');
                    }}
                    disabled={actionLoading}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-50"
                  >
                    <Ban className="w-5 h-5" />
                    Ban
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && selectedRequest && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-lg max-w-lg w-full p-6">
            <h3 className="text-lg font-bold mb-4">Reject Creator Request</h3>
            <p className="text-sm text-gray-600 mb-4">
              Provide a reason for rejecting this request (optional):
            </p>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Enter rejection reason..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#309605] mb-4"
              rows={4}
            />
            <div className="flex gap-3">
              <button
                onClick={() => setShowRejectModal(false)}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={() => handleReject(selectedRequest.id)}
                disabled={actionLoading}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading ? 'Processing...' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ban Modal */}
      {showBanModal && selectedRequest && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-lg max-w-lg w-full p-6">
            <h3 className="text-lg font-bold mb-4">Ban User</h3>
            <p className="text-sm text-gray-600 mb-4">
              This will ban the user and prevent them from accessing the platform. Provide a reason (optional):
            </p>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Enter ban reason..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#309605] mb-4"
              rows={4}
            />
            <div className="flex gap-3">
              <button
                onClick={() => setShowBanModal(false)}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={() => handleBan(selectedRequest.id)}
                disabled={actionLoading}
                className="flex-1 px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-50"
              >
                {actionLoading ? 'Processing...' : 'Ban User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
