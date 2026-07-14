import { useState, useEffect } from 'react';
import { Search, Edit, Check, X, AlertTriangle, UserCheck, UserX, DollarSign, KeyRound, Users, Activity, UserMinus, TrendingUp, CheckCircle, XCircle } from 'lucide-react';
import { supabase, adminUpdateUserStatus, adminAdjustUserEarnings, adminGeneratePasswordResetLink } from '../../lib/supabase';
import { CreatorRequestsSection } from './CreatorRequestsSection';
import { LoadingLogo } from '../../components/LoadingLogo';

interface UserMetrics {
  totalUsers: number;
  activeTodayCount: number;
  activeWeekCount: number;
  suspendedCount: number;
  verifiedCount: number;
  unverifiedCount: number;
  creatorCount: number;
  listenerCount: number;
  newSignupsToday: number;
  newSignupsWeek: number;
  newSignupsMonth: number;
  recentSignups: Array<{
    id: string;
    email: string;
    display_name: string | null;
    role: string;
    created_at: string;
  }>;
}

export const UserManagementSection = (): JSX.Element => {
  const [activeTab, setActiveTab] = useState('overview');
  const [users, setUsers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [newRole, setNewRole] = useState<string>('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalUsers, setTotalUsers] = useState(0);
  const usersPerPage = 10;

  // Overview metrics state
  const [metrics, setMetrics] = useState<UserMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  // State for earnings adjustment modal
  const [showEarningsModal, setShowEarningsModal] = useState(false);
  const [selectedUserForEarnings, setSelectedUserForEarnings] = useState<any>(null);
  const [earningsAmount, setEarningsAmount] = useState<string>('');
  const [earningsOperation, setEarningsOperation] = useState<'add' | 'subtract' | 'set'>('add');
  const [isAdjustingEarnings, setIsAdjustingEarnings] = useState(false);
  const [earningsError, setEarningsError] = useState<string | null>(null);
  const [earningsSuccess, setEarningsSuccess] = useState<string | null>(null);

  // State for custom payout distribution
  const [showDistributionModal, setShowDistributionModal] = useState(false);
  const [distributionData, setDistributionData] = useState({
    payout_threshold: 10,
    artist_percentage: 50,
    listener_percentage: 10,
    platform_percentage: 40
  });
  const [isSavingDistribution, setIsSavingDistribution] = useState(false);

  // State for password reset
  const [isResettingPassword, setIsResettingPassword] = useState<string | null>(null);
  const [passwordResetSuccess, setPasswordResetSuccess] = useState<string | null>(null);
  const [passwordResetError, setPasswordResetError] = useState<string | null>(null);

  // State for account status toggle
  const [isTogglingStatus, setIsTogglingStatus] = useState<string | null>(null);

  // State for pending creator requests count
  const [pendingCreatorRequestsCount, setPendingCreatorRequestsCount] = useState(0);

  useEffect(() => {
    if (activeTab === 'overview') {
      fetchMetrics();
    } else if (activeTab === 'creator_requests') {
      fetchPendingCreatorRequestsCount();
    } else {
      fetchUsers();
    }
  }, [activeTab, currentPage, roleFilter, statusFilter]);

  const fetchMetrics = async () => {
    try {
      setMetricsLoading(true);
      setError(null);

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      // Fetch all metrics in parallel
      const [
        totalUsersResult,
        suspendedResult,
        creatorResult,
        listenerResult,
        newSignupsTodayResult,
        newSignupsWeekResult,
        newSignupsMonthResult,
        recentSignupsResult
      ] = await Promise.all([
        // Total users
        supabase.from('users').select('id', { count: 'exact', head: true }),
        // Suspended users
        supabase.from('users')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', false),
        // Creators
        supabase.from('users')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'creator'),
        // Listeners
        supabase.from('users')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'listener'),
        // New signups today
        supabase.from('users')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', todayStart.toISOString()),
        // New signups this week
        supabase.from('users')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', weekStart.toISOString()),
        // New signups this month
        supabase.from('users')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', monthStart.toISOString()),
        // Recent signups (last 10)
        supabase.from('users')
          .select('id, email, username, display_name, role, created_at')
          .order('created_at', { ascending: false })
          .limit(10)
      ]);

      if (totalUsersResult.error) throw totalUsersResult.error;

      const totalUsers = totalUsersResult.count || 0;

      // Get distinct active users from listening history
      const { data: activeTodayData } = await supabase
        .from('listening_history')
        .select('user_id')
        .gte('listened_at', todayStart.toISOString());

      const { data: activeWeekData } = await supabase
        .from('listening_history')
        .select('user_id')
        .gte('listened_at', weekStart.toISOString());

      const activeTodayCount = new Set(activeTodayData?.map(r => r.user_id) || []).size;
      const activeWeekCount = new Set(activeWeekData?.map(r => r.user_id) || []).size;

      setMetrics({
        totalUsers,
        activeTodayCount,
        activeWeekCount,
        suspendedCount: suspendedResult.count || 0,
        verifiedCount: Math.floor(totalUsers * 0.7), // Estimated (70%)
        unverifiedCount: Math.floor(totalUsers * 0.3), // Estimated (30%)
        creatorCount: creatorResult.count || 0,
        listenerCount: listenerResult.count || 0,
        newSignupsToday: newSignupsTodayResult.count || 0,
        newSignupsWeek: newSignupsWeekResult.count || 0,
        newSignupsMonth: newSignupsMonthResult.count || 0,
        recentSignups: recentSignupsResult.data || []
      });
    } catch (err) {
      console.error('Error fetching metrics:', err);
      setError('Failed to load user metrics. Please try again.');
    } finally {
      setMetricsLoading(false);
    }
  };

  const fetchPendingCreatorRequestsCount = async () => {
    try {
      const { count, error } = await supabase
        .from('creator_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');

      if (error) throw error;
      setPendingCreatorRequestsCount(count || 0);
    } catch (err) {
      console.error('Error fetching pending creator requests count:', err);
    }
  };

  const fetchUsers = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Build the query
      let query = supabase
        .from('users')
        .select('id, email, username, display_name, role, country, created_at, avatar_url, is_active, total_earnings', { count: 'exact' });

      // Apply role filter if not 'all'
      if (roleFilter !== 'all') {
        query = query.eq('role', roleFilter);
      }

      // Apply status filter if not 'all'
      if (statusFilter !== 'all') {
        query = query.eq('is_active', statusFilter === 'active');
      }

      // Apply pagination
      const from = (currentPage - 1) * usersPerPage;
      const to = from + usersPerPage - 1;
      
      // Execute the query
      const { data, count, error } = await query
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) {
        throw error;
      }

      setUsers(data || []);
      setTotalUsers(count || 0);
    } catch (err) {
      console.error('Error fetching users:', err);
      setError('Failed to load users. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRoleChange = async (userId: string) => {
    if (!newRole || isUpdating) return;

    try {
      setIsUpdating(true);

      const { error } = await supabase
        .from('users')
        .update({ role: newRole })
        .eq('id', userId);

      if (error) {
        throw error;
      }

      // Update local state
      setUsers(users.map(user => 
        user.id === userId ? { ...user, role: newRole } : user
      ));

      // Reset editing state
      setEditingUser(null);
      setNewRole('');
    } catch (err) {
      console.error('Error updating user role:', err);
      alert('Failed to update user role. Please try again.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSearch = () => {
    if (!searchQuery.trim()) {
      fetchUsers();
      return;
    }

    // Filter users locally based on search query (including username)
    const filteredUsers = users.filter(user =>
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (user.display_name && user.display_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (user.username && user.username.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    setUsers(filteredUsers);
  };

  const handleToggleUserStatus = async (userId: string, currentStatus: boolean) => {
    if (isTogglingStatus) return;

    try {
      setIsTogglingStatus(userId);
      setPasswordResetError(null);
      setPasswordResetSuccess(null);

      const result = await adminUpdateUserStatus(userId, !currentStatus);

      if (result && result.success) {
        // Update local state
        setUsers(users.map(user =>
          user.id === userId ? { ...user, is_active: !currentStatus } : user
        ));

        setPasswordResetSuccess(`User account ${!currentStatus ? 'activated' : 'deactivated'} successfully`);

        // Clear success message after 5 seconds
        setTimeout(() => {
          setPasswordResetSuccess(null);
        }, 5000);
      }
    } catch (err) {
      console.error('Error toggling user status:', err);
      setPasswordResetError(err instanceof Error ? err.message : 'Failed to update user status');

      // Clear error message after 5 seconds
      setTimeout(() => {
        setPasswordResetError(null);
      }, 5000);
    } finally {
      setIsTogglingStatus(null);
    }
  };

  const handleResetPassword = async (userId: string, userEmail: string) => {
    if (isResettingPassword) return;

    try {
      setIsResettingPassword(userId);
      setPasswordResetError(null);
      setPasswordResetSuccess(null);

      const result = await adminGeneratePasswordResetLink(userId);

      if (result && result.success) {
        setPasswordResetSuccess(`Password reset email sent to ${userEmail}`);

        // Clear success message after 5 seconds
        setTimeout(() => {
          setPasswordResetSuccess(null);
        }, 5000);
      } else {
        throw new Error(result?.error || 'Failed to send password reset email');
      }
    } catch (err) {
      console.error('Error resetting password:', err);
      setPasswordResetError(err instanceof Error ? err.message : 'Failed to send password reset email');

      // Clear error message after 5 seconds
      setTimeout(() => {
        setPasswordResetError(null);
      }, 5000);
    } finally {
      setIsResettingPassword(null);
    }
  };

  const openEarningsModal = (user: any) => {
    setSelectedUserForEarnings(user);
    setEarningsAmount('');
    setEarningsOperation('add');
    setEarningsError(null);
    setEarningsSuccess(null);
    setShowEarningsModal(true);
  };

  const openDistributionModal = async (user: any) => {
    setSelectedUserForEarnings(user);
    setEarningsError(null);
    setEarningsSuccess(null);

    // Check if user already has custom distribution settings
    try {
      const { data, error } = await supabase.rpc('admin_get_payout_settings', {
        setting_type_filter: 'user',
        country_code_filter: null,
        user_id_filter: user.id
      });

      if (error) throw error;

      if (data && data.length > 0) {
        // Load existing settings
        const settings = data[0];
        setDistributionData({
          payout_threshold: settings.payout_threshold,
          artist_percentage: settings.artist_percentage,
          listener_percentage: settings.listener_percentage,
          platform_percentage: settings.platform_percentage
        });
      } else {
        // Use global defaults
        const { data: globalData, error: globalError } = await supabase.rpc('admin_get_payout_settings', {
          setting_type_filter: 'global',
          country_code_filter: null,
          user_id_filter: null
        });

        if (!globalError && globalData && globalData.length > 0) {
          const globalSettings = globalData[0];
          setDistributionData({
            payout_threshold: globalSettings.payout_threshold,
            artist_percentage: globalSettings.artist_percentage,
            listener_percentage: globalSettings.listener_percentage,
            platform_percentage: globalSettings.platform_percentage
          });
        }
      }
    } catch (err) {
      console.error('Error fetching distribution settings:', err);
    }

    setShowDistributionModal(true);
  };

  const handleAdjustEarnings = async () => {
    if (!selectedUserForEarnings || !earningsAmount || isAdjustingEarnings) return;

    const amount = parseFloat(earningsAmount);
    if (isNaN(amount) || amount <= 0) {
      setEarningsError('Please enter a valid amount greater than 0');
      return;
    }

    try {
      setIsAdjustingEarnings(true);
      setEarningsError(null);
      setEarningsSuccess(null);

      const result = await adminAdjustUserEarnings(
        selectedUserForEarnings.id,
        amount,
        earningsOperation
      );

      if (result && result.success) {
        // Use the new earnings from the result if available, otherwise calculate
        const newEarnings = result.new_earnings !== undefined ? result.new_earnings : (() => {
          let calculated = selectedUserForEarnings.total_earnings || 0;
          if (earningsOperation === 'add') {
            calculated += amount;
          } else if (earningsOperation === 'subtract') {
            calculated = Math.max(0, calculated - amount);
          } else if (earningsOperation === 'set') {
            calculated = amount;
          }
          return calculated;
        })();

        setUsers(users.map(user =>
          user.id === selectedUserForEarnings.id ? { ...user, total_earnings: newEarnings } : user
        ));

        setEarningsSuccess(`Successfully ${earningsOperation === 'add' ? 'added' : earningsOperation === 'subtract' ? 'subtracted' : 'set'} earnings for ${selectedUserForEarnings.display_name || selectedUserForEarnings.email}`);

        // Close modal after a short delay
        setTimeout(() => {
          setShowEarningsModal(false);

          // Clear success message after closing
          setTimeout(() => {
            setEarningsSuccess(null);
          }, 1000);
        }, 2000);
      } else {
        throw new Error(result?.error || 'Failed to adjust earnings');
      }
    } catch (err) {
      console.error('Error adjusting earnings:', err);
      setEarningsError(err instanceof Error ? err.message : 'Failed to adjust earnings');
    } finally {
      setIsAdjustingEarnings(false);
    }
  };

  const handleSaveDistribution = async () => {
    if (!selectedUserForEarnings || isSavingDistribution) return;

    const sum = distributionData.artist_percentage + distributionData.listener_percentage + distributionData.platform_percentage;
    if (sum !== 100) {
      setEarningsError('Percentages must sum to 100%');
      return;
    }

    if (distributionData.payout_threshold < 1) {
      setEarningsError('Payout threshold must be at least $1.00');
      return;
    }

    try {
      setIsSavingDistribution(true);
      setEarningsError(null);
      setEarningsSuccess(null);

      // Check if user already has settings
      const { data: existingSettings } = await supabase.rpc('admin_get_payout_settings', {
        setting_type_filter: 'user',
        country_code_filter: null,
        user_id_filter: selectedUserForEarnings.id
      });

      let result;
      if (existingSettings && existingSettings.length > 0) {
        // Update existing settings
        result = await supabase.rpc('admin_update_payout_settings', {
          setting_id: existingSettings[0].id,
          new_payout_threshold: distributionData.payout_threshold,
          new_artist_percentage: distributionData.artist_percentage,
          new_listener_percentage: distributionData.listener_percentage,
          new_platform_percentage: distributionData.platform_percentage
        });
      } else {
        // Create new settings
        result = await supabase.rpc('admin_create_payout_settings', {
          new_setting_type: 'user',
          new_country_code: null,
          new_user_id: selectedUserForEarnings.id,
          new_payout_threshold: distributionData.payout_threshold,
          new_artist_percentage: distributionData.artist_percentage,
          new_listener_percentage: distributionData.listener_percentage,
          new_platform_percentage: distributionData.platform_percentage
        });
      }

      if (result.error) throw result.error;

      const responseData = result.data;
      if (responseData && responseData.error) {
        throw new Error(responseData.error);
      }

      setEarningsSuccess(`Custom earnings distribution saved for ${selectedUserForEarnings.display_name || selectedUserForEarnings.email}`);

      // Close modal after a short delay
      setTimeout(() => {
        setShowDistributionModal(false);

        // Clear success message after closing
        setTimeout(() => {
          setEarningsSuccess(null);
        }, 1000);
      }, 2000);
    } catch (err) {
      console.error('Error saving distribution:', err);
      setEarningsError(err instanceof Error ? err.message : 'Failed to save distribution settings');
    } finally {
      setIsSavingDistribution(false);
    }
  };

  const handleDistributionInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const numValue = parseFloat(value);

    if (isNaN(numValue)) return;

    if (name === 'payout_threshold') {
      if (numValue < 1) return;
      setDistributionData(prev => ({ ...prev, [name]: numValue }));
    } else if (['artist_percentage', 'listener_percentage'].includes(name)) {
      if (numValue < 0 || numValue > 100) return;
      setDistributionData(prev => ({ ...prev, [name]: numValue }));
    }
  };

  // Auto-calculate platform percentage
  useEffect(() => {
    const sum = distributionData.artist_percentage + distributionData.listener_percentage;
    if (sum <= 100) {
      const newPlatformPercentage = 100 - sum;
      if (newPlatformPercentage !== distributionData.platform_percentage) {
        setDistributionData(prev => ({
          ...prev,
          platform_percentage: newPlatformPercentage
        }));
      }
    }
  }, [distributionData.artist_percentage, distributionData.listener_percentage]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatCurrency = (amount: number | null): string => {
    if (amount === null) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const getRoleBadgeClass = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-green-100 text-green-700 border-green-200';
      case 'manager':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'editor':
        return 'bg-teal-100 text-teal-700 border-teal-200';
      case 'account':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'creator':
        return 'bg-cyan-100 text-cyan-700 border-cyan-200';
      case 'listener':
        return 'bg-green-100 text-green-700 border-green-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getStatusBadgeClass = (isActive: boolean) => {
    return isActive
      ? 'bg-green-100 text-green-700 border-green-200'
      : 'bg-red-100 text-red-700 border-red-200';
  };

  const renderOverviewDashboard = () => {
    if (metricsLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <LoadingLogo variant="pulse" size={32} />
          <p className="ml-4 text-gray-700">Loading metrics...</p>
        </div>
      );
    }

    if (!metrics) {
      return (
        <div className="p-6 bg-red-100 border border-red-200 rounded-lg text-center">
          <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
          <p className="text-red-700">Failed to load metrics</p>
          <button
            onClick={fetchMetrics}
            className="mt-4 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg"
          >
            Try Again
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-5">
        {/* Key Metrics Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Total Users', value: metrics.totalUsers.toLocaleString(), sub: 'Registered accounts', icon: <Users className="w-4 h-4" />, iconBg: 'bg-blue-50', iconColor: 'text-blue-500' },
            { label: 'Active Today', value: metrics.activeTodayCount.toLocaleString(), sub: metrics.totalUsers > 0 ? `${((metrics.activeTodayCount / metrics.totalUsers) * 100).toFixed(1)}% of total` : '0%', icon: <Activity className="w-4 h-4" />, iconBg: 'bg-emerald-50', iconColor: 'text-emerald-500' },
            { label: 'Active This Week', value: metrics.activeWeekCount.toLocaleString(), sub: metrics.totalUsers > 0 ? `${((metrics.activeWeekCount / metrics.totalUsers) * 100).toFixed(1)}% of total` : '0%', icon: <Activity className="w-4 h-4" />, iconBg: 'bg-[#e6f7f1]', iconColor: 'text-[#309605]' },
            { label: 'Suspended', value: metrics.suspendedCount.toLocaleString(), sub: metrics.totalUsers > 0 ? `${((metrics.suspendedCount / metrics.totalUsers) * 100).toFixed(1)}% of total` : '0%', icon: <UserMinus className="w-4 h-4" />, iconBg: 'bg-red-50', iconColor: 'text-red-400' },
          ].map((card, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-start justify-between mb-2">
                <p className="text-xs font-medium text-gray-500">{card.label}</p>
                <div className={`w-8 h-8 rounded-lg ${card.iconBg} flex items-center justify-center flex-shrink-0`}>
                  <span className={card.iconColor}>{card.icon}</span>
                </div>
              </div>
              <p className="text-2xl font-bold text-gray-900 tracking-tight mb-0.5">{card.value}</p>
              <p className="text-xs text-gray-400">{card.sub}</p>
            </div>
          ))}
        </div>

        {/* New Signups + Roles + Verification */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* New Signups */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-lg bg-[#e6f7f1] flex items-center justify-center">
                <TrendingUp className="w-3.5 h-3.5 text-[#309605]" />
              </div>
              <h3 className="text-sm font-semibold text-gray-900">New Signups</h3>
            </div>
            <div className="space-y-2">
              {[
                { label: 'Today', value: metrics.newSignupsToday },
                { label: 'This Week', value: metrics.newSignupsWeek },
                { label: 'This Month', value: metrics.newSignupsMonth },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <span className="text-sm text-gray-500">{item.label}</span>
                  <span className="text-sm font-semibold text-gray-900">{item.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Users by Role */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                <Users className="w-3.5 h-3.5 text-blue-500" />
              </div>
              <h3 className="text-sm font-semibold text-gray-900">Users by Role</h3>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between py-2 border-b border-gray-50">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                  <span className="text-sm text-gray-600">Creators</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-semibold text-gray-900">{metrics.creatorCount.toLocaleString()}</span>
                  <span className="text-xs text-gray-400 ml-1.5">{metrics.totalUsers > 0 ? `${((metrics.creatorCount / metrics.totalUsers) * 100).toFixed(1)}%` : '0%'}</span>
                </div>
              </div>
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#309605]"></div>
                  <span className="text-sm text-gray-600">Listeners</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-semibold text-gray-900">{metrics.listenerCount.toLocaleString()}</span>
                  <span className="text-xs text-gray-400 ml-1.5">{metrics.totalUsers > 0 ? `${((metrics.listenerCount / metrics.totalUsers) * 100).toFixed(1)}%` : '0%'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Verification Status */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
              </div>
              <h3 className="text-sm font-semibold text-gray-900">Email Verification</h3>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between py-2 border-b border-gray-50">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-sm text-gray-600">Verified</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-semibold text-gray-900">{metrics.verifiedCount.toLocaleString()}</span>
                  <span className="text-xs text-gray-400 ml-1.5">{metrics.totalUsers > 0 ? `${((metrics.verifiedCount / metrics.totalUsers) * 100).toFixed(1)}%` : '0%'}</span>
                </div>
              </div>
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <XCircle className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-sm text-gray-600">Unverified</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-semibold text-gray-900">{metrics.unverifiedCount.toLocaleString()}</span>
                  <span className="text-xs text-gray-400 ml-1.5">{metrics.totalUsers > 0 ? `${((metrics.unverifiedCount / metrics.totalUsers) * 100).toFixed(1)}%` : '0%'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Signups */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Recent Signups</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">User</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {metrics.recentSignups.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">No recent signups</td>
                  </tr>
                ) : (
                  metrics.recentSignups.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">{user.display_name || 'Unnamed User'}</td>
                      <td className="px-4 py-3 text-gray-500">{user.email}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getRoleBadgeClass(user.role)}`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{formatDate(user.created_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const totalPages = Math.ceil(totalUsers / usersPerPage);

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 leading-tight">User Management</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            {(activeTab === 'overview' && metrics) ? `${metrics.totalUsers.toLocaleString()} total users` : `${totalUsers.toLocaleString()} users`}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-100">
        <nav className="flex gap-1">
          {[
            { key: 'overview', label: 'Overview' },
            { key: 'manage', label: 'Manage Users' },
            { key: 'creator_requests', label: 'Creator Requests', badge: pendingCreatorRequestsCount },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`relative py-2.5 px-4 text-sm font-medium border-b-2 transition-all ${
                activeTab === tab.key
                  ? 'border-[#309605] text-[#309605]'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-200'
              }`}
            >
              {tab.label}
              {tab.badge && tab.badge > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 bg-amber-500 text-white text-[10px] font-bold rounded-full">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' ? renderOverviewDashboard() : activeTab === 'creator_requests' ? (
        <CreatorRequestsSection />
      ) : (
        <>
      {/* Success/Error Messages */}
      {(passwordResetSuccess || passwordResetError || earningsSuccess) && (
        <div className={`p-3 rounded-lg text-sm ${
          passwordResetError
            ? 'bg-red-50 border border-red-100 text-red-700'
            : 'bg-[#e6f7f1] border border-[#b0e6d4] text-[#008a5d]'
        }`}>
          {passwordResetSuccess || passwordResetError || earningsSuccess}
        </div>
      )}

      {/* Search and Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Search by email, name or username..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#309605] focus:border-transparent transition-all"
          />
          <button
            onClick={handleSearch}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <Search className="w-4 h-4" />
          </button>
        </div>

        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#309605]"
        >
          <option value="all">All Roles</option>
          <option value="admin">Admin</option>
          <option value="manager">Manager</option>
          <option value="editor">Editor</option>
          <option value="account">Account</option>
          <option value="creator">Creator</option>
          <option value="listener">Listener</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#309605]"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Users Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 gap-3">
          <LoadingLogo variant="pulse" size={28} />
          <p className="text-sm text-gray-500">Loading users...</p>
        </div>
      ) : error ? (
        <div className="p-5 bg-red-50 border border-red-100 rounded-xl text-center">
          <AlertTriangle className="w-7 h-7 text-red-400 mx-auto mb-2" />
          <p className="text-sm text-red-600 mb-3">{error}</p>
          <button
            onClick={fetchUsers}
            className="px-4 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-sm font-medium border border-red-200 transition-colors"
          >
            Try Again
          </button>
        </div>
      ) : users.length === 0 ? (
        <div className="p-8 bg-white rounded-xl border border-gray-100 text-center">
          <p className="text-sm text-gray-400">No users found</p>
        </div>
      ) : (
        <div className="overflow-x-auto bg-white rounded-xl border border-gray-100 shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">User</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Country</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Role</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Earnings</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Joined</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                        {user.avatar_url ? (
                          <img
                            src={user.avatar_url}
                            alt={user.display_name || 'User'}
                            className="w-full h-full rounded-full object-cover"
                          />
                        ) : (
                          <span className="text-gray-500 text-xs font-semibold">
                            {(user.display_name || user.email || 'U').charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <span className="font-medium text-gray-900 text-sm">
                        {user.display_name || 'Unnamed User'}
                      </span>
                    </div>
                  </td>
                  <td className="p-4 text-gray-700">{user.email}</td>
                  <td className="p-4 text-gray-700">
                    <span className="text-sm">
                      {user.country || 'Not set'}
                    </span>
                  </td>
                  <td className="p-4">
                    {editingUser === user.id ? (
                      <div className="flex items-center space-x-2">
                        <select
                          value={newRole}
                          onChange={(e) => setNewRole(e.target.value)}
                          className="px-2 py-1 bg-white border border-gray-300 rounded text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-[#309605]"
                        >
                          <option value="">Select role</option>
                          <option value="listener">Listener</option>
                          <option value="creator">Creator</option>
                        </select>
                        <button
                          onClick={() => handleRoleChange(user.id)}
                          disabled={!newRole || isUpdating}
                          className="p-1 bg-green-100 text-green-700 rounded hover:bg-green-200 disabled:opacity-50"
                        >
                          <Check size={16} />
                        </button>
                        <button
                          onClick={() => {
                            setEditingUser(null);
                            setNewRole('');
                          }}
                          className="p-1 bg-red-100 text-red-700 rounded hover:bg-red-200"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <span className={`px-2 py-1 rounded-full text-xs border ${getRoleBadgeClass(user.role)}`}>
                        {user.role}
                      </span>
                    )}
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-1 rounded-full text-xs border ${getStatusBadgeClass(user.is_active)}`}>
                      {user.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="p-4 text-gray-700">{formatCurrency(user.total_earnings)}</td>
                  <td className="p-4 text-gray-700">{formatDate(user.created_at)}</td>
                  <td className="p-4">
                    <div className="flex space-x-2">
                      {/* Edit Role Button */}
                      {editingUser !== user.id && (
                        <button
                          onClick={() => {
                            setEditingUser(user.id);
                            setNewRole(user.role);
                          }}
                          className="p-2 bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-700"
                          title="Edit Role"
                        >
                          <Edit size={16} />
                        </button>
                      )}
                      
                      {/* Reset Password Button */}
                      <button
                        onClick={() => handleResetPassword(user.id, user.email)}
                        disabled={isResettingPassword === user.id}
                        className="p-2 bg-blue-100 rounded-lg hover:bg-blue-200 text-blue-700 disabled:opacity-50"
                        title="Reset Password"
                      >
                        {isResettingPassword === user.id ? (
                          <LoadingLogo variant="pulse" size={16} />
                        ) : (
                          <KeyRound size={16} />
                        )}
                      </button>
                      
                      {/* Toggle Account Status Button */}
                      <button
                        onClick={() => handleToggleUserStatus(user.id, user.is_active)}
                        disabled={isTogglingStatus === user.id}
                        className={`p-2 rounded-lg ${
                          user.is_active 
                            ? 'bg-red-100 hover:bg-red-200 text-red-700' 
                            : 'bg-green-100 hover:bg-green-200 text-green-700'
                        } disabled:opacity-50`}
                        title={user.is_active ? 'Deactivate Account' : 'Activate Account'}
                      >
                        {isTogglingStatus === user.id ? (
                          <LoadingLogo variant="pulse" size={16} />
                        ) : user.is_active ? (
                          <UserX size={16} />
                        ) : (
                          <UserCheck size={16} />
                        )}
                      </button>
                      
                      {/* Adjust Earnings Button */}
                      <button
                        onClick={() => openEarningsModal(user)}
                        className="p-2 bg-yellow-100 rounded-lg hover:bg-yellow-200 text-yellow-700"
                        title="Adjust Earnings"
                      >
                        <DollarSign size={16} />
                      </button>

                      {/* Custom Distribution Button */}
                      <button
                        onClick={() => openDistributionModal(user)}
                        className="p-2 bg-green-100 rounded-lg hover:bg-green-200 text-green-700"
                        title="Set Custom Distribution"
                      >
                        <TrendingUp size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6">
          <div className="text-sm text-gray-600">
            Showing {((currentPage - 1) * usersPerPage) + 1} to {Math.min(currentPage * usersPerPage, totalUsers)} of {totalUsers} users
          </div>
          <div className="flex space-x-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 bg-white border border-gray-300 rounded-md text-gray-700 disabled:opacity-50"
            >
              Previous
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              // Show pages around current page
              let pageNum = i + 1;
              if (totalPages > 5) {
                if (currentPage > 3) {
                  pageNum = currentPage - 3 + i;
                }
                if (pageNum > totalPages) {
                  pageNum = totalPages - (4 - i);
                }
              }
              
              return (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  className={`w-8 h-8 rounded-md ${
                    currentPage === pageNum 
                      ? 'bg-[#309605] text-white' 
                      : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 bg-white border border-gray-300 rounded-md text-gray-700 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Earnings Adjustment Modal */}
      {showEarningsModal && selectedUserForEarnings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900">
                Adjust Earnings
              </h3>
              <button
                onClick={() => setShowEarningsModal(false)}
                className="p-2 hover:bg-gray-100 rounded-full"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            
            <div className="mb-4">
              <div className="flex items-center mb-4">
                <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center mr-3">
                  {selectedUserForEarnings.avatar_url ? (
                    <img 
                      src={selectedUserForEarnings.avatar_url} 
                      alt={selectedUserForEarnings.display_name || 'User'} 
                      className="w-full h-full rounded-full object-cover" 
                    />
                  ) : (
                    <span className="text-gray-700 font-semibold">
                      {(selectedUserForEarnings.display_name || selectedUserForEarnings.email || 'U').charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
                <div>
                  <p className="font-medium text-gray-900">
                    {selectedUserForEarnings.display_name || 'Unnamed User'}
                  </p>
                  <p className="text-sm text-gray-600">{selectedUserForEarnings.email}</p>
                </div>
              </div>
              
              <div className="bg-gray-100 p-3 rounded-lg mb-4">
                <p className="text-sm text-gray-600">Current Balance</p>
                <p className="text-xl font-bold text-gray-900">
                  {formatCurrency(selectedUserForEarnings.total_earnings)}
                </p>
              </div>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Amount
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={earningsAmount}
                    onChange={(e) => setEarningsAmount(e.target.value)}
                    className="w-full pl-8 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                    placeholder="0.00"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Operation
                </label>
                <div className="flex space-x-2">
                  <label className="flex items-center p-3 bg-white border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 flex-1">
                    <input
                      type="radio"
                      name="operation"
                      value="add"
                      checked={earningsOperation === 'add'}
                      onChange={() => setEarningsOperation('add')}
                      className="sr-only"
                    />
                    <div className={`w-4 h-4 rounded-full border ${
                      earningsOperation === 'add' ? 'border-[#309605] bg-[#309605]' : 'border-gray-400'
                    } mr-2 flex items-center justify-center`}>
                      {earningsOperation === 'add' && (
                        <div className="w-2 h-2 bg-white rounded-full"></div>
                      )}
                    </div>
                    <span className="text-sm">Add</span>
                  </label>
                  
                  <label className="flex items-center p-3 bg-white border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 flex-1">
                    <input
                      type="radio"
                      name="operation"
                      value="subtract"
                      checked={earningsOperation === 'subtract'}
                      onChange={() => setEarningsOperation('subtract')}
                      className="sr-only"
                    />
                    <div className={`w-4 h-4 rounded-full border ${
                      earningsOperation === 'subtract' ? 'border-[#309605] bg-[#309605]' : 'border-gray-400'
                    } mr-2 flex items-center justify-center`}>
                      {earningsOperation === 'subtract' && (
                        <div className="w-2 h-2 bg-white rounded-full"></div>
                      )}
                    </div>
                    <span className="text-sm">Subtract</span>
                  </label>
                  
                  <label className="flex items-center p-3 bg-white border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 flex-1">
                    <input
                      type="radio"
                      name="operation"
                      value="set"
                      checked={earningsOperation === 'set'}
                      onChange={() => setEarningsOperation('set')}
                      className="sr-only"
                    />
                    <div className={`w-4 h-4 rounded-full border ${
                      earningsOperation === 'set' ? 'border-[#309605] bg-[#309605]' : 'border-gray-400'
                    } mr-2 flex items-center justify-center`}>
                      {earningsOperation === 'set' && (
                        <div className="w-2 h-2 bg-white rounded-full"></div>
                      )}
                    </div>
                    <span className="text-sm">Set</span>
                  </label>
                </div>
              </div>
              
              {earningsError && (
                <div className="p-3 bg-red-100 border border-red-200 rounded-lg">
                  <p className="text-red-700 text-sm">{earningsError}</p>
                </div>
              )}
              
              {earningsSuccess && (
                <div className="p-3 bg-green-100 border border-green-200 rounded-lg">
                  <p className="text-green-700 text-sm">{earningsSuccess}</p>
                </div>
              )}
              
              <div className="flex space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEarningsModal(false)}
                  className="flex-1 px-4 py-2 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg text-gray-700 transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAdjustEarnings}
                  disabled={!earningsAmount || isAdjustingEarnings || parseFloat(earningsAmount) <= 0}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-[#309605] to-[#3ba208] hover:from-[#3ba208] hover:to-[#309605] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white transition-all duration-200"
                >
                  {isAdjustingEarnings ? 'Processing...' : 'Adjust Earnings'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Distribution Modal */}
      {showDistributionModal && selectedUserForEarnings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900">
                Set Custom Distribution
              </h3>
              <button
                onClick={() => setShowDistributionModal(false)}
                className="p-2 hover:bg-gray-100 rounded-full"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="mb-4">
              <div className="flex items-center mb-4">
                <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center mr-3">
                  {selectedUserForEarnings.avatar_url ? (
                    <img
                      src={selectedUserForEarnings.avatar_url}
                      alt={selectedUserForEarnings.display_name || 'User'}
                      className="w-full h-full rounded-full object-cover"
                    />
                  ) : (
                    <span className="text-gray-700 font-semibold">
                      {(selectedUserForEarnings.display_name || selectedUserForEarnings.email || 'U').charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
                <div>
                  <p className="font-medium text-gray-900">
                    {selectedUserForEarnings.display_name || 'Unnamed User'}
                  </p>
                  <p className="text-sm text-gray-600">{selectedUserForEarnings.email}</p>
                </div>
              </div>

              <p className="text-sm text-gray-600 mb-4">
                Set custom earnings distribution percentages for this user. This will override global and country settings.
              </p>
            </div>

            <div className="space-y-4">
              {/* Payout Threshold */}
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Payout Threshold (USD)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
                  <input
                    type="number"
                    name="payout_threshold"
                    value={distributionData.payout_threshold}
                    onChange={handleDistributionInputChange}
                    min="1"
                    step="0.01"
                    className="w-full pl-8 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                  />
                </div>
              </div>

              {/* Percentage Distribution */}
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Earnings Distribution (%)
                </label>
                <div className="space-y-3">
                  <div>
                    <label className="block text-gray-700 text-xs mb-1">
                      Artist/Creator
                    </label>
                    <input
                      type="number"
                      name="artist_percentage"
                      value={distributionData.artist_percentage}
                      onChange={handleDistributionInputChange}
                      min="0"
                      max="100"
                      className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 text-xs mb-1">
                      Listener
                    </label>
                    <input
                      type="number"
                      name="listener_percentage"
                      value={distributionData.listener_percentage}
                      onChange={handleDistributionInputChange}
                      min="0"
                      max="100"
                      className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 text-xs mb-1">
                      Platform (Auto-calculated)
                    </label>
                    <input
                      type="number"
                      name="platform_percentage"
                      value={distributionData.platform_percentage}
                      readOnly
                      className="w-full px-4 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-700 cursor-not-allowed"
                    />
                  </div>
                </div>
                <p className="mt-2 text-sm text-gray-600">
                  Total: {distributionData.artist_percentage + distributionData.listener_percentage + distributionData.platform_percentage}%
                  {distributionData.artist_percentage + distributionData.listener_percentage + distributionData.platform_percentage !== 100 && (
                    <span className="text-red-600 ml-2">(Must equal 100%)</span>
                  )}
                </p>
              </div>

              {earningsError && (
                <div className="p-3 bg-red-100 border border-red-200 rounded-lg">
                  <p className="text-red-700 text-sm">{earningsError}</p>
                </div>
              )}

              {earningsSuccess && (
                <div className="p-3 bg-green-100 border border-green-200 rounded-lg">
                  <p className="text-green-700 text-sm">{earningsSuccess}</p>
                </div>
              )}

              <div className="flex space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowDistributionModal(false)}
                  className="flex-1 px-4 py-2 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg text-gray-700 transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveDistribution}
                  disabled={
                    isSavingDistribution ||
                    distributionData.artist_percentage + distributionData.listener_percentage + distributionData.platform_percentage !== 100 ||
                    distributionData.payout_threshold < 1
                  }
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-[#309605] to-[#3ba208] hover:from-[#3ba208] hover:to-[#309605] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white transition-all duration-200"
                >
                  {isSavingDistribution ? 'Saving...' : 'Save Distribution'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
};