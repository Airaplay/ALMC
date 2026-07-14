import { useState, useEffect } from 'react';
import { Users, TrendingUp, AlertTriangle, DollarSign, Gift, CheckCircle, XCircle, RefreshCw, Settings, Search, ArrowLeft, Ban, Share2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Card, CardContent } from '../../components/ui/card';
import { LoadingLogo } from '../../components/LoadingLogo';
import { ReferralMilestoneProgramTab } from './ReferralMilestoneProgramTab';

interface ReferralAnalytics {
  total_referrals: number;
  active_referrals: number;
  inactive_referrals: number;
  rewarded_referrals: number;
  flagged_referrals: number;
  total_treats_spent_on_promotions: number;
  total_treats_rewarded: number;
  unique_referrers: number;
  unique_referred_users: number;
}

interface ReferralSettings {
  id: string;
  reward_per_referral: number;
  max_referrals_monthly: number | null;
  max_referrals_lifetime: number | null;
  program_active: boolean;
  detect_abuse: boolean;
  enabled: boolean;
}

interface ReferralDetail {
  id: string;
  referrer_id: string;
  referred_id: string;
  referral_code: string;
  status: string;
  reward_amount: number;
  treat_spent: number;
  is_active: boolean;
  flagged_for_abuse: boolean;
  created_at: string;
  rewarded_at: string | null;
  referrer_name: string;
  referred_name: string;
}

interface ReferrerSummary {
  referrer_id: string;
  referrer_name: string;
  referrer_email: string;
  referral_code: string;
  total_referrals: number;
  active_referrals: number;
  pending_referrals: number;
  total_rewards: number;
  date_joined: string;
}

export const ReferralManagementSection = (): JSX.Element => {
  const [analytics, setAnalytics] = useState<ReferralAnalytics | null>(null);
  const [settings, setSettings] = useState<ReferralSettings | null>(null);
  const [referrersSummary, setReferrersSummary] = useState<ReferrerSummary[]>([]);
  const [selectedReferrer, setSelectedReferrer] = useState<ReferrerSummary | null>(null);
  const [referrerDetails, setReferrerDetails] = useState<ReferralDetail[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'settings' | 'activity' | 'milestone'>('overview');
  const [isUpdatingSettings, setIsUpdatingSettings] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [volumeFilter, setVolumeFilter] = useState<'all' | 'high' | 'low'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending'>('all');
  const [formData, setFormData] = useState({
    reward_per_referral: 100,
    max_referrals_monthly: '',
    max_referrals_lifetime: '',
    program_active: true,
    detect_abuse: true,
  });

  useEffect(() => {
    loadReferralData();
  }, []);

  const loadReferralData = async () => {
    try {
      setIsLoading(true);

      const [analyticsRes, settingsRes, referralsRes] = await Promise.all([
        supabase.from('referral_analytics_overview').select('*').single(),
        supabase.from('referral_settings').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase
          .from('referrals')
          .select(`
            *,
            referrer:users!referrals_referrer_id_fkey(display_name, email, created_at),
            referred:users!referrals_referred_id_fkey(display_name, email)
          `)
          .order('created_at', { ascending: false }),
      ]);

      if (analyticsRes.data) {
        setAnalytics(analyticsRes.data);
      }

      if (settingsRes.data) {
        setSettings(settingsRes.data);
        setFormData({
          reward_per_referral: settingsRes.data.reward_per_referral,
          max_referrals_monthly: settingsRes.data.max_referrals_monthly?.toString() || '',
          max_referrals_lifetime: settingsRes.data.max_referrals_lifetime?.toString() || '',
          program_active: settingsRes.data.program_active,
          detect_abuse: settingsRes.data.detect_abuse,
        });
      }

      if (referralsRes.data) {
        const formattedReferrals = referralsRes.data.map((r: any) => ({
          ...r,
          referrer_name: r.referrer?.display_name || r.referrer?.email || 'Unknown',
          referred_name: r.referred?.display_name || r.referred?.email || 'Unknown',
        }));

        // Generate referrers summary
        const referrersMap = new Map<string, ReferrerSummary>();
        formattedReferrals.forEach((r: any) => {
          const existing = referrersMap.get(r.referrer_id);
          if (existing) {
            existing.total_referrals++;
            if (r.is_active) existing.active_referrals++;
            if (r.status === 'pending') existing.pending_referrals++;
            existing.total_rewards += r.reward_amount;
          } else {
            referrersMap.set(r.referrer_id, {
              referrer_id: r.referrer_id,
              referrer_name: r.referrer_name,
              referrer_email: r.referrer?.email || '',
              referral_code: r.referral_code,
              total_referrals: 1,
              active_referrals: r.is_active ? 1 : 0,
              pending_referrals: r.status === 'pending' ? 1 : 0,
              total_rewards: r.reward_amount,
              date_joined: r.referrer?.created_at || r.created_at,
            });
          }
        });
        setReferrersSummary(Array.from(referrersMap.values()));
      }
    } catch (error) {
      console.error('Error loading referral data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateSettings = async () => {
    try {
      setIsUpdatingSettings(true);

      const updateData = {
        reward_per_referral: parseInt(formData.reward_per_referral.toString()),
        max_referrals_monthly: formData.max_referrals_monthly ? parseInt(formData.max_referrals_monthly) : null,
        max_referrals_lifetime: formData.max_referrals_lifetime ? parseInt(formData.max_referrals_lifetime) : null,
        program_active: formData.program_active,
        detect_abuse: formData.detect_abuse,
        updated_at: new Date().toISOString(),
      };

      if (settings?.id) {
        const { error } = await supabase
          .from('referral_settings')
          .update(updateData)
          .eq('id', settings.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('referral_settings')
          .insert([updateData]);

        if (error) throw error;
      }

      await loadReferralData();
      alert('Settings updated successfully!');
    } catch (error) {
      console.error('Error updating settings:', error);
      alert('Failed to update settings');
    } finally {
      setIsUpdatingSettings(false);
    }
  };

  const handleToggleFlagAbuse = async (referralId: string, currentFlag: boolean) => {
    try {
      const { error } = await supabase
        .from('referrals')
        .update({ flagged_for_abuse: !currentFlag })
        .eq('id', referralId);

      if (error) throw error;

      await loadReferralData();
    } catch (error) {
      console.error('Error toggling abuse flag:', error);
      alert('Failed to update flag status');
    }
  };

  const handleResetMonthlyCounters = async () => {
    try {
      if (!confirm('Are you sure you want to reset all monthly referral counters?')) {
        return;
      }

      const { error } = await supabase.rpc('reset_monthly_referral_counts');

      if (error) throw error;

      alert('Monthly counters reset successfully!');
      await loadReferralData();
    } catch (error) {
      console.error('Error resetting monthly counters:', error);
      alert('Failed to reset counters');
    }
  };

  const loadReferrerDetails = async (referrer: ReferrerSummary) => {
    try {
      setSelectedReferrer(referrer);
      setIsLoading(true);

      const { data, error } = await supabase
        .from('referrals')
        .select(`
          *,
          referrer:users!referrals_referrer_id_fkey(display_name, email),
          referred:users!referrals_referred_id_fkey(display_name, email, id)
        `)
        .eq('referrer_id', referrer.referrer_id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formatted = data.map((r: any) => ({
        ...r,
        referrer_name: r.referrer?.display_name || r.referrer?.email || 'Unknown',
        referred_name: r.referred?.display_name || r.referred?.email || 'Unknown',
      }));
      setReferrerDetails(formatted);
    } catch (error) {
      console.error('Error loading referrer details:', error);
      alert('Failed to load referrer details');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRevokeReferral = async (referralId: string) => {
    try {
      if (!confirm('Are you sure you want to revoke this referral? This will remove the reward.')) {
        return;
      }

      const referral = referrerDetails.find(r => r.id === referralId);
      if (!referral) return;

      // Update referral status
      const { error: updateError } = await supabase
        .from('referrals')
        .update({
          status: 'revoked',
          is_active: false,
          flagged_for_abuse: true
        })
        .eq('id', referralId);

      if (updateError) throw updateError;

      // Deduct reward from user if it was already rewarded
      if (referral.status === 'rewarded' && referral.reward_amount > 0) {
        const { error: balanceError } = await supabase.rpc('add_treat_balance', {
          p_user_id: referral.referrer_id,
          p_amount: -referral.reward_amount,
          p_transaction_type: 'referral_revoked',
          p_description: `Referral reward revoked for user ${referral.referred_name}`,
          p_reference_id: referralId
        });

        if (balanceError) throw balanceError;
      }

      alert('Referral revoked successfully');
      if (selectedReferrer) {
        await loadReferrerDetails(selectedReferrer);
      }
      await loadReferralData();
    } catch (error) {
      console.error('Error revoking referral:', error);
      alert('Failed to revoke referral');
    }
  };

  const handleSuspendUser = async (userId: string, userName: string) => {
    try {
      if (!confirm(`Are you sure you want to suspend ${userName}? This will deactivate their account.`)) {
        return;
      }

      const { error } = await supabase
        .from('users')
        .update({ role: 'suspended' })
        .eq('id', userId);

      if (error) throw error;

      alert(`User ${userName} has been suspended`);
      if (selectedReferrer) {
        await loadReferrerDetails(selectedReferrer);
      }
    } catch (error) {
      console.error('Error suspending user:', error);
      alert('Failed to suspend user');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingLogo variant="pulse" size={32} />
        <p className="ml-4 text-gray-700">Loading referral data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
            <Share2 className="w-4 h-4 text-green-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 leading-tight">Referral Management</h2>
            <p className="text-sm text-gray-400 mt-0.5">Track referral codes, bonuses, and program settings</p>
          </div>
        </div>
        <div>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'overview'
              ? 'bg-[#309605] text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'settings'
              ? 'bg-[#309605] text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Settings
        </button>
        <button
          onClick={() => setActiveTab('activity')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'activity'
              ? 'bg-[#309605] text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Activity
        </button>
        <button
          onClick={() => setActiveTab('milestone')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'milestone'
              ? 'bg-[#309605] text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          ₦5K Milestone
        </button>
      </div>

      {activeTab === 'milestone' && <ReferralMilestoneProgramTab />}

      {activeTab === 'overview' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <Users className="w-8 h-8 text-[#309605]" />
                  <TrendingUp className="w-5 h-5 text-green-500" />
                </div>
                <h3 className="text-gray-600 text-sm font-medium mb-1">Total Referrals</h3>
                <p className="text-3xl font-bold text-gray-900">{analytics?.total_referrals || 0}</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <CheckCircle className="w-8 h-8 text-blue-500" />
                </div>
                <h3 className="text-gray-600 text-sm font-medium mb-1">Active Referrals</h3>
                <p className="text-3xl font-bold text-blue-600">{analytics?.active_referrals || 0}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Inactive: {analytics?.inactive_referrals || 0}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <Gift className="w-8 h-8 text-[#309605]" />
                </div>
                <h3 className="text-gray-600 text-sm font-medium mb-1">Total Treats Spent</h3>
                <p className="text-3xl font-bold text-gray-900">
                  {analytics?.total_treats_spent_on_promotions || 0}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  For referral promotions
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <AlertTriangle className="w-8 h-8 text-red-500" />
                </div>
                <h3 className="text-gray-600 text-sm font-medium mb-1">Flagged for Abuse</h3>
                <p className="text-3xl font-bold text-red-600">{analytics?.flagged_referrals || 0}</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <DollarSign className="w-6 h-6 text-[#309605]" />
                  <h3 className="text-lg font-semibold text-gray-900">Reward Statistics</h3>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b border-gray-200">
                    <span className="text-gray-600">Rewarded Referrals</span>
                    <span className="font-bold text-gray-900">{analytics?.rewarded_referrals || 0}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-gray-200">
                    <span className="text-gray-600">Total Treats Rewarded</span>
                    <span className="font-bold text-[#309605]">{analytics?.total_treats_rewarded || 0}</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-gray-600">Unique Referrers</span>
                    <span className="font-bold text-gray-900">{analytics?.unique_referrers || 0}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Settings className="w-6 h-6 text-gray-700" />
                  <h3 className="text-lg font-semibold text-gray-900">Program Status</h3>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b border-gray-200">
                    <span className="text-gray-600">Program Active</span>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      settings?.program_active
                        ? 'bg-green-100 text-green-700'
                        : 'bg-red-100 text-red-700'
                    }`}>
                      {settings?.program_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-gray-200">
                    <span className="text-gray-600">Abuse Detection</span>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      settings?.detect_abuse
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-700'
                    }`}>
                      {settings?.detect_abuse ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-gray-600">Reward per Referral</span>
                    <span className="font-bold text-[#309605]">{settings?.reward_per_referral || 100} Treats</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {activeTab === 'settings' && (
        <Card>
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Referral Program Settings</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reward per Referral (Treats)
                </label>
                <input
                  type="number"
                  value={formData.reward_per_referral}
                  onChange={(e) => setFormData({ ...formData, reward_per_referral: parseInt(e.target.value) || 0 })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#309605] focus:border-transparent"
                  min="0"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Max Referrals per Month (leave empty for unlimited)
                </label>
                <input
                  type="number"
                  value={formData.max_referrals_monthly}
                  onChange={(e) => setFormData({ ...formData, max_referrals_monthly: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#309605] focus:border-transparent"
                  min="0"
                  placeholder="Unlimited"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Max Referrals Lifetime (leave empty for unlimited)
                </label>
                <input
                  type="number"
                  value={formData.max_referrals_lifetime}
                  onChange={(e) => setFormData({ ...formData, max_referrals_lifetime: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#309605] focus:border-transparent"
                  min="0"
                  placeholder="Unlimited"
                />
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="program_active"
                  checked={formData.program_active}
                  onChange={(e) => setFormData({ ...formData, program_active: e.target.checked })}
                  className="w-4 h-4 text-[#309605] border-gray-300 rounded focus:ring-[#309605]"
                />
                <label htmlFor="program_active" className="text-sm font-medium text-gray-700">
                  Referral Program Active
                </label>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="detect_abuse"
                  checked={formData.detect_abuse}
                  onChange={(e) => setFormData({ ...formData, detect_abuse: e.target.checked })}
                  className="w-4 h-4 text-[#309605] border-gray-300 rounded focus:ring-[#309605]"
                />
                <label htmlFor="detect_abuse" className="text-sm font-medium text-gray-700">
                  Enable Abuse Detection
                </label>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleUpdateSettings}
                  disabled={isUpdatingSettings}
                  className="flex-1 px-6 py-3 bg-[#309605] text-white rounded-lg hover:bg-[#3ba208] transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {isUpdatingSettings ? 'Saving...' : 'Save Settings'}
                </button>
                <button
                  onClick={handleResetMonthlyCounters}
                  className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Reset Monthly Counters
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'activity' && (
        <div className="space-y-6">
          {!selectedReferrer ? (
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold text-gray-900">Referrer Activity Summary</h3>
                  <button
                    onClick={loadReferralData}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Refresh
                  </button>
                </div>

                {/* Filters */}
                <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search by name or code..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#309605] focus:border-transparent"
                    />
                  </div>
                  <select
                    value={volumeFilter}
                    onChange={(e) => setVolumeFilter(e.target.value as 'all' | 'high' | 'low')}
                    className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#309605] focus:border-transparent"
                  >
                    <option value="all">All Volume</option>
                    <option value="high">High Volume (5+ referrals)</option>
                    <option value="low">Low Volume (&lt;5 referrals)</option>
                  </select>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'pending')}
                    className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#309605] focus:border-transparent"
                  >
                    <option value="all">All Status</option>
                    <option value="active">Active</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>

                {/* Referrers Table */}
                <div className="overflow-x-auto scrollbar-hide">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Referrer Name</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Referral Code</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Total Referred</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Active</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Pending</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Total Rewards</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Date Joined</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {referrersSummary
                        .filter(r => {
                          const matchesSearch = searchQuery === '' ||
                            r.referrer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            r.referral_code.toLowerCase().includes(searchQuery.toLowerCase());
                          const matchesVolume = volumeFilter === 'all' ||
                            (volumeFilter === 'high' && r.total_referrals >= 5) ||
                            (volumeFilter === 'low' && r.total_referrals < 5);
                          const matchesStatus = statusFilter === 'all' ||
                            (statusFilter === 'active' && r.active_referrals > 0) ||
                            (statusFilter === 'pending' && r.pending_referrals > 0);
                          return matchesSearch && matchesVolume && matchesStatus;
                        })
                        .map((referrer) => (
                          <tr key={referrer.referrer_id} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="py-3 px-4 text-sm text-gray-900">{referrer.referrer_name}</td>
                            <td className="py-3 px-4 text-sm text-gray-600 font-mono">{referrer.referral_code}</td>
                            <td className="py-3 px-4 text-sm font-medium text-gray-900">{referrer.total_referrals}</td>
                            <td className="py-3 px-4 text-sm text-blue-600 font-medium">{referrer.active_referrals}</td>
                            <td className="py-3 px-4 text-sm text-yellow-600 font-medium">{referrer.pending_referrals}</td>
                            <td className="py-3 px-4 text-sm font-medium text-[#309605]">
                              {referrer.total_rewards} Treats
                            </td>
                            <td className="py-3 px-4 text-sm text-gray-600">
                              {new Date(referrer.date_joined).toLocaleDateString()}
                            </td>
                            <td className="py-3 px-4">
                              <button
                                onClick={() => loadReferrerDetails(referrer)}
                                className="px-3 py-1 bg-[#309605] text-white rounded-lg hover:bg-[#3ba208] transition-colors text-sm font-medium"
                              >
                                View Details
                              </button>
                            </td>
                          </tr>
                        ))}
                      {referrersSummary.length === 0 && (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-gray-500">
                            No referrers found
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <button
                    onClick={() => setSelectedReferrer(null)}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Summary
                  </button>
                  <button
                    onClick={() => loadReferrerDetails(selectedReferrer)}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Refresh
                  </button>
                </div>

                {/* Referrer Summary */}
                <div className="bg-gradient-to-r from-[#e6f7f1] to-[#d9f3ea] p-6 rounded-lg mb-6">
                  <h3 className="text-xl font-bold text-gray-900 mb-4">Referrer Details</h3>
                  <div className="grid grid-cols-3 xl:grid-cols-4 gap-4">
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Name</p>
                      <p className="text-lg font-semibold text-gray-900">{selectedReferrer.referrer_name}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Referral Code</p>
                      <p className="text-lg font-semibold text-gray-900 font-mono">{selectedReferrer.referral_code}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Total Referrals</p>
                      <p className="text-lg font-semibold text-gray-900">{selectedReferrer.total_referrals}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Active / Pending</p>
                      <p className="text-lg font-semibold text-gray-900">
                        <span className="text-blue-600">{selectedReferrer.active_referrals}</span>
                        {' / '}
                        <span className="text-yellow-600">{selectedReferrer.pending_referrals}</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Total Rewards</p>
                      <p className="text-lg font-semibold text-[#309605]">{selectedReferrer.total_rewards} Treats</p>
                    </div>
                  </div>
                </div>

                {/* Referred Users Table */}
                <h4 className="text-lg font-semibold text-gray-900 mb-4">Referred Users</h4>
                <div className="overflow-x-auto scrollbar-hide">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Referred User</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Referral Code</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Reward Earned</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Status</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Active</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Date Referred</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {referrerDetails.map((detail) => (
                        <tr key={detail.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-3 px-4 text-sm text-gray-900">{detail.referred_name}</td>
                          <td className="py-3 px-4 text-sm text-gray-600 font-mono">{detail.referral_code}</td>
                          <td className="py-3 px-4 text-sm font-medium text-[#309605]">
                            {detail.reward_amount} Treats
                          </td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              detail.status === 'rewarded'
                                ? 'bg-green-100 text-green-700'
                                : detail.status === 'pending'
                                ? 'bg-yellow-100 text-yellow-700'
                                : detail.status === 'revoked'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-blue-100 text-blue-700'
                            }`}>
                              {detail.status.charAt(0).toUpperCase() + detail.status.slice(1)}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            {detail.is_active ? (
                              <CheckCircle className="w-5 h-5 text-green-500" />
                            ) : (
                              <XCircle className="w-5 h-5 text-gray-400" />
                            )}
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-600">
                            {new Date(detail.created_at).toLocaleDateString()}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleToggleFlagAbuse(detail.id, detail.flagged_for_abuse)}
                                className={`p-2 rounded-lg transition-colors ${
                                  detail.flagged_for_abuse
                                    ? 'bg-red-100 text-red-600 hover:bg-red-200'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}
                                title={detail.flagged_for_abuse ? 'Unflag' : 'Flag for abuse'}
                              >
                                <AlertTriangle className="w-4 h-4" />
                              </button>
                              {detail.status !== 'revoked' && (
                                <button
                                  onClick={() => handleRevokeReferral(detail.id)}
                                  className="p-2 bg-orange-100 text-orange-600 rounded-lg hover:bg-orange-200 transition-colors"
                                  title="Revoke referral"
                                >
                                  <XCircle className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                onClick={() => handleSuspendUser(detail.referred_id, detail.referred_name)}
                                className="p-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors"
                                title="Suspend user"
                              >
                                <Ban className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {referrerDetails.length === 0 && (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-gray-500">
                            No referred users found
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};
