import { useState, useEffect } from 'react';
import {
  Search,
  Coins,
  Plus,
  Minus,
  Ban,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Wallet,
  X
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { LoadingLogo } from '../../components/LoadingLogo';

interface TreatUser {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  avatar_url: string | null;
  treat_wallet: {
    balance: number;
    total_purchased: number;
    total_spent: number;
    total_earned: number;
    total_withdrawn: number;
    created_at: string;
    updated_at: string;
  } | null;
}

interface TreatAction {
  type: 'add' | 'remove' | 'disable' | 'enable';
  amount?: number;
  reason: string;
}

export const TreatUsersSection = (): JSX.Element => {
  const [users, setUsers] = useState<TreatUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'balance_high' | 'balance_low' | 'name' | 'recent'>('balance_high');
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalUsers, setTotalUsers] = useState(0);
  const usersPerPage = 20;
  
  // Action modal state
  const [showActionModal, setShowActionModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<TreatUser | null>(null);
  const [actionData, setActionData] = useState<TreatAction>({
    type: 'add',
    amount: 0,
    reason: ''
  });
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    fetchTreatUsers();
  }, [currentPage, roleFilter, statusFilter, sortBy, searchQuery]);

  const fetchTreatUsers = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Call the admin function to get treat users with pagination and filters
      const { data, error } = await supabase.rpc('admin_get_treat_users', {
        search_query: searchQuery.trim() || null,
        role_filter: roleFilter === 'all' ? null : roleFilter,
        status_filter: statusFilter === 'all' ? null : (statusFilter === 'active'),
        sort_by: sortBy,
        limit_param: usersPerPage,
        offset_param: (currentPage - 1) * usersPerPage
      });

      if (error) throw error;

      // Get total count for pagination
      const { count, error: countError } = await supabase.rpc('admin_count_treat_users', {
        search_query: searchQuery.trim() || null,
        role_filter: roleFilter === 'all' ? null : roleFilter,
        status_filter: statusFilter === 'all' ? null : (statusFilter === 'active')
      });

      if (countError) throw countError;

      setUsers(data || []);
      setTotalUsers(count || 0);
    } catch (err) {
      console.error('Error fetching treat users:', err);
      setError(err instanceof Error ? err.message : 'Failed to load treat users');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = () => {
    setCurrentPage(1); // Reset to first page when searching
    fetchTreatUsers();
  };

  const handleOpenActionModal = (user: TreatUser, actionType: 'add' | 'remove' | 'disable' | 'enable') => {
    setSelectedUser(user);
    setActionData({
      type: actionType,
      amount: actionType === 'add' || actionType === 'remove' ? 0 : undefined,
      reason: ''
    });
    setActionError(null);
    setShowActionModal(true);
  };

  const handleCloseActionModal = () => {
    setShowActionModal(false);
    setSelectedUser(null);
    setActionData({ type: 'add', amount: 0, reason: '' });
    setActionError(null);
  };

  const handleActionSubmit = async () => {
    if (!selectedUser) return;

    // Validation
    if (!actionData.reason.trim()) {
      setActionError('Reason is required for all actions');
      return;
    }

    if ((actionData.type === 'add' || actionData.type === 'remove') && (!actionData.amount || actionData.amount <= 0)) {
      setActionError('Amount must be greater than 0');
      return;
    }

    if (actionData.type === 'remove' && selectedUser.treat_wallet && actionData.amount! > selectedUser.treat_wallet.balance) {
      setActionError('Cannot remove more treats than the user currently has');
      return;
    }

    setIsSubmittingAction(true);
    setActionError(null);

    try {
      let result;
      
      switch (actionData.type) {
        case 'add':
          result = await supabase.rpc('admin_add_treats_to_user', {
            target_user_id: selectedUser.id,
            treat_amount: actionData.amount!,
            admin_reason: actionData.reason.trim()
          });
          break;
          
        case 'remove':
          result = await supabase.rpc('admin_remove_treats_from_user', {
            target_user_id: selectedUser.id,
            treat_amount: actionData.amount!,
            admin_reason: actionData.reason.trim()
          });
          break;
          
        case 'disable':
          result = await supabase.rpc('admin_disable_user_treat_wallet', {
            target_user_id: selectedUser.id,
            admin_reason: actionData.reason.trim()
          });
          break;
          
        case 'enable':
          result = await supabase.rpc('admin_enable_user_treat_wallet', {
            target_user_id: selectedUser.id,
            admin_reason: actionData.reason.trim()
          });
          break;
      }

      // Extract detailed error message from Supabase response
      if (result.error) {
        const errorMessage = result.error.message || result.error.details || result.error.hint || 'Unknown error occurred';
        console.error('Supabase RPC error:', result.error);
        throw new Error(errorMessage);
      }

      // Check if function returned an error in the data
      if (result.data && Array.isArray(result.data) && result.data.length > 0) {
        const response = result.data[0];
        if (response && !response.success && response.error) {
          throw new Error(response.error);
        }
      } else if (result.data && !result.data.success && result.data.error) {
        throw new Error(result.data.error);
      }

      // Show success message
      const actionMessages = {
        add: `Successfully added ${actionData.amount} treats to ${selectedUser.display_name || selectedUser.email}`,
        remove: `Successfully removed ${actionData.amount} treats from ${selectedUser.display_name || selectedUser.email}`,
        disable: `Successfully disabled treat wallet for ${selectedUser.display_name || selectedUser.email}`,
        enable: `Successfully enabled treat wallet for ${selectedUser.display_name || selectedUser.email}`
      };

      setSuccess(actionMessages[actionData.type]);

      // Close modal and refresh data
      handleCloseActionModal();
      await fetchTreatUsers();

      // Clear success message after 5 seconds
      setTimeout(() => {
        setSuccess(null);
      }, 5000);
    } catch (err) {
      console.error(`Error ${actionData.type}ing treats:`, err);
      setActionError(err instanceof Error ? err.message : `Failed to ${actionData.type} treats`);
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const formatCurrency = (amount: number): string => {
    return amount.toLocaleString();
  };


  const getRoleBadgeClass = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-green-100 text-green-700 border-green-200';
      case 'creator':
        return 'bg-blue-100 text-blue-700 border-blue-200';
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

  const getSortIcon = () => {
    switch (sortBy) {
      case 'balance_high':
        return <ArrowDown className="w-4 h-4" />;
      case 'balance_low':
        return <ArrowUp className="w-4 h-4" />;
      default:
        return <ArrowUpDown className="w-4 h-4" />;
    }
  };

  const totalPages = Math.ceil(totalUsers / usersPerPage);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Treat Users Management</h2>
        <div className="flex items-center gap-4">
          <div className="text-sm text-gray-600">
            Total Users: {totalUsers}
          </div>
          <button
            onClick={fetchTreatUsers}
            className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700"
            title="Refresh"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Success/Error Messages */}
      {(success || error) && (
        <div className={`p-4 rounded-lg ${
          error ? 'bg-red-100 border border-red-200' : 'bg-green-100 border border-green-200'
        }`}>
          <p className={`${
            error ? 'text-red-700' : 'text-green-700'
          }`}>
            {error || success}
          </p>
        </div>
      )}

      {/* Search and Filters */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
          {/* Search */}
          <div className="relative col-span-2">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500" size={18} />
            <input
              type="text"
              placeholder="Search by email or name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="w-full pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
            />
          </div>

          {/* Role Filter */}
          <div>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
            >
              <option value="all">All Roles</option>
              <option value="creator">Creator</option>
              <option value="listener">Listener</option>
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          {/* Sort */}
          <div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
            >
              <option value="balance_high">Balance: High to Low</option>
              <option value="balance_low">Balance: Low to High</option>
              <option value="name">Name: A to Z</option>
              <option value="recent">Recently Joined</option>
            </select>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={handleSearch}
            className="px-4 py-2 bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg flex items-center gap-2"
          >
            <Search className="w-4 h-4" />
            Apply Filters
          </button>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <LoadingLogo variant="pulse" size={32} />
            <p className="ml-4 text-gray-700">Loading treat users...</p>
          </div>
        ) : error && users.length === 0 ? (
          <div className="p-6 bg-red-100 border border-red-200 rounded-lg text-center m-6">
            <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
            <p className="text-red-700">{error}</p>
            <button
              onClick={fetchTreatUsers}
              className="mt-4 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg"
            >
              Try Again
            </button>
          </div>
        ) : users.length === 0 ? (
          <div className="p-6 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Coins className="w-8 h-8 text-gray-500" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Users Found</h3>
            <p className="text-gray-700">
              {searchQuery || roleFilter !== 'all' || statusFilter !== 'all'
                ? 'No users match your current filters'
                : 'No users with treat wallets found'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-hide">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="p-4 text-gray-700 font-medium">User</th>
                  <th className="p-4 text-gray-700 font-medium">Role</th>
                  <th className="p-4 text-gray-700 font-medium">Status</th>
                  <th className="p-4 text-gray-700 font-medium">
                    <div className="flex items-center gap-2">
                      <Coins className="w-4 h-4" />
                      Treat Balance
                      {getSortIcon()}
                    </div>
                  </th>
                  <th className="p-4 text-gray-700 font-medium">Total Earned</th>
                  <th className="p-4 text-gray-700 font-medium">Total Spent</th>
                  <th className="p-4 text-gray-700 font-medium">Wallet Status</th>
                  <th className="p-4 text-gray-700 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden">
                          {user.avatar_url ? (
                            <img 
                              src={user.avatar_url} 
                              alt={user.display_name || 'User'} 
                              className="w-full h-full object-cover" 
                            />
                          ) : (
                            <span className="text-gray-700 font-semibold">
                              {(user.display_name || user.email || 'U').charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">
                            {user.display_name || 'Unnamed User'}
                          </p>
                          <p className="text-gray-600 text-sm">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded-full text-xs border font-medium ${getRoleBadgeClass(user.role)}`}>
                        {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded-full text-xs border font-medium ${getStatusBadgeClass(user.is_active)}`}>
                        {user.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <Coins className="w-4 h-4 text-yellow-600" />
                        <span className="font-bold text-gray-900 text-lg">
                          {user.treat_wallet ? formatCurrency(user.treat_wallet.balance) : '0'}
                        </span>
                        <span className="text-gray-600 text-sm">treats</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="text-green-600 font-medium">
                        {user.treat_wallet ? formatCurrency(user.treat_wallet.total_earned) : '0'}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className="text-red-600 font-medium">
                        {user.treat_wallet ? formatCurrency(user.treat_wallet.total_spent) : '0'}
                      </span>
                    </td>
                    <td className="p-4">
                      {user.treat_wallet ? (
                        <div className="flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-green-600" />
                          <span className="text-green-700 text-sm font-medium">Active</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Ban className="w-4 h-4 text-red-600" />
                          <span className="text-red-700 text-sm font-medium">No Wallet</span>
                        </div>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {/* Add Treats */}
                        <button
                          onClick={() => handleOpenActionModal(user, 'add')}
                          className="p-2 bg-green-100 hover:bg-green-200 rounded-lg text-green-700 transition-colors duration-200"
                          title="Add Treats"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                        
                        {/* Remove Treats */}
                        <button
                          onClick={() => handleOpenActionModal(user, 'remove')}
                          disabled={!user.treat_wallet || user.treat_wallet.balance === 0}
                          className="p-2 bg-red-100 hover:bg-red-200 rounded-lg text-red-700 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Remove Treats"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        
                        {/* Disable/Enable Wallet */}
                        {user.treat_wallet ? (
                          <button
                            onClick={() => handleOpenActionModal(user, 'disable')}
                            className="p-2 bg-orange-100 hover:bg-orange-200 rounded-lg text-orange-700 transition-colors duration-200"
                            title="Disable Treat Wallet"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleOpenActionModal(user, 'enable')}
                            className="p-2 bg-blue-100 hover:bg-blue-200 rounded-lg text-blue-700 transition-colors duration-200"
                            title="Enable Treat Wallet"
                          >
                            <Wallet className="w-4 h-4" />
                          </button>
                        )}
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
          <div className="flex items-center justify-between p-6 border-t border-gray-200">
            <div className="text-sm text-gray-600">
              Showing {((currentPage - 1) * usersPerPage) + 1} to {Math.min(currentPage * usersPerPage, totalUsers)} of {totalUsers} users
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 bg-white border border-gray-300 rounded-md text-gray-700 disabled:opacity-50 hover:bg-gray-100"
              >
                Previous
              </button>
              
              {/* Page Numbers */}
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
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
                className="px-3 py-1 bg-white border border-gray-300 rounded-md text-gray-700 disabled:opacity-50 hover:bg-gray-100"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Action Modal */}
      {showActionModal && selectedUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                {actionData.type === 'add' && <Plus className="w-5 h-5 text-green-600" />}
                {actionData.type === 'remove' && <Minus className="w-5 h-5 text-red-600" />}
                {actionData.type === 'disable' && <Ban className="w-5 h-5 text-orange-600" />}
                {actionData.type === 'enable' && <Wallet className="w-5 h-5 text-blue-600" />}
                {actionData.type === 'add' && 'Add Treats'}
                {actionData.type === 'remove' && 'Remove Treats'}
                {actionData.type === 'disable' && 'Disable Wallet'}
                {actionData.type === 'enable' && 'Enable Wallet'}
              </h3>
              <button
                onClick={handleCloseActionModal}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors duration-200"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* User Info */}
            <div className="mb-6 p-4 bg-gray-100 rounded-lg">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden">
                  {selectedUser.avatar_url ? (
                    <img 
                      src={selectedUser.avatar_url} 
                      alt={selectedUser.display_name || 'User'} 
                      className="w-full h-full object-cover" 
                    />
                  ) : (
                    <span className="text-gray-700 font-semibold">
                      {(selectedUser.display_name || selectedUser.email || 'U').charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
                <div>
                  <p className="font-medium text-gray-900">
                    {selectedUser.display_name || 'Unnamed User'}
                  </p>
                  <p className="text-gray-600 text-sm">{selectedUser.email}</p>
                  <span className={`px-2 py-0.5 rounded-full text-xs border font-medium ${getRoleBadgeClass(selectedUser.role)}`}>
                    {selectedUser.role.charAt(0).toUpperCase() + selectedUser.role.slice(1)}
                  </span>
                </div>
              </div>
              
              {/* Current Wallet Info */}
              {selectedUser.treat_wallet && (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-600">Current Balance</p>
                    <p className="font-bold text-gray-900 text-lg flex items-center gap-1">
                      <Coins className="w-4 h-4 text-yellow-600" />
                      {formatCurrency(selectedUser.treat_wallet.balance)}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600">Total Earned</p>
                    <p className="font-medium text-green-600">
                      {formatCurrency(selectedUser.treat_wallet.total_earned)}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600">Total Spent</p>
                    <p className="font-medium text-red-600">
                      {formatCurrency(selectedUser.treat_wallet.total_spent)}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600">Total Withdrawn</p>
                    <p className="font-medium text-blue-600">
                      {formatCurrency(selectedUser.treat_wallet.total_withdrawn)}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Action Form */}
            <div className="space-y-4">
              {/* Amount Input (for add/remove actions) */}
              {(actionData.type === 'add' || actionData.type === 'remove') && (
                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-2">
                    Amount of Treats *
                  </label>
                  <div className="relative">
                    <Coins className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500" />
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={actionData.amount || ''}
                      onChange={(e) => setActionData(prev => ({
                        ...prev,
                        amount: parseInt(e.target.value) || 0
                      }))}
                      className="w-full pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                      placeholder="Enter amount"
                    />
                  </div>
                  {actionData.type === 'remove' && selectedUser.treat_wallet && (
                    <p className="mt-1 text-xs text-gray-500">
                      Maximum: {formatCurrency(selectedUser.treat_wallet.balance)} treats
                    </p>
                  )}
                </div>
              )}

              {/* Reason Input */}
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Reason for Action *
                </label>
                <textarea
                  value={actionData.reason}
                  onChange={(e) => setActionData(prev => ({
                    ...prev,
                    reason: e.target.value
                  }))}
                  rows={3}
                  className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605] resize-none"
                  placeholder={`Explain why you are ${actionData.type === 'add' ? 'adding treats to' : actionData.type === 'remove' ? 'removing treats from' : actionData.type === 'disable' ? 'disabling the wallet of' : 'enabling the wallet of'} this user...`}
                />
              </div>

              {/* Action Description */}
              <div className={`p-3 rounded-lg border ${
                actionData.type === 'add' ? 'bg-green-50 border-green-200' :
                actionData.type === 'remove' ? 'bg-red-50 border-red-200' :
                actionData.type === 'disable' ? 'bg-orange-50 border-orange-200' :
                'bg-blue-50 border-blue-200'
              }`}>
                <p className={`text-sm ${
                  actionData.type === 'add' ? 'text-green-700' :
                  actionData.type === 'remove' ? 'text-red-700' :
                  actionData.type === 'disable' ? 'text-orange-700' :
                  'text-blue-700'
                }`}>
                  {actionData.type === 'add' && `This will add ${actionData.amount || 0} treats to the user's wallet.`}
                  {actionData.type === 'remove' && `This will remove ${actionData.amount || 0} treats from the user's wallet.`}
                  {actionData.type === 'disable' && 'This will disable the user\'s treat wallet, preventing all treat transactions.'}
                  {actionData.type === 'enable' && 'This will create and enable a treat wallet for this user.'}
                </p>
              </div>

              {actionError && (
                <div className="p-3 bg-red-100 border border-red-200 rounded-lg">
                  <p className="text-red-700 text-sm">{actionError}</p>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleCloseActionModal}
                disabled={isSubmittingAction}
                className="flex-1 px-4 py-2 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg text-gray-700 transition-all duration-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleActionSubmit}
                disabled={
                  isSubmittingAction || 
                  !actionData.reason.trim() ||
                  ((actionData.type === 'add' || actionData.type === 'remove') && (!actionData.amount || actionData.amount <= 0))
                }
                className={`flex-1 px-4 py-2 rounded-lg text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
                  actionData.type === 'add' ? 'bg-green-600 hover:bg-green-700' :
                  actionData.type === 'remove' ? 'bg-red-600 hover:bg-red-700' :
                  actionData.type === 'disable' ? 'bg-orange-600 hover:bg-orange-700' :
                  'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {isSubmittingAction ? (
                  <div className="flex items-center justify-center gap-2">
                    <LoadingLogo variant="pulse" size={16} />
                    Processing...
                  </div>
                ) : (
                  <>
                    {actionData.type === 'add' && `Add ${actionData.amount || 0} Treats`}
                    {actionData.type === 'remove' && `Remove ${actionData.amount || 0} Treats`}
                    {actionData.type === 'disable' && 'Disable Wallet'}
                    {actionData.type === 'enable' && 'Enable Wallet'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
