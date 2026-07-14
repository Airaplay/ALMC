import React from 'react';
import { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  UserMinus,
  Clock,
  AlertTriangle,
  Mail,
  Info,
  FileText,
  Shield,
  KeyRound
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAdminActionConfirm } from '../../components/AdminActionConfirmModal';
import { AdminRolesSection } from './AdminRolesSection';

interface AdminRoleOption {
  id: string;
  key: string;
  name: string;
  description: string | null;
  legacy_role: 'admin' | 'manager' | 'editor' | 'account';
  is_system: boolean;
  is_active: boolean;
  feature_count: number;
}

const LEGACY_ROLE_OPTIONS: AdminRoleOption[] = [
  { id: 'editor', key: 'editor', name: 'Editor', description: 'Can manage content only', legacy_role: 'editor', is_system: true, is_active: true, feature_count: 3 },
  { id: 'manager', key: 'manager', name: 'Manager', description: 'Can manage content and view analytics', legacy_role: 'manager', is_system: true, is_active: true, feature_count: 0 },
  { id: 'account', key: 'account', name: 'Account', description: 'Can manage financial operations and accounting', legacy_role: 'account', is_system: true, is_active: true, feature_count: 0 },
  { id: 'admin', key: 'admin', name: 'Admin', description: 'Full access to all features', legacy_role: 'admin', is_system: true, is_active: true, feature_count: 0 },
];

export const AdminSettingsSection = (): JSX.Element => {
  const { confirm, ConfirmModal } = useAdminActionConfirm();

  // State for admin users
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [isLoadingAdmins, setIsLoadingAdmins] = useState(true);
  const [adminError, setAdminError] = useState<string | null>(null);
  
  // State for activity logs
  const [activityLogs, setActivityLogs] = useState<any[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(true);
  const [logsError, setLogsError] = useState<string | null>(null);
  
  // State for new admin form
  const [showAddAdminForm, setShowAddAdminForm] = useState(false);
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminRole, setNewAdminRole] = useState('editor');
  const [availableRoles, setAvailableRoles] = useState<AdminRoleOption[]>(LEGACY_ROLE_OPTIONS);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  
  // State for system notice form
  const [showSystemNoticeForm, setShowSystemNoticeForm] = useState(false);
  const [noticeTitle, setNoticeTitle] = useState('');
  const [noticeMessage, setNoticeMessage] = useState('');
  const [noticeExpiry, setNoticeExpiry] = useState('');
  const [isSubmittingNotice, setIsSubmittingNotice] = useState(false);
  const [noticeError, setNoticeError] = useState<string | null>(null);
  const [noticeSuccess, setNoticeSuccess] = useState<string | null>(null);
  
  // State for filters
  const [adminFilter, setAdminFilter] = useState<string>('all');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [dateRange, setDateRange] = useState<{start: string, end: string}>({
    start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days ago
    end: new Date().toISOString().split('T')[0] // today
  });
  
  // State for revoke confirmation
  const [revokeConfirmation, setRevokeConfirmation] = useState<{show: boolean, userId: string, userName: string}>({
    show: false,
    userId: '',
    userName: ''
  });

  // State for Terms and Conditions tab
  const [activeTab, setActiveTab] = useState<'admins' | 'roles' | 'notices' | 'logs' | 'terms'>('admins');
  const [terms, setTerms] = useState<{
    user_signup: string;
    artist_registration: string;
  }>({
    user_signup: '',
    artist_registration: ''
  });
  const [isLoadingTerms, setIsLoadingTerms] = useState(false);
  const [isSavingTerms, setIsSavingTerms] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [termsSuccess, setTermsSuccess] = useState<string | null>(null);

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

  const formatActionType = (actionType: string): string => {
    // Convert snake_case to Title Case with spaces
    return actionType
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const getActionTypeIcon = (actionType: string) => {
    switch (actionType) {
      case 'assign_role':
        return <UserPlus className="w-4 h-4 text-blue-600" />;
      case 'revoke_role':
        return <UserMinus className="w-4 h-4 text-red-600" />;
      case 'set_system_notice':
        return <Mail className="w-4 h-4 text-[#309605]" />;
      default:
        return <Info className="w-4 h-4 text-gray-600" />;
    }
  };

  useEffect(() => {
    fetchAdminUsers();
    fetchAdminRoles();
    fetchActivityLogs();
    if (activeTab === 'terms') {
      fetchTerms();
    }
  }, [activeTab]);

  const fetchAdminUsers = async () => {
    try {
      setIsLoadingAdmins(true);
      setAdminError(null);
      
      const { data, error } = await supabase.rpc('admin_get_admin_users');

      if (error) throw error;
      
      setAdminUsers(data || []);
    } catch (err) {
      console.error('Error fetching admin users:', err);
      setAdminError(err instanceof Error ? err.message : 'Failed to load admin users');
    } finally {
      setIsLoadingAdmins(false);
    }
  };

  const fetchAdminRoles = async () => {
    try {
      const { data, error } = await supabase.rpc('admin_list_roles');
      if (error) throw error;

      const activeRoles = ((data || []) as AdminRoleOption[]).filter(role => role.is_active);
      if (activeRoles.length > 0) {
        setAvailableRoles(activeRoles);
        if (!activeRoles.some(role => role.key === newAdminRole || role.id === newAdminRole)) {
          setNewAdminRole(activeRoles[0].key);
        }
      }
    } catch (err) {
      console.warn('Falling back to legacy admin roles:', err);
      setAvailableRoles(LEGACY_ROLE_OPTIONS);
    }
  };

  const fetchActivityLogs = async () => {
    try {
      setIsLoadingLogs(true);
      setLogsError(null);

      // Convert date strings to timestamps
      const startDate = new Date(dateRange.start);
      startDate.setHours(0, 0, 0, 0);
      
      const endDate = new Date(dateRange.end);
      endDate.setHours(23, 59, 59, 999);

      const { data, error } = await supabase.rpc('admin_get_activity_logs', {
        admin_id_filter: adminFilter !== 'all' ? adminFilter : null,
        action_type_filter: actionFilter !== 'all' ? actionFilter : null,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        limit_param: 100,
        offset_param: 0
      });

      if (error) throw error;
      
      setActivityLogs(data || []);
    } catch (err) {
      console.error('Error fetching activity logs:', err);
      setLogsError(err instanceof Error ? err.message : 'Failed to load activity logs');
    } finally {
      setIsLoadingLogs(false);
    }
  };

  const handleAssignRole = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newAdminEmail.trim()) {
      setFormError('Email is required');
      return;
    }

    const selectedRole = availableRoles.find(role => role.key === newAdminRole || role.id === newAdminRole);

    const confirmed = await confirm({
      title: 'Assign Admin Role',
      description: `You are about to grant ${selectedRole?.name || newAdminRole} privileges to ${newAdminEmail.trim()}. This gives them access to sensitive admin functions. Confirm your password to proceed.`,
      actionLabel: `Assign ${selectedRole?.name || newAdminRole} role`,
      actionVariant: selectedRole?.legacy_role === 'admin' ? 'danger' : 'warning',
      requirePasswordConfirm: true,
    });

    if (!confirmed) return;

    setIsSubmitting(true);
    setFormError(null);
    setFormSuccess(null);

    try {
      const { data, error } = await supabase.rpc('admin_assign_role', {
        user_email_param: newAdminEmail.trim(),
        role_param: newAdminRole
      });

      if (error) throw error;
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      setFormSuccess(`User ${newAdminEmail} has been assigned the ${selectedRole?.name || newAdminRole} role`);
      setNewAdminEmail('');
      
      // Refresh admin users list
      fetchAdminUsers();
      
      // Close form after a delay
      setTimeout(() => {
        setShowAddAdminForm(false);
        setFormSuccess(null);
      }, 3000);
    } catch (err) {
      console.error('Error assigning role:', err);
      setFormError(err instanceof Error ? err.message : 'Failed to assign role');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevokeRole = async (userId: string) => {
    const targetUser = adminUsers.find(u => u.id === userId);
    const userName = targetUser?.display_name || targetUser?.email || 'this user';

    const confirmed = await confirm({
      title: 'Revoke Admin Access',
      description: `You are about to revoke all admin privileges from ${userName}. They will immediately lose access to the admin dashboard. Confirm your password to proceed.`,
      actionLabel: 'Revoke Access',
      actionVariant: 'danger',
      requirePasswordConfirm: true,
    });

    if (!confirmed) {
      setRevokeConfirmation({ show: false, userId: '', userName: '' });
      return;
    }

    setIsSubmitting(true);

    try {
      const { data, error } = await supabase.rpc('admin_revoke_role', {
        user_id_param: userId
      });

      if (error) throw error;
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      setFormSuccess('Admin role revoked successfully');
      
      // Refresh admin users list
      fetchAdminUsers();
      
      // Close confirmation dialog
      setRevokeConfirmation({show: false, userId: '', userName: ''});
      
      // Clear success message after a delay
      setTimeout(() => {
        setFormSuccess(null);
      }, 3000);
    } catch (err) {
      console.error('Error revoking role:', err);
      setFormError(err instanceof Error ? err.message : 'Failed to revoke role');
      
      // Clear error message after a delay
      setTimeout(() => {
        setFormError(null);
      }, 5000);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendSystemNotice = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!noticeTitle.trim() || !noticeMessage.trim()) {
      setNoticeError('Title and message are required');
      return;
    }
    
    setIsSubmittingNotice(true);
    setNoticeError(null);
    setNoticeSuccess(null);
    
    try {
      // Convert expiry date to timestamp if provided
      let expiryTimestamp = null;
      if (noticeExpiry) {
        const expiryDate = new Date(noticeExpiry);
        expiryDate.setHours(23, 59, 59, 999);
        expiryTimestamp = expiryDate.toISOString();
      }
      
      const { data, error } = await supabase.rpc('admin_set_system_notice', {
        title_param: noticeTitle.trim(),
        message_param: noticeMessage.trim(),
        expires_at_param: expiryTimestamp
      });

      if (error) throw error;
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      setNoticeSuccess('System notice sent successfully to all users');
      setNoticeTitle('');
      setNoticeMessage('');
      setNoticeExpiry('');
      
      // Refresh activity logs
      fetchActivityLogs();
      
      // Close form after a delay
      setTimeout(() => {
        setShowSystemNoticeForm(false);
        setNoticeSuccess(null);
      }, 3000);
    } catch (err) {
      console.error('Error sending system notice:', err);
      setNoticeError(err instanceof Error ? err.message : 'Failed to send system notice');
    } finally {
      setIsSubmittingNotice(false);
    }
  };

  const handleFilterChange = () => {
    fetchActivityLogs();
  };

  const fetchTerms = async () => {
    try {
      setIsLoadingTerms(true);
      setTermsError(null);

      const { data, error } = await supabase
        .from('terms_and_conditions')
        .select('type, content')
        .eq('is_active', true)
        .order('version', { ascending: false });

      if (error) throw error;

      const termsMap: { [key: string]: string } = {};
      (data || []).forEach((term: any) => {
        termsMap[term.type] = term.content;
      });

      setTerms({
        user_signup: termsMap['user_signup'] || '',
        artist_registration: termsMap['artist_registration'] || ''
      });
    } catch (err) {
      console.error('Error fetching terms:', err);
      setTermsError(err instanceof Error ? err.message : 'Failed to load terms and conditions');
    } finally {
      setIsLoadingTerms(false);
    }
  };

  const handleSaveTerms = async (type: 'user_signup' | 'artist_registration') => {
    try {
      setIsSavingTerms(true);
      setTermsError(null);
      setTermsSuccess(null);

      // Get current user ID
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }

      // First, deactivate existing active terms of this type
      await supabase
        .from('terms_and_conditions')
        .update({ is_active: false })
        .eq('type', type)
        .eq('is_active', true);

      // Get the highest version number for this type
      const { data: existingVersions } = await supabase
        .from('terms_and_conditions')
        .select('version')
        .eq('type', type)
        .order('version', { ascending: false })
        .limit(1);

      const nextVersion = existingVersions && existingVersions.length > 0 
        ? existingVersions[0].version + 1 
        : 1;

      // Create new version
      const { error: insertError } = await supabase
        .from('terms_and_conditions')
        .insert({
          type,
          content: terms[type],
          version: nextVersion,
          is_active: true,
          created_by: session.user.id,
          updated_by: session.user.id
        });

      if (insertError) throw insertError;

      setTermsSuccess(`${type === 'user_signup' ? 'User Signup' : 'Artist Registration'} terms updated successfully`);
      setTimeout(() => setTermsSuccess(null), 3000);
    } catch (err) {
      console.error('Error saving terms:', err);
      setTermsError(err instanceof Error ? err.message : 'Failed to save terms and conditions');
    } finally {
      setIsSavingTerms(false);
    }
  };

  return (
    <div className="space-y-4 min-h-full">
      <ConfirmModal />
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0">
          <Shield className="w-4 h-4 text-gray-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900 leading-tight">Admin Settings & Roles</h2>
          <p className="text-sm text-gray-400 mt-0.5">Manage admin accounts and platform settings</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('admins')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'admins'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              Admin Users
            </div>
          </button>
          <button
            onClick={() => setActiveTab('roles')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'roles'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4" />
              Roles & Features
            </div>
          </button>
          <button
            onClick={() => setActiveTab('notices')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'notices'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4" />
              System Notices
            </div>
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'logs'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Activity Log
            </div>
          </button>
          <button
            onClick={() => setActiveTab('terms')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'terms'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Terms & Conditions
            </div>
          </button>
        </nav>
      </div>

      {/* Success/Error Messages */}
      {(formSuccess || formError || termsSuccess || termsError) && (
        <div className={`p-4 rounded-lg ${
          (formError || termsError) ? 'bg-red-100 border border-red-200' : 'bg-green-100 border border-green-200'
        }`}>
          <p className={`${
            (formError || termsError) ? 'text-red-700' : 'text-green-700'
          }`}>
            {formError || formSuccess || termsError || termsSuccess}
          </p>
        </div>
      )}

      {/* Admin Users Section */}
      {activeTab === 'admins' && (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            Admin Users
          </h3>
          
          <button
            onClick={() => setShowAddAdminForm(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2"
          >
            <UserPlus className="w-4 h-4" />
            Add Admin
          </button>
        </div>

        {/* Add Admin Form */}
        {showAddAdminForm && (
          <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-100">
            <h4 className="text-lg font-semibold text-gray-900 mb-4">
              Assign Admin Role
            </h4>
            
            <form onSubmit={handleAssignRole} className="space-y-4">
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  User Email *
                </label>
                <input
                  type="email"
                  value={newAdminEmail}
                  onChange={(e) => setNewAdminEmail(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter user email"
                  required
                />
                <p className="mt-1 text-xs text-gray-500">
                  User must already have an account in the system
                </p>
              </div>
              
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Role *
                </label>
                <select
                  value={newAdminRole}
                  onChange={(e) => setNewAdminRole(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {availableRoles.map(role => (
                    <option key={role.id} value={role.key}>
                      {role.name}{role.is_system ? '' : ' (Custom)'}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  Custom role feature access can be configured in the Roles & Features tab.
                </p>
              </div>
              
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddAdminForm(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !newAdminEmail.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Assigning...' : 'Assign Role'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Admin Users Table */}
        {isLoadingAdmins ? (
          <div className="flex items-center justify-center py-12">
            {null}
            <p className="ml-4 text-gray-700">Loading admin users...</p>
          </div>
        ) : adminError && adminUsers.length === 0 ? (
          <div className="p-6 bg-red-100 border border-red-200 rounded-lg text-center">
            <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
            <p className="text-red-700">{adminError}</p>
            <button
              onClick={fetchAdminUsers}
              className="mt-4 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg"
            >
              Try Again
            </button>
          </div>
        ) : adminUsers.length === 0 ? (
          <div className="p-6 bg-gray-100 rounded-lg text-center">
            <p className="text-gray-700">No admin users found</p>
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-hide">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="p-4 text-gray-700 font-medium">User</th>
                  <th className="p-4 text-gray-700 font-medium">Role</th>
                  <th className="p-4 text-gray-700 font-medium">Added</th>
                  <th className="p-4 text-gray-700 font-medium">Last Activity</th>
                  <th className="p-4 text-gray-700 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {adminUsers.map((user) => (
                  <tr key={user.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="p-4">
                      <div>
                        <p className="font-medium text-gray-900">{user.display_name || 'Unnamed User'}</p>
                        <p className="text-gray-600 text-sm">{user.email}</p>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        (user.legacy_role || user.role) === 'admin'
                          ? 'bg-green-100 text-green-700 border border-green-200'
                          : (user.legacy_role || user.role) === 'manager'
                          ? 'bg-blue-100 text-blue-700 border border-blue-200'
                          : (user.legacy_role || user.role) === 'account'
                          ? 'bg-yellow-100 text-yellow-700 border border-yellow-200'
                          : 'bg-green-100 text-green-700 border border-green-200'
                      }`}>
                        {user.role_name || user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                      </span>
                      {user.is_custom_role && (
                        <p className="mt-1 text-xs text-gray-500">
                          Custom role • {user.feature_count || 0} feature(s)
                        </p>
                      )}
                    </td>
                    <td className="p-4 text-gray-700">
                      {formatDate(user.created_at)}
                    </td>
                    <td className="p-4 text-gray-700">
                      {user.last_activity ? formatDate(user.last_activity) : 'Never'}
                    </td>
                    <td className="p-4">
                      <button
                        onClick={() => setRevokeConfirmation({
                          show: true,
                          userId: user.id,
                          userName: user.display_name || user.email
                        })}
                        className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm flex items-center gap-1"
                      >
                        <UserMinus className="w-4 h-4" />
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Revoke Confirmation Dialog */}
        {revokeConfirmation.show && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
              <h4 className="text-xl font-bold text-gray-900 mb-4">
                Revoke Admin Access
              </h4>
              <p className="text-gray-700 mb-6">
                Are you sure you want to revoke admin access from <strong>{revokeConfirmation.userName}</strong>? This user will be downgraded to a regular listener.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setRevokeConfirmation({show: false, userId: '', userName: ''})}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleRevokeRole(revokeConfirmation.userId)}
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
                >
                  {isSubmitting ? 'Revoking...' : 'Revoke Access'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      )}

      {activeTab === 'roles' && (
        <AdminRolesSection
          onRolesChanged={() => {
            fetchAdminRoles();
            fetchAdminUsers();
          }}
        />
      )}

      {/* System Notice Section */}
      {activeTab === 'notices' && (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Mail className="w-5 h-5 text-[#309605]" />
            System-Wide Notices
          </h3>
          
          <button
            onClick={() => setShowSystemNoticeForm(true)}
            className="px-4 py-2 bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg flex items-center gap-2"
          >
            <Mail className="w-4 h-4" />
            New System Notice
          </button>
        </div>

        {/* System Notice Form */}
        {showSystemNoticeForm && (
          <div className="mb-6 p-4 bg-green-50 rounded-lg border border-green-100">
            <h4 className="text-lg font-semibold text-gray-900 mb-4">
              Send System-Wide Notice
            </h4>
            
            {noticeSuccess && (
              <div className="mb-4 p-3 bg-green-100 border border-green-200 rounded-lg">
                <p className="text-green-700 text-sm">{noticeSuccess}</p>
              </div>
            )}
            
            {noticeError && (
              <div className="mb-4 p-3 bg-red-100 border border-red-200 rounded-lg">
                <p className="text-red-700 text-sm">{noticeError}</p>
              </div>
            )}
            
            <form onSubmit={handleSendSystemNotice} className="space-y-4">
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Notice Title *
                </label>
                <input
                  type="text"
                  value={noticeTitle}
                  onChange={(e) => setNoticeTitle(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#309605] focus:border-[#309605]"
                  placeholder="e.g., System Maintenance"
                  required
                />
              </div>
              
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Notice Message *
                </label>
                <textarea
                  value={noticeMessage}
                  onChange={(e) => setNoticeMessage(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#309605] focus:border-[#309605] resize-none"
                  placeholder="Enter the notice message..."
                  required
                />
              </div>
              
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Expiry Date (Optional)
                </label>
                <input
                  type="date"
                  value={noticeExpiry}
                  onChange={(e) => setNoticeExpiry(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#309605] focus:border-[#309605]"
                />
                <p className="mt-1 text-xs text-gray-500">
                  If set, the notice will automatically expire on this date
                </p>
              </div>
              
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSystemNoticeForm(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingNotice || !noticeTitle.trim() || !noticeMessage.trim()}
                  className="px-4 py-2 bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmittingNotice ? 'Sending...' : 'Send Notice'}
                </button>
              </div>
            </form>
          </div>
        )}

        <p className="text-gray-700 mb-4">
          System notices are sent to all users and appear in their notifications. Use this feature for important announcements.
        </p>
      </div>
      )}

      {/* Activity Log Section */}
      {activeTab === 'logs' && (
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2 mb-6">
          <Clock className="w-5 h-5 text-gray-600" />
          Admin Activity Log
        </h3>

        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1">
            <label className="block text-gray-700 text-sm font-medium mb-2">
              Admin User
            </label>
            <select
              value={adminFilter}
              onChange={(e) => setAdminFilter(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
            >
              <option value="all">All Admins</option>
              {adminUsers.map(user => (
                <option key={user.id} value={user.id}>
                  {user.display_name || user.email}
                </option>
              ))}
            </select>
          </div>
          
          <div className="flex-1">
            <label className="block text-gray-700 text-sm font-medium mb-2">
              Action Type
            </label>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
            >
              <option value="all">All Actions</option>
              <option value="assign_role">Assign Role</option>
              <option value="revoke_role">Revoke Role</option>
              <option value="set_system_notice">System Notice</option>
            </select>
          </div>
          
          <div className="flex-1">
            <label className="block text-gray-700 text-sm font-medium mb-2">
              Date Range
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange({...dateRange, start: e.target.value})}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
              />
              <span className="self-center">to</span>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange({...dateRange, end: e.target.value})}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
              />
            </div>
          </div>
          
          <div className="self-end">
            <button
              onClick={handleFilterChange}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg flex items-center gap-2 h-[42px]"
            >
              <AlertTriangle className="w-4 h-4" />
              Apply Filters
            </button>
          </div>
        </div>

        {/* Activity Logs Table */}
        {isLoadingLogs ? (
          <div className="flex items-center justify-center py-12">
            {null}
            <p className="ml-4 text-gray-700">Loading activity logs...</p>
          </div>
        ) : logsError ? (
          <div className="p-6 bg-red-100 border border-red-200 rounded-lg text-center">
            <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
            <p className="text-red-700">{logsError}</p>
            <button
              onClick={fetchActivityLogs}
              className="mt-4 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg"
            >
              Try Again
            </button>
          </div>
        ) : activityLogs.length === 0 ? (
          <div className="p-6 bg-gray-100 rounded-lg text-center">
            <p className="text-gray-700">No activity logs found for the selected filters</p>
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-hide">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="p-4 text-gray-700 font-medium">Admin</th>
                  <th className="p-4 text-gray-700 font-medium">Action</th>
                  <th className="p-4 text-gray-700 font-medium">Details</th>
                  <th className="p-4 text-gray-700 font-medium">Date & Time</th>
                </tr>
              </thead>
              <tbody>
                {activityLogs.map((log) => (
                  <tr key={log.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="p-4">
                      <div>
                        <p className="font-medium text-gray-900">{log.admin_name || 'Unnamed Admin'}</p>
                        <p className="text-gray-600 text-sm">{log.admin_email}</p>
                        <span className={`mt-1 inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          log.admin_role === 'admin'
                            ? 'bg-green-100 text-green-700'
                            : log.admin_role === 'manager'
                            ? 'bg-blue-100 text-blue-700'
                            : log.admin_role === 'account'
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-green-100 text-green-700'
                        }`}>
                          {log.admin_role.charAt(0).toUpperCase() + log.admin_role.slice(1)}
                        </span>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {getActionTypeIcon(log.action_type)}
                        <span className="text-gray-900 font-medium">
                          {formatActionType(log.action_type)}
                        </span>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="max-w-xs overflow-hidden">
                        {log.action_type === 'assign_role' && (
                          <div>
                            <p className="text-gray-700">
                              Assigned <span className="font-medium">{log.action_details.new_role}</span> role to user
                            </p>
                            <p className="text-gray-600 text-sm truncate">
                              {log.action_details.user_email}
                            </p>
                          </div>
                        )}
                        {log.action_type === 'revoke_role' && (
                          <div>
                            <p className="text-gray-700">
                              Revoked <span className="font-medium">{log.action_details.previous_role}</span> role from user
                            </p>
                            <p className="text-gray-600 text-sm truncate">
                              {log.action_details.user_email}
                            </p>
                          </div>
                        )}
                        {log.action_type === 'set_system_notice' && (
                          <div>
                            <p className="text-gray-700">
                              Sent system notice: <span className="font-medium">{log.action_details.title}</span>
                            </p>
                            {log.action_details.expires_at && (
                              <p className="text-gray-600 text-sm">
                                Expires: {formatDate(log.action_details.expires_at)}
                              </p>
                            )}
                          </div>
                        )}
                        {!['assign_role', 'revoke_role', 'set_system_notice'].includes(log.action_type) && (
                          <p className="text-gray-700 text-sm">
                            {JSON.stringify(log.action_details)}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-gray-700 whitespace-nowrap">
                      {formatDate(log.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {/* Terms and Conditions Section */}
      {activeTab === 'terms' && (
      <div className="space-y-6">
        {/* User Signup Terms */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <FileText className="w-5 h-5 text-blue-600" />
            User Signup Terms & Conditions
          </h3>
          <p className="text-gray-600 text-sm mb-4">
            Terms shown to users during account creation/signup
          </p>

          {isLoadingTerms ? (
            <div className="flex items-center justify-center py-12">
              {null}
              <p className="ml-4 text-gray-700">Loading terms...</p>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Terms Content *
                </label>
                <textarea
                  value={terms.user_signup}
                  onChange={(e) => setTerms({ ...terms, user_signup: e.target.value })}
                  rows={10}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none font-mono text-sm"
                  placeholder="Enter terms and conditions for user signup..."
                />
              </div>
              <button
                onClick={() => handleSaveTerms('user_signup')}
                disabled={isSavingTerms || !terms.user_signup.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSavingTerms ? 'Saving...' : 'Save User Signup Terms'}
              </button>
            </>
          )}
        </div>

        {/* Artist Registration Terms */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <FileText className="w-5 h-5 text-green-600" />
            Artist Registration Terms & Conditions
          </h3>
          <p className="text-gray-600 text-sm mb-4">
            Terms shown to users during artist registration
          </p>

          {isLoadingTerms ? (
            <div className="flex items-center justify-center py-12">
              {null}
              <p className="ml-4 text-gray-700">Loading terms...</p>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Terms Content *
                </label>
                <textarea
                  value={terms.artist_registration}
                  onChange={(e) => setTerms({ ...terms, artist_registration: e.target.value })}
                  rows={10}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 resize-none font-mono text-sm"
                  placeholder="Enter terms and conditions for artist registration..."
                />
              </div>
              <button
                onClick={() => handleSaveTerms('artist_registration')}
                disabled={isSavingTerms || !terms.artist_registration.trim()}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSavingTerms ? 'Saving...' : 'Save Artist Registration Terms'}
              </button>
            </>
          )}
        </div>
      </div>
      )}
    </div>
  );
};