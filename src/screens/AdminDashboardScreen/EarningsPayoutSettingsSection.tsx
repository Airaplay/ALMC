import React from 'react';
import { useState, useEffect } from 'react';
import {
  DollarSign,
  AlertTriangle,
  Check,
  X,
  Edit,
  Plus,
  RefreshCw,
  Globe,
  MapPin,
  User,
  Trash2,
} from 'lucide-react';
import { supabase, adminDeletePayoutSetting } from '../../lib/supabase';
import { WithdrawalSettingsSection } from './WithdrawalSettingsSection';
import { WithdrawalRequestsSection } from './WithdrawalRequestsSection';
import { LoadingLogo } from '../../components/LoadingLogo';
import ExchangeRatesSection from './ExchangeRatesSection';

interface PayoutSetting {
  id: string;
  setting_type: 'global' | 'country' | 'user';
  country_code: string | null;
  user_id: string | null;
  user_email: string | null;
  user_display_name: string | null;
  payout_threshold: number;
  artist_percentage: number;
  listener_percentage: number;
  platform_percentage: number;
  created_at: string;
  updated_at: string;
}

type EarningsMainTab = 'withdrawal_settings' | 'withdrawal_requests' | 'payout_settings' | 'exchange_rates';

const DEFAULT_VISIBLE_TABS: readonly EarningsMainTab[] = ['withdrawal_settings', 'payout_settings'];

export const EarningsPayoutSettingsSection = ({
  initialMainTab,
  visibleTabs = DEFAULT_VISIBLE_TABS,
}: {
  initialMainTab?: EarningsMainTab;
  visibleTabs?: readonly EarningsMainTab[];
}): JSX.Element => {
  // Payout settings state
  const [payoutSettings, setPayoutSettings] = useState<PayoutSetting[]>([]);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingTypeFilter, setSettingTypeFilter] = useState<string>('all');
  const [editingSetting, setEditingSetting] = useState<PayoutSetting | null>(null);
  const [isSubmittingSettings, setIsSubmittingSettings] = useState(false);
  const [settingsActionSuccess, setSettingsActionSuccess] = useState<string | null>(null);
  
  // New setting form state
  const [showNewSettingForm, setShowNewSettingForm] = useState(false);
  const [newSettingType, setNewSettingType] = useState<'country' | 'user'>('country');
  const [countryCode, setCountryCode] = useState<string>('');
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [userSearchQuery, setUserSearchQuery] = useState<string>('');
  const [userSearchResults, setUserSearchResults] = useState<any[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  
  // Delete setting state
  const [isDeletingSetting, setIsDeletingSetting] = useState<string | null>(null);
  
  // Main tab state
  const resolveInitialTab = (): EarningsMainTab => {
    const requested = initialMainTab ?? 'withdrawal_settings';
    if (visibleTabs.includes(requested)) return requested;
    return visibleTabs[0] ?? 'withdrawal_settings';
  };

  const [mainTab, setMainTab] = useState<EarningsMainTab>(resolveInitialTab);

  
  // Form data for editing/creating settings
  const [formData, setFormData] = useState({
    payout_threshold: 10,
    artist_percentage: 45,
    listener_percentage: 20,
    platform_percentage: 35
  });

  const getFilteredSettings = () => {
    if (settingTypeFilter === 'all') return payoutSettings;
    return payoutSettings.filter(setting => setting.setting_type === settingTypeFilter);
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

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const getSettingTypeIcon = (type: string) => {
    switch (type) {
      case 'global':
        return <Globe className="w-5 h-5 text-blue-600" />;
      case 'country':
        return <MapPin className="w-5 h-5 text-green-600" />;
      case 'user':
        return <User className="w-5 h-5 text-[#309605]" />;
      default:
        return <Globe className="w-5 h-5 text-gray-600" />;
    }
  };

  useEffect(() => {
    fetchPayoutSettings();
  }, []);

  useEffect(() => {
    // Validate that regular percentages sum to 100
    const sum = formData.artist_percentage + formData.listener_percentage + formData.platform_percentage;
    if (sum !== 100) {
      // Adjust platform percentage to make sum 100
      const newPlatformPercentage = 100 - formData.artist_percentage - formData.listener_percentage;
      if (newPlatformPercentage >= 0) {
        setFormData(prev => ({
          ...prev,
          platform_percentage: newPlatformPercentage
        }));
      }
    }
  }, [formData.artist_percentage, formData.listener_percentage]);


  const fetchPayoutSettings = async () => {
    try {
      setIsLoadingSettings(true);
      setSettingsError(null);

      const { data, error } = await supabase.rpc('admin_get_payout_settings', {
        setting_type_filter: null,
        country_code_filter: null,
        user_id_filter: null
      });

      if (error) {
        console.error('Supabase RPC error:', error);
        
        // Check if it's a function signature mismatch (new columns expected but old function exists)
        if (error.message?.includes('column') || error.code === '42703') {
          throw new Error('Database schema mismatch. The ad revenue splitting migration may not be applied. Please run: npx supabase db push');
        }
        
        throw error;
      }
      
      const settings = data || [];
      
      setPayoutSettings(settings);
    } catch (err: any) {
      console.error('Error fetching payout settings:', err);
      
      // Provide more detailed error messages
      let errorMessage = 'Failed to load payout settings';
      
      if (err?.message) {
        errorMessage = `Failed to load payout settings: ${err.message}`;
      } else if (err?.code) {
        errorMessage = `Database error (${err.code}): ${err.message || 'Unknown error'}`;
      } else if (typeof err === 'string') {
        errorMessage = err;
      }
      
      // Check if function doesn't exist
      if (err?.message?.includes('function') || err?.code === '42883') {
        errorMessage = 'The payout settings function is not available. Please ensure the database migrations have been applied: npx supabase db push';
      }
      
      // Check if columns don't exist (old function without ad revenue columns)
      if (err?.message?.includes('column') || err?.code === '42703') {
        errorMessage = 'Database schema mismatch. Please apply the ad revenue splitting migration: npx supabase db push';
      }
      
      setSettingsError(errorMessage);
    } finally {
      setIsLoadingSettings(false);
    }
  };

  const handleEditSetting = (setting: PayoutSetting) => {
    setEditingSetting(setting);
    setFormData({
      payout_threshold: setting.payout_threshold,
      artist_percentage: setting.artist_percentage,
      listener_percentage: setting.listener_percentage,
      platform_percentage: setting.platform_percentage
    });
    setShowNewSettingForm(false);
  };

  const resetSettingsForm = () => {
    setFormData({
      payout_threshold: 10,
      artist_percentage: 45,
      listener_percentage: 20,
      platform_percentage: 35
    });
    setNewSettingType('country');
    setCountryCode('');
    setSelectedUserId('');
    setUserSearchQuery('');
    setUserSearchResults([]);
  };

  const handleUpdateSettings = async () => {
    if (!editingSetting) return;
    
    try {
      setIsSubmittingSettings(true);
      setSettingsError(null);
      setSettingsActionSuccess(null);

      const { data, error } = await supabase.rpc('admin_update_payout_settings', {
        setting_id: editingSetting.id,
        new_payout_threshold: formData.payout_threshold,
        new_artist_percentage: formData.artist_percentage,
        new_listener_percentage: formData.listener_percentage,
        new_platform_percentage: formData.platform_percentage
      });

      if (error) {
        throw error;
      }

      // Check for error in response
      if (data && typeof data === 'object' && 'error' in data) {
        throw new Error(data.error as string);
      }

      // Reset form and refresh data
      setEditingSetting(null);
      resetSettingsForm();
      
      // Show success message
      setSettingsActionSuccess('Payout settings updated successfully');
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSettingsActionSuccess(null);
      }, 3000);
      
      // Refresh payout settings
      fetchPayoutSettings();
    } catch (err) {
      console.error('Error updating payout settings:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to update payout settings';
      setSettingsError(errorMessage);
    } finally {
      setIsSubmittingSettings(false);
    }
  };

  const handleCreateNewSetting = async () => {
    try {
      setIsSubmittingSettings(true);
      setSettingsError(null);
      setSettingsActionSuccess(null);

      // Validate form based on setting type
      if (newSettingType === 'country' && !countryCode) {
        setSettingsError('Country code is required');
        setIsSubmittingSettings(false);
        return;
      }

      if (newSettingType === 'user' && !selectedUserId) {
        setSettingsError('User selection is required');
        setIsSubmittingSettings(false);
        return;
      }

      const { data, error } = await supabase.rpc('admin_create_payout_settings', {
        new_setting_type: newSettingType,
        new_country_code: newSettingType === 'country' ? countryCode : null,
        new_user_id: newSettingType === 'user' ? selectedUserId : null,
        new_payout_threshold: formData.payout_threshold,
        new_artist_percentage: formData.artist_percentage,
        new_listener_percentage: formData.listener_percentage,
        new_platform_percentage: formData.platform_percentage
      });

      if (error) {
        throw error;
      }

      // Check for error in response
      if (data && typeof data === 'object' && 'error' in data) {
        throw new Error(data.error as string);
      }

      // Reset form and refresh data
      setShowNewSettingForm(false);
      resetSettingsForm();
      
      // Show success message
      setSettingsActionSuccess('New payout settings created successfully');
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSettingsActionSuccess(null);
      }, 3000);
      
      // Refresh payout settings
      fetchPayoutSettings();
    } catch (err) {
      console.error('Error creating payout settings:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to create payout settings';
      setSettingsError(errorMessage);
    } finally {
      setIsSubmittingSettings(false);
    }
  };

  const handleSearchUsers = async () => {
    if (!userSearchQuery.trim() || userSearchQuery.length < 3) return;
    
    try {
      setIsSearchingUsers(true);
      
      const { data, error } = await supabase
        .from('users')
        .select('id, email, username, display_name')
        .or(`email.ilike.%${userSearchQuery}%,display_name.ilike.%${userSearchQuery}%,username.ilike.%${userSearchQuery}%`)
        .limit(5);

      if (error) throw error;
      
      setUserSearchResults(data || []);
    } catch (err) {
      console.error('Error searching users:', err);
    } finally {
      setIsSearchingUsers(false);
    }
  };

  const handleSelectUser = (user: any) => {
    setSelectedUserId(user.id);
    setUserSearchQuery(user.display_name || user.email);
    setUserSearchResults([]);
  };

  const handleDeleteSetting = async (setting: PayoutSetting) => {
    // Prevent deletion of global settings
    if (setting.setting_type === 'global') {
      setSettingsError('Global payout settings cannot be deleted');
      return;
    }

    const settingDescription = setting.setting_type === 'country' 
      ? `country-specific setting for ${setting.country_code}`
      : `user-specific setting for ${setting.user_display_name || setting.user_email}`;

    if (!confirm(`Are you sure you want to delete the ${settingDescription}? This action cannot be undone.`)) {
      return;
    }

    try {
      setIsDeletingSetting(setting.id);
      setSettingsError(null);
      setSettingsActionSuccess(null);

      const result = await adminDeletePayoutSetting(setting.id);

      if (result?.error) {
        throw new Error(result.error);
      }

      // Update local state to remove the deleted setting
      setPayoutSettings(prev => prev.filter(s => s.id !== setting.id));
      
      setSettingsActionSuccess(`Payout setting deleted successfully`);
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSettingsActionSuccess(null);
      }, 3000);
    } catch (err) {
      console.error('Error deleting payout setting:', err);
      setSettingsError(err instanceof Error ? err.message : 'Failed to delete payout setting');
    } finally {
      setIsDeletingSetting(null);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    
    // Convert to number and validate
    const numValue = parseFloat(value);
    
    if (isNaN(numValue)) return;
    
    // Apply specific validations based on field
    if (name === 'payout_threshold') {
      if (numValue < 1) return;
      setFormData(prev => ({ ...prev, [name]: numValue }));
    } else if (['artist_percentage', 'listener_percentage'].includes(name)) {
      if (numValue < 0 || numValue > 100) return;
      setFormData(prev => ({ ...prev, [name]: numValue }));
    }
  };

  const inputCls = "w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605] focus:border-transparent";
  const labelCls = "block text-xs font-medium text-gray-600 mb-1.5";

  return (
    <div className="space-y-5 min-h-full">
      <div>
        <h2 className="text-xl font-bold text-gray-900 leading-tight">Earnings & Payout Settings</h2>
        <p className="text-sm text-gray-400 mt-0.5">Configure withdrawal thresholds, payout splits, and exchange rates</p>
      </div>

      {/* Main Tabs */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="border-b border-gray-100">
          <nav className="flex gap-1 px-4 pt-1">
            {visibleTabs.map((tab) => {
              const labels: Record<string, string> = {
                withdrawal_settings: 'Withdrawal Settings',
                withdrawal_requests: 'Withdrawal Requests',
                payout_settings: 'Payout Settings',
                exchange_rates: 'Exchange Rates',
              };
              return (
                <button
                  key={tab}
                  onClick={() => setMainTab(tab)}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    mainTab === tab
                      ? 'border-[#309605] text-[#309605]'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-200'
                  }`}
                >
                  {labels[tab]}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-5">
          {mainTab === 'withdrawal_settings' && (
            <WithdrawalSettingsSection />
          )}

          {mainTab === 'withdrawal_requests' && (
            <WithdrawalRequestsSection />
          )}

          {mainTab === 'payout_settings' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
                    <DollarSign className="w-4 h-4 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 leading-tight">Payout Settings</h3>
                    <p className="text-xs text-gray-400 mt-0.5">Earnings distribution for tips and promotions</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <select
                    value={settingTypeFilter}
                    onChange={(e) => setSettingTypeFilter(e.target.value)}
                    className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                  >
                    <option value="all">All Settings</option>
                    <option value="global">Global</option>
                    <option value="country">Country</option>
                    <option value="user">User</option>
                  </select>
                  <button
                    onClick={() => { setShowNewSettingForm(true); setEditingSetting(null); }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#309605] hover:bg-[#3ba208] rounded-lg text-white text-xs font-medium transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New Setting
                  </button>
                </div>
              </div>

              <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg">
                <p className="text-xs text-blue-700">
                  These settings control earnings distribution for tips, promotions, and other non-ad revenue.
                  Ad revenue splitting is configured in <strong>Ad Management → Ad Safety Caps & Revenue Split</strong>.
                </p>
              </div>

              {settingsActionSuccess && (
                <div className="p-3 bg-green-50 border border-green-100 rounded-lg">
                  <p className="text-sm text-green-700">{settingsActionSuccess}</p>
                </div>
              )}

              {settingsError && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-lg">
                  <p className="text-sm text-red-700">{settingsError}</p>
                </div>
              )}

              {/* Settings Form (Edit or Create) */}
              {(editingSetting || showNewSettingForm) && (
                <div className="p-5 bg-gray-50 rounded-xl border border-gray-100">
                  <h4 className="text-sm font-semibold text-gray-900 mb-4">
                    {editingSetting ? 'Edit Payout Settings' : 'Create New Payout Settings'}
                  </h4>

                  {showNewSettingForm && (
                    <div className="mb-4">
                      <label className={labelCls}>Setting Type</label>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                          <input type="radio" name="settingType" value="country" checked={newSettingType === 'country'} onChange={() => setNewSettingType('country')} className="accent-[#309605]" />
                          Country-Specific
                        </label>
                        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                          <input type="radio" name="settingType" value="user" checked={newSettingType === 'user'} onChange={() => setNewSettingType('user')} className="accent-[#309605]" />
                          User-Specific
                        </label>
                      </div>
                    </div>
                  )}

                  {showNewSettingForm && newSettingType === 'country' && (
                    <div className="mb-4">
                      <label className={labelCls}>Country Code (ISO)</label>
                      <input
                        type="text"
                        value={countryCode}
                        onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
                        placeholder="e.g., US, GB, NG"
                        className={inputCls}
                        maxLength={2}
                      />
                      <p className="mt-1 text-xs text-gray-400">2-letter ISO code (e.g., US for United States)</p>
                    </div>
                  )}

                  {showNewSettingForm && newSettingType === 'user' && (
                    <div className="mb-4">
                      <label className={labelCls}>Select User</label>
                      <div className="relative">
                        <input
                          type="text"
                          value={userSearchQuery}
                          onChange={(e) => {
                            setUserSearchQuery(e.target.value);
                            if (e.target.value.length >= 3) { handleSearchUsers(); } else { setUserSearchResults([]); }
                          }}
                          placeholder="Search by email or name"
                          className={inputCls}
                        />
                        <button type="button" onClick={handleSearchUsers} className="absolute right-2 top-1/2 -translate-y-1/2">
                          <User className="w-4 h-4 text-gray-400" />
                        </button>
                        {userSearchResults.length > 0 && (
                          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                            {userSearchResults.map(user => (
                              <div key={user.id} className="p-3 hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-0" onClick={() => handleSelectUser(user)}>
                                <p className="text-sm font-medium text-gray-900">{user.display_name || 'Unnamed User'}</p>
                                <p className="text-xs text-gray-500">{user.email}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        {isSearchingUsers && <div className="absolute right-8 top-1/2 -translate-y-1/2"><LoadingLogo variant="pulse" size={14} /></div>}
                      </div>
                      {selectedUserId && <p className="mt-1.5 text-xs text-green-600">User selected</p>}
                    </div>
                  )}

                  <div className="mb-4">
                    <label className={labelCls}>Payout Threshold (USD)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                      <input
                        type="number"
                        name="payout_threshold"
                        value={formData.payout_threshold}
                        onChange={handleInputChange}
                        min="1"
                        step="0.01"
                        className={`${inputCls} pl-7`}
                      />
                    </div>
                    <p className="mt-1 text-xs text-gray-400">Minimum amount before requesting a withdrawal</p>
                  </div>

                  <div className="mb-4">
                    <label className={labelCls}>Earnings Distribution (%)</label>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Artist/Creator</label>
                        <input type="number" name="artist_percentage" value={formData.artist_percentage} onChange={handleInputChange} min="0" max="100" className={inputCls} />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Listener</label>
                        <input type="number" name="listener_percentage" value={formData.listener_percentage} onChange={handleInputChange} min="0" max="100" className={inputCls} />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Platform (Auto)</label>
                        <input type="number" name="platform_percentage" value={formData.platform_percentage} readOnly className="w-full px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm text-gray-500 cursor-not-allowed" />
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">
                      Total: {formData.artist_percentage + formData.listener_percentage + formData.platform_percentage}%
                      {formData.artist_percentage + formData.listener_percentage + formData.platform_percentage !== 100 && (
                        <span className="text-red-500 ml-1">(Must equal 100%)</span>
                      )}
                    </p>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => { setEditingSetting(null); setShowNewSettingForm(false); resetSettingsForm(); }}
                      className="px-4 py-2 text-sm bg-white hover:bg-gray-50 border border-gray-200 rounded-lg text-gray-700 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={editingSetting ? handleUpdateSettings : handleCreateNewSetting}
                      disabled={isSubmittingSettings || formData.artist_percentage + formData.listener_percentage + formData.platform_percentage !== 100 || formData.payout_threshold < 1 || (showNewSettingForm && newSettingType === 'country' && !countryCode) || (showNewSettingForm && newSettingType === 'user' && !selectedUserId)}
                      className="px-4 py-2 text-sm bg-[#309605] hover:bg-[#3ba208] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white transition-colors"
                    >
                      {isSubmittingSettings ? 'Saving...' : (editingSetting ? 'Update Settings' : 'Create Settings')}
                    </button>
                  </div>
                </div>
              )}

              {isLoadingSettings ? (
                <div className="flex items-center gap-3 py-10 justify-center">
                  <LoadingLogo variant="pulse" size={24} />
                  <p className="text-sm text-gray-500">Loading payout settings...</p>
                </div>
              ) : settingsError && payoutSettings.length === 0 ? (
                <div className="p-5 bg-red-50 border border-red-100 rounded-xl text-center">
                  <AlertTriangle className="w-7 h-7 text-red-400 mx-auto mb-2" />
                  <p className="text-sm text-red-600">{settingsError}</p>
                  <button onClick={fetchPayoutSettings} className="mt-3 px-3 py-1.5 text-xs bg-red-100 hover:bg-red-200 text-red-700 rounded-lg">Try Again</button>
                </div>
              ) : getFilteredSettings().length === 0 ? (
                <div className="p-8 bg-white rounded-xl border border-gray-100 text-center">
                  <p className="text-sm text-gray-500">No {settingTypeFilter === 'all' ? '' : settingTypeFilter} payout settings found.</p>
                </div>
              ) : (
                <div className="overflow-x-auto bg-white rounded-xl border border-gray-100 shadow-sm">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Applies To</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Threshold</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Creator %</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Listener %</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Platform %</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Updated</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {getFilteredSettings().map((setting) => (
                        <tr key={setting.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {getSettingTypeIcon(setting.setting_type)}
                              <span className="text-sm capitalize text-gray-700">{setting.setting_type}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {setting.setting_type === 'global' ? (
                              <span className="text-sm text-gray-600">All Users</span>
                            ) : setting.setting_type === 'country' ? (
                              <span className="text-sm font-medium text-gray-900">{setting.country_code}</span>
                            ) : (
                              <div>
                                <p className="text-sm font-medium text-gray-900">{setting.user_display_name || 'Unnamed User'}</p>
                                <p className="text-xs text-gray-500">{setting.user_email}</p>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{formatCurrency(setting.payout_threshold)}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{setting.artist_percentage}%</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{setting.listener_percentage}%</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{setting.platform_percentage}%</td>
                          <td className="px-4 py-3 text-xs text-gray-500">{formatDate(setting.updated_at)}</td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1.5">
                              <button onClick={() => handleEditSetting(setting)} className="p-1.5 bg-blue-50 hover:bg-blue-100 rounded-lg text-blue-600 transition-colors" title="Edit">
                                <Edit className="w-3.5 h-3.5" />
                              </button>
                              {setting.setting_type !== 'global' && (
                                <button onClick={() => handleDeleteSetting(setting)} disabled={isDeletingSetting === setting.id} className="p-1.5 bg-red-50 hover:bg-red-100 rounded-lg text-red-500 disabled:opacity-50 transition-colors" title="Delete">
                                  {isDeletingSetting === setting.id ? <LoadingLogo variant="pulse" size={14} /> : <Trash2 className="w-3.5 h-3.5" />}
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
            </div>
          )}

          {mainTab === 'exchange_rates' && (
            <ExchangeRatesSection />
          )}
        </div>
      </div>
    </div>
  );
};