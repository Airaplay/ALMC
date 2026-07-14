import { useState, useEffect } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { Card } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { supabase } from '../../lib/supabase';
import { useAlert } from '../../contexts/AlertContext';
import { CustomConfirmModal } from '../../components/CustomConfirmModal';
import {
  TrendingUp,
  CheckCircle,
  Clock,
  DollarSign,
  Eye,
  ThumbsUp,
  ThumbsDown,
  Settings as SettingsIcon,
  BarChart3,
  Tag,
  AlertCircle,
  Trash2,
  Pause,
  Play,
  ArrowUp,
  ArrowDown,
  Zap,
  TrendingUpIcon
} from 'lucide-react';

interface PromotionStats {
  totalPromotions: number;
  activePromotions: number;
  pendingApprovals: number;
  totalTreatsEarned: number;
}

interface SectionAnalytics {
  section_name: string;
  section_key: string;
  total_promotions: number;
  active_promotions: number;
  total_treats_earned: number;
  total_impressions: number;
  total_clicks: number;
  unique_viewers: number;
  engagement_rate: number;
  average_ctr: number;
}

interface Promotion {
  id: string;
  user_id: string;
  promotion_type: string;
  target_title: string;
  treats_cost: number;
  duration_hours: number;
  start_date: string;
  end_date: string;
  status: string;
  created_at: string;
  promotion_section_id: string | null;
  boost_priority?: number;
  users?: {
    display_name: string;
    username: string;
  };
  promotion_sections?: {
    section_name: string;
  };
}

interface PromotionAnalytics {
  totalImpressions: number;
  totalClicks: number;
  engagementRate: number;
  uniqueViewers: number;
  averageCTR: number;
  treatsCost: number;
  artistName: string;
  contentTitle: string;
  contentType: string;
  section: string;
}

interface PromotionSection {
  id: string;
  section_name: string;
  section_key: string;
  description: string;
  is_active: boolean;
}

interface PromotionPricing {
  id: string;
  section_id: string;
  content_type: string;
  treats_cost: number;
  duration_hours: number;
  is_active: boolean;
  promotion_sections?: {
    section_name: string;
  };
}

interface GlobalSettings {
  id: string;
  auto_approval_enabled: boolean;
  default_duration_hours: number;
  refund_on_rejection: boolean;
  promotions_enabled: boolean;
  min_treats_balance: number;
  max_active_promotions_per_user: number;
}

export function PromotionManagerSection() {
  const { showAlert } = useAlert();
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<PromotionStats>({
    totalPromotions: 0,
    activePromotions: 0,
    pendingApprovals: 0,
    totalTreatsEarned: 0,
  });
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [filteredPromotions, setFilteredPromotions] = useState<Promotion[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sections, setSections] = useState<PromotionSection[]>([]);
  const [pricing, setPricing] = useState<PromotionPricing[]>([]);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedPromotions, setSelectedPromotions] = useState<Set<string>>(new Set());
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [analyticsModalOpen, setAnalyticsModalOpen] = useState(false);
  const [selectedAnalyticsPromotion, setSelectedAnalyticsPromotion] = useState<string | null>(null);
  const [promotionAnalytics, setPromotionAnalytics] = useState<PromotionAnalytics | null>(null);
  const [sectionAnalytics, setSectionAnalytics] = useState<SectionAnalytics[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [confirmDeleteSingle, setConfirmDeleteSingle] = useState<string | null>(null);
  const [confirmDeleteBulk, setConfirmDeleteBulk] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    filterPromotions();
  }, [statusFilter, promotions]);

  const loadData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadStats(),
        loadPromotions(),
        loadSections(),
        loadPricing(),
        loadGlobalSettings(),
        loadSectionAnalytics(),
      ]);
    } catch (error) {
      console.error('Error loading promotion data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    const { data: promotionsData } = await supabase
      .from('promotions')
      .select('status, treats_cost')
      .neq('status', 'deleted');

    if (promotionsData) {
      const totalPromotions = promotionsData.length;
      const activePromotions = promotionsData.filter(p => p.status === 'active').length;
      const pendingApprovals = promotionsData.filter(p => p.status === 'pending_approval').length;
      const totalTreatsEarned = promotionsData.reduce((sum, p) => sum + Number(p.treats_cost), 0);

      setStats({
        totalPromotions,
        activePromotions,
        pendingApprovals,
        totalTreatsEarned,
      });
    }
  };

  const loadPromotions = async () => {
    const { data } = await supabase
      .from('promotions')
      .select(`
        *,
        users:user_id (display_name, username),
        promotion_sections:promotion_section_id (section_name)
      `)
      .neq('status', 'deleted')
      .order('created_at', { ascending: false });

    if (data) {
      setPromotions(data as Promotion[]);
    }
  };

  const loadSections = async () => {
    const { data } = await supabase
      .from('promotion_sections')
      .select('*')
      .order('sort_order');

    if (data) {
      setSections(data);
    }
  };

  const loadPricing = async () => {
    const { data } = await supabase
      .from('promotion_section_pricing')
      .select(`
        *,
        promotion_sections:section_id (section_name)
      `);

    if (data) {
      setPricing(data as PromotionPricing[]);
    }
  };

  const loadGlobalSettings = async () => {
    const { data } = await supabase
      .from('promotion_global_settings')
      .select('*')
      .single();

    if (data) {
      setGlobalSettings(data);
    }
  };

  const loadSectionAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      const { data: sectionsData } = await supabase
        .from('promotion_sections')
        .select('id, section_name, section_key')
        .order('sort_order');

      if (!sectionsData) return;

      const analyticsPromises = sectionsData.map(async (section) => {
        const { data: promotionsData } = await supabase
          .from('promotions')
          .select('id, status, treats_cost, promotion_section_id')
          .eq('promotion_section_id', section.id)
          .neq('status', 'deleted');

        const totalPromotions = promotionsData?.length || 0;
        const activePromotions = promotionsData?.filter(p => p.status === 'active').length || 0;
        const totalTreatsEarned = promotionsData?.reduce((sum, p) => sum + Number(p.treats_cost), 0) || 0;

        const promotionIds = promotionsData?.map(p => p.id) || [];

        let totalImpressions = 0;
        let totalClicks = 0;
        let uniqueViewers = 0;

        if (promotionIds.length > 0) {
          const { data: metricsData } = await supabase
            .from('promotion_performance_metrics')
            .select('impressions, clicks, unique_viewers')
            .in('promotion_id', promotionIds);

          if (metricsData) {
            totalImpressions = metricsData.reduce((sum, m) => sum + (m.impressions || 0), 0);
            totalClicks = metricsData.reduce((sum, m) => sum + (m.clicks || 0), 0);
            uniqueViewers = metricsData.reduce((sum, m) => sum + (m.unique_viewers || 0), 0);
          }
        }

        const averageCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
        const engagementRate = totalImpressions > 0 ? ((totalClicks + uniqueViewers) / totalImpressions) * 100 : 0;

        return {
          section_name: section.section_name,
          section_key: section.section_key,
          total_promotions: totalPromotions,
          active_promotions: activePromotions,
          total_treats_earned: totalTreatsEarned,
          total_impressions: totalImpressions,
          total_clicks: totalClicks,
          unique_viewers: uniqueViewers,
          engagement_rate: engagementRate,
          average_ctr: averageCtr,
        };
      });

      const analytics = await Promise.all(analyticsPromises);
      setSectionAnalytics(analytics.sort((a, b) => b.total_treats_earned - a.total_treats_earned));
    } catch (error) {
      console.error('Error loading section analytics:', error);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const filterPromotions = () => {
    if (statusFilter === 'all') {
      setFilteredPromotions(promotions);
    } else {
      setFilteredPromotions(promotions.filter(p => p.status === statusFilter));
    }
  };

  const handleApprovePromotion = async (promotionId: string) => {
    setActionLoading(promotionId);
    try {
      const { error } = await supabase
        .from('promotions')
        .update({ status: 'active', start_date: new Date().toISOString() })
        .eq('id', promotionId);

      if (error) throw error;

      await loadData();
      showAlert({
        title: 'Promotion Approved',
        message: 'The promotion has been approved and is now active.',
        type: 'success'
      });
    } catch (error) {
      console.error('Error approving promotion:', error);
      showAlert({
        title: 'Approval Failed',
        message: 'Failed to approve promotion. Please try again.',
        type: 'error'
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRejectPromotion = async (promotionId: string) => {
    setActionLoading(promotionId);
    try {
      const promotion = promotions.find(p => p.id === promotionId);
      if (!promotion) return;

      const { error } = await supabase
        .from('promotions')
        .update({ status: 'rejected' })
        .eq('id', promotionId);

      if (error) throw error;

      if (globalSettings?.refund_on_rejection) {
        const { error: walletError } = await supabase.rpc('add_treat_balance', {
          p_user_id: promotion.user_id,
          p_amount: promotion.treats_cost,
          p_transaction_type: 'promotion_refund',
          p_description: `Refund for rejected promotion: ${promotion.target_title}`,
          p_reference_id: promotionId
        });

        if (walletError) throw walletError;
      }

      await loadData();
      showAlert({
        title: 'Promotion Rejected',
        message: globalSettings?.refund_on_rejection
          ? 'The promotion has been rejected and the user has been refunded.'
          : 'The promotion has been rejected.',
        type: 'success'
      });
    } catch (error) {
      console.error('Error rejecting promotion:', error);
      showAlert({
        title: 'Rejection Failed',
        message: 'Failed to reject promotion. Please try again.',
        type: 'error'
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handlePausePromotion = async (promotionId: string) => {
    setActionLoading(promotionId);
    try {
      const { error } = await supabase
        .from('promotions')
        .update({ status: 'paused' })
        .eq('id', promotionId);

      if (error) throw error;

      await loadData();
      showAlert({
        title: 'Promotion Paused',
        message: 'The promotion has been paused successfully.',
        type: 'success'
      });
    } catch (error) {
      console.error('Error pausing promotion:', error);
      showAlert({
        title: 'Pause Failed',
        message: 'Failed to pause promotion. Please try again.',
        type: 'error'
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleResumePromotion = async (promotionId: string) => {
    setActionLoading(promotionId);
    try {
      const { error } = await supabase
        .from('promotions')
        .update({ status: 'active' })
        .eq('id', promotionId);

      if (error) throw error;

      await loadData();
      showAlert({
        title: 'Promotion Resumed',
        message: 'The promotion is now active again.',
        type: 'success'
      });
    } catch (error) {
      console.error('Error resuming promotion:', error);
      showAlert({
        title: 'Resume Failed',
        message: 'Failed to resume promotion. Please try again.',
        type: 'error'
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleBoostPromotion = async (promotionId: string, currentPriority: number = 0) => {
    setActionLoading(promotionId);
    try {
      const newPriority = currentPriority + 10;
      const { error } = await supabase
        .from('promotions')
        .update({ boost_priority: newPriority })
        .eq('id', promotionId);

      if (error) throw error;

      await loadData();
      showAlert({
        title: 'Promotion Boosted',
        message: 'The promotion priority has been increased.',
        type: 'success'
      });
    } catch (error) {
      console.error('Error boosting promotion:', error);
      showAlert({
        title: 'Boost Failed',
        message: 'Failed to boost promotion. Please try again.',
        type: 'error'
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleReorderPromotion = async (promotionId: string, direction: 'up' | 'down') => {
    setActionLoading(promotionId);
    try {
      const currentPromotion = promotions.find(p => p.id === promotionId);
      if (!currentPromotion) return;

      const currentPriority = currentPromotion.boost_priority || 0;
      const newPriority = direction === 'up' ? currentPriority + 1 : currentPriority - 1;

      const { error } = await supabase
        .from('promotions')
        .update({ boost_priority: newPriority })
        .eq('id', promotionId);

      if (error) throw error;

      await loadData();
      showAlert({
        title: 'Promotion Reordered',
        message: `The promotion has been moved ${direction}.`,
        type: 'success'
      });
    } catch (error) {
      console.error('Error reordering promotion:', error);
      showAlert({
        title: 'Reorder Failed',
        message: 'Failed to reorder promotion. Please try again.',
        type: 'error'
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleViewAnalytics = async (promotionId: string) => {
    setSelectedAnalyticsPromotion(promotionId);
    setAnalyticsModalOpen(true);

    try {
      const { data: metricsData, error } = await supabase
        .from('promotion_performance_metrics')
        .select('*')
        .eq('promotion_id', promotionId);

      if (error) throw error;

      const promotion = promotions.find(p => p.id === promotionId);

      if (metricsData && metricsData.length > 0) {
        const totalImpressions = metricsData.reduce((sum, m) => sum + (m.impressions || 0), 0);
        const totalClicks = metricsData.reduce((sum, m) => sum + (m.clicks || 0), 0);
        const uniqueViewers = metricsData.reduce((sum, m) => sum + (m.unique_viewers || 0), 0);
        const averageCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
        const engagementRate = totalImpressions > 0 ? ((totalClicks + uniqueViewers) / totalImpressions) * 100 : 0;

        setPromotionAnalytics({
          totalImpressions,
          totalClicks,
          engagementRate,
          uniqueViewers,
          averageCTR,
          treatsCost: promotion?.treats_cost || 0,
          artistName: promotion?.users?.display_name || promotion?.users?.username || 'Unknown',
          contentTitle: promotion?.target_title || 'N/A',
          contentType: promotion?.promotion_type || 'N/A',
          section: promotion?.promotion_sections?.section_name || 'N/A',
        });
      } else {
        setPromotionAnalytics({
          totalImpressions: 0,
          totalClicks: 0,
          engagementRate: 0,
          uniqueViewers: 0,
          averageCTR: 0,
          treatsCost: promotion?.treats_cost || 0,
          artistName: promotion?.users?.display_name || promotion?.users?.username || 'Unknown',
          contentTitle: promotion?.target_title || 'N/A',
          contentType: promotion?.promotion_type || 'N/A',
          section: promotion?.promotion_sections?.section_name || 'N/A',
        });
      }
    } catch (error) {
      console.error('Error loading analytics:', error);
      showAlert({
        title: 'Analytics Load Failed',
        message: 'Failed to load analytics. Please try again.',
        type: 'error'
      });
    }
  };

  const handleDeletePromotion = (promotionId: string) => {
    setConfirmDeleteSingle(promotionId);
  };

  const confirmDeletePromotion = async () => {
    if (!confirmDeleteSingle) return;

    const promotionId = confirmDeleteSingle;
    setConfirmDeleteSingle(null);
    setActionLoading(promotionId);

    try {
      const { error } = await supabase
        .from('promotions')
        .update({ status: 'deleted' })
        .eq('id', promotionId);

      if (error) throw error;

      setSelectedPromotions(prev => {
        const newSet = new Set(prev);
        newSet.delete(promotionId);
        return newSet;
      });

      await loadData();
      showAlert({
        title: 'Promotion Deleted',
        message: 'The promotion has been successfully deleted.',
        type: 'success'
      });
    } catch (error) {
      console.error('Error deleting promotion:', error);
      showAlert({
        title: 'Deletion Failed',
        message: 'Failed to delete promotion. Please try again.',
        type: 'error'
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleBulkDelete = () => {
    if (selectedPromotions.size === 0) return;
    setConfirmDeleteBulk(true);
  };

  const confirmBulkDelete = async () => {
    setConfirmDeleteBulk(false);
    setDeleteLoading(true);

    const count = selectedPromotions.size;

    try {
      const { error } = await supabase
        .from('promotions')
        .update({ status: 'deleted' })
        .in('id', Array.from(selectedPromotions));

      if (error) throw error;

      setSelectedPromotions(new Set());
      await loadData();
      showAlert({
        title: 'Promotions Deleted',
        message: `Successfully deleted ${count} promotion${count > 1 ? 's' : ''}.`,
        type: 'success'
      });
    } catch (error) {
      console.error('Error deleting promotions:', error);
      showAlert({
        title: 'Deletion Failed',
        message: 'Failed to delete promotions. Please try again.',
        type: 'error'
      });
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleSelectAll = () => {
    if (selectedPromotions.size === filteredPromotions.length) {
      setSelectedPromotions(new Set());
    } else {
      setSelectedPromotions(new Set(filteredPromotions.map(p => p.id)));
    }
  };

  const handleSelectPromotion = (promotionId: string) => {
    setSelectedPromotions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(promotionId)) {
        newSet.delete(promotionId);
      } else {
        newSet.add(promotionId);
      }
      return newSet;
    });
  };

  const handleUpdatePricing = async (pricingId: string, newCost: number) => {
    try {
      const { error } = await supabase
        .from('promotion_section_pricing')
        .update({ treats_cost: newCost })
        .eq('id', pricingId);

      if (error) throw error;

      await loadPricing();
      showAlert({
        title: 'Pricing Updated',
        message: 'The promotion pricing has been updated successfully.',
        type: 'success'
      });
    } catch (error) {
      console.error('Error updating pricing:', error);
      showAlert({
        title: 'Update Failed',
        message: 'Failed to update pricing. Please try again.',
        type: 'error'
      });
    }
  };

  const handleUpdateGlobalSettings = async (updates: Partial<GlobalSettings>) => {
    if (!globalSettings) return;

    try {
      const { error } = await supabase
        .from('promotion_global_settings')
        .update(updates)
        .eq('id', globalSettings.id);

      if (error) throw error;

      await loadGlobalSettings();
      showAlert({
        title: 'Settings Updated',
        message: 'The global settings have been updated successfully.',
        type: 'success'
      });
    } catch (error) {
      console.error('Error updating global settings:', error);
      showAlert({
        title: 'Update Failed',
        message: 'Failed to update settings. Please try again.',
        type: 'error'
      });
    }
  };

  const getMostPromotedSection = () => {
    const sectionCounts: { [key: string]: number } = {};
    promotions.forEach(p => {
      if (p.promotion_sections?.section_name) {
        sectionCounts[p.promotion_sections.section_name] =
          (sectionCounts[p.promotion_sections.section_name] || 0) + 1;
      }
    });

    const entries = Object.entries(sectionCounts);
    if (entries.length === 0) return 'N/A';

    const [sectionName, count] = entries.reduce((max, entry) =>
      entry[1] > max[1] ? entry : max
    );

    return `${sectionName} (${count})`;
  };

  const getTopPromoter = () => {
    const userCounts: { [key: string]: { name: string; count: number } } = {};
    promotions.forEach(p => {
      const userId = p.user_id;
      const userName = p.users?.display_name || p.users?.username || 'Unknown';
      if (!userCounts[userId]) {
        userCounts[userId] = { name: userName, count: 0 };
      }
      userCounts[userId].count++;
    });

    const entries = Object.values(userCounts);
    if (entries.length === 0) return 'N/A';

    const topUser = entries.reduce((max, entry) =>
      entry.count > max.count ? entry : max
    );

    return `${topUser.name} (${topUser.count})`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
          <Zap className="w-4 h-4 text-green-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900 leading-tight">Promotion Manager</h2>
          <p className="text-sm text-gray-400 mt-0.5">Review promotions, configure pricing, and monitor performance</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-gray-50 border border-gray-100 p-1 rounded-xl gap-0.5">
          <TabsTrigger value="overview" className="px-3 py-2 text-xs font-medium rounded-lg data-[state=active]:bg-[#309605] data-[state=active]:text-white data-[state=active]:shadow-sm inline-flex items-center gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="requests" className="px-3 py-2 text-xs font-medium rounded-lg data-[state=active]:bg-[#309605] data-[state=active]:text-white data-[state=active]:shadow-sm inline-flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            Requests
          </TabsTrigger>
          <TabsTrigger value="pricing" className="px-3 py-2 text-xs font-medium rounded-lg data-[state=active]:bg-[#309605] data-[state=active]:text-white data-[state=active]:shadow-sm inline-flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5" />
            Pricing
          </TabsTrigger>
          <TabsTrigger value="summary" className="px-3 py-2 text-xs font-medium rounded-lg data-[state=active]:bg-[#309605] data-[state=active]:text-white data-[state=active]:shadow-sm inline-flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" />
            Summary
          </TabsTrigger>
          <TabsTrigger value="settings" className="px-3 py-2 text-xs font-medium rounded-lg data-[state=active]:bg-[#309605] data-[state=active]:text-white data-[state=active]:shadow-sm inline-flex items-center gap-1.5">
            <SettingsIcon className="w-3.5 h-3.5" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <OverviewTab
            loading={loading}
            stats={stats}
            sectionAnalytics={sectionAnalytics}
            analyticsLoading={analyticsLoading}
          />
        </TabsContent>

        <TabsContent value="requests" className="space-y-6">
          <RequestsTab
            loading={loading}
            promotions={filteredPromotions}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            onApprove={handleApprovePromotion}
            onReject={handleRejectPromotion}
            onPause={handlePausePromotion}
            onResume={handleResumePromotion}
            onBoost={handleBoostPromotion}
            onReorder={handleReorderPromotion}
            onViewAnalytics={handleViewAnalytics}
            onDelete={handleDeletePromotion}
            onBulkDelete={handleBulkDelete}
            actionLoading={actionLoading}
            deleteLoading={deleteLoading}
            selectedPromotions={selectedPromotions}
            onSelectAll={handleSelectAll}
            onSelectPromotion={handleSelectPromotion}
          />
        </TabsContent>

        <TabsContent value="pricing" className="space-y-6">
          <PricingTab
            loading={loading}
            sections={sections}
            pricing={pricing}
            onUpdatePricing={handleUpdatePricing}
          />
        </TabsContent>

        <TabsContent value="summary" className="space-y-6">
          <SummaryTab
            loading={loading}
            stats={stats}
            mostPromotedSection={getMostPromotedSection()}
            topPromoter={getTopPromoter()}
          />
        </TabsContent>

        <TabsContent value="settings" className="space-y-6">
          <SettingsTab
            loading={loading}
            settings={globalSettings}
            onUpdate={handleUpdateGlobalSettings}
          />
        </TabsContent>
      </Tabs>

      {analyticsModalOpen && selectedAnalyticsPromotion && (
        <AnalyticsModal
          promotionId={selectedAnalyticsPromotion}
          analytics={promotionAnalytics}
          onClose={() => {
            setAnalyticsModalOpen(false);
            setSelectedAnalyticsPromotion(null);
            setPromotionAnalytics(null);
          }}
        />
      )}

      {/* Delete Single Promotion Confirmation */}
      <CustomConfirmModal
        isOpen={confirmDeleteSingle !== null}
        title="Delete Promotion"
        message="Are you sure you want to delete this promotion? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        onConfirm={confirmDeletePromotion}
        onCancel={() => setConfirmDeleteSingle(null)}
      />

      {/* Bulk Delete Confirmation */}
      <CustomConfirmModal
        isOpen={confirmDeleteBulk}
        title="Delete Multiple Promotions"
        message={`Are you sure you want to delete ${selectedPromotions.size} promotion(s)? This action cannot be undone.`}
        confirmText="Delete All"
        cancelText="Cancel"
        variant="danger"
        onConfirm={confirmBulkDelete}
        onCancel={() => setConfirmDeleteBulk(false)}
      />
    </div>
  );
}

function OverviewTab({
  loading,
  stats,
  sectionAnalytics,
  analyticsLoading
}: {
  loading: boolean;
  stats: PromotionStats;
  sectionAnalytics: SectionAnalytics[];
  analyticsLoading: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-6">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="p-6 bg-white border border-gray-300">
              <Skeleton className="h-20 bg-gray-200" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-6">
      <Card className="p-6 bg-white border border-gray-300 shadow">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">Total Promotions</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">{stats.totalPromotions}</p>
          </div>
          <div className="p-3 bg-blue-100 rounded-lg">
            <TrendingUp className="w-6 h-6 text-blue-600" />
          </div>
        </div>
      </Card>

      <Card className="p-6 bg-white border border-gray-300 shadow">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">Active Promotions</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">{stats.activePromotions}</p>
          </div>
          <div className="p-3 bg-green-100 rounded-lg">
            <CheckCircle className="w-6 h-6 text-green-600" />
          </div>
        </div>
      </Card>

      <Card className="p-6 bg-white border border-gray-300 shadow">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">Pending Approvals</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">{stats.pendingApprovals}</p>
          </div>
          <div className="p-3 bg-yellow-100 rounded-lg">
            <Clock className="w-6 h-6 text-yellow-600" />
          </div>
        </div>
      </Card>

      <Card className="p-6 bg-white border border-gray-300 shadow">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">Treats Earned</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">{stats.totalTreatsEarned.toLocaleString()}</p>
          </div>
          <div className="p-3 bg-[#309605]/10 rounded-lg">
            <DollarSign className="w-6 h-6 text-[#309605]" />
          </div>
        </div>
      </Card>
      </div>

      <Card className="p-6 bg-white border border-gray-300 shadow">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-xl font-bold text-gray-900">Section Analytics</h3>
            <p className="text-sm text-gray-600 mt-1">Performance metrics by promotion section</p>
          </div>
          <div className="p-3 bg-blue-100 rounded-lg">
            <BarChart3 className="w-6 h-6 text-blue-600" />
          </div>
        </div>

        {analyticsLoading ? (
          <Skeleton className="h-96 bg-gray-200" />
        ) : sectionAnalytics.length === 0 ? (
          <div className="text-center py-12 text-gray-700">
            <BarChart3 className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p>No analytics data available yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-hide">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="p-4 text-gray-700 font-medium">Section</th>
                  <th className="p-4 text-gray-700 font-medium">Total Promotions</th>
                  <th className="p-4 text-gray-700 font-medium">Active</th>
                  <th className="p-4 text-gray-700 font-medium">Treats Earned</th>
                  <th className="p-4 text-gray-700 font-medium">Impressions</th>
                  <th className="p-4 text-gray-700 font-medium">Clicks</th>
                  <th className="p-4 text-gray-700 font-medium">Unique Viewers</th>
                  <th className="p-4 text-gray-700 font-medium">Engagement Rate</th>
                  <th className="p-4 text-gray-700 font-medium">Avg CTR</th>
                </tr>
              </thead>
              <tbody>
                {sectionAnalytics.map((section, index) => (
                  <tr
                    key={section.section_key}
                    className="border-b border-gray-200 hover:bg-gray-50 transition-colors"
                  >
                    <td className="p-4">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{section.section_name}</p>
                        <p className="text-xs text-gray-600">{section.section_key}</p>
                      </div>
                    </td>
                    <td className="p-4 text-sm text-gray-900">
                      {section.total_promotions}
                    </td>
                    <td className="p-4 text-sm">
                      <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                        {section.active_promotions}
                      </span>
                    </td>
                    <td className="p-4 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-[#309605] font-bold">
                          {section.total_treats_earned.toLocaleString()}
                        </span>
                        {index === 0 && (
                          <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs font-medium">
                            Top
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-sm text-gray-900">
                      {section.total_impressions.toLocaleString()}
                    </td>
                    <td className="p-4 text-sm text-gray-900">
                      {section.total_clicks.toLocaleString()}
                    </td>
                    <td className="p-4 text-sm text-gray-900">
                      {section.unique_viewers.toLocaleString()}
                    </td>
                    <td className="p-4 text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500"
                            style={{ width: `${Math.min(section.engagement_rate, 100)}%` }}
                          />
                        </div>
                        <span className="text-gray-900 font-medium">
                          {section.engagement_rate.toFixed(2)}%
                        </span>
                      </div>
                    </td>
                    <td className="p-4 text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-green-500"
                            style={{ width: `${Math.min(section.average_ctr, 100)}%` }}
                          />
                        </div>
                        <span className="text-gray-900 font-medium">
                          {section.average_ctr.toFixed(2)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {sectionAnalytics.length > 0 && (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-4">
            <Card className="p-4 bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200">
              <div className="flex items-center gap-3 mb-2">
                <Eye className="w-5 h-5 text-blue-600" />
                <h4 className="text-sm font-semibold text-gray-700">Most Viewed Section</h4>
              </div>
              <p className="text-lg font-bold text-gray-900">
                {sectionAnalytics.reduce((max, s) =>
                  s.total_impressions > max.total_impressions ? s : max
                ).section_name}
              </p>
              <p className="text-xs text-gray-600 mt-1">
                {sectionAnalytics.reduce((max, s) =>
                  s.total_impressions > max.total_impressions ? s : max
                ).total_impressions.toLocaleString()} impressions
              </p>
            </Card>

            <Card className="p-4 bg-gradient-to-br from-green-50 to-green-100 border border-green-200">
              <div className="flex items-center gap-3 mb-2">
                <TrendingUpIcon className="w-5 h-5 text-green-600" />
                <h4 className="text-sm font-semibold text-gray-700">Best Engagement</h4>
              </div>
              <p className="text-lg font-bold text-gray-900">
                {sectionAnalytics.reduce((max, s) =>
                  s.engagement_rate > max.engagement_rate ? s : max
                ).section_name}
              </p>
              <p className="text-xs text-gray-600 mt-1">
                {sectionAnalytics.reduce((max, s) =>
                  s.engagement_rate > max.engagement_rate ? s : max
                ).engagement_rate.toFixed(2)}% engagement rate
              </p>
            </Card>

            <Card className="p-4 bg-gradient-to-br from-yellow-50 to-yellow-100 border border-yellow-200">
              <div className="flex items-center gap-3 mb-2">
                <DollarSign className="w-5 h-5 text-yellow-600" />
                <h4 className="text-sm font-semibold text-gray-700">Top Revenue Section</h4>
              </div>
              <p className="text-lg font-bold text-gray-900">
                {sectionAnalytics[0]?.section_name || 'N/A'}
              </p>
              <p className="text-xs text-gray-600 mt-1">
                {sectionAnalytics[0]?.total_treats_earned.toLocaleString() || '0'} treats earned
              </p>
            </Card>
          </div>
        )}
      </Card>
    </div>
  );
}

interface RequestsTabProps {
  loading: boolean;
  promotions: Promotion[];
  statusFilter: string;
  setStatusFilter: (filter: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onBoost: (id: string, priority: number) => void;
  onReorder: (id: string, direction: 'up' | 'down') => void;
  onViewAnalytics: (id: string) => void;
  onDelete: (id: string) => void;
  onBulkDelete: () => void;
  actionLoading: string | null;
  deleteLoading: boolean;
  selectedPromotions: Set<string>;
  onSelectAll: () => void;
  onSelectPromotion: (id: string) => void;
}

function RequestsTab({
  loading,
  promotions,
  statusFilter,
  setStatusFilter,
  onApprove,
  onReject,
  onPause,
  onResume,
  onBoost,
  onReorder,
  onViewAnalytics,
  onDelete,
  onBulkDelete,
  actionLoading,
  deleteLoading,
  selectedPromotions,
  onSelectAll,
  onSelectPromotion,
}: RequestsTabProps) {
  if (loading) {
    return (
      <Card className="p-6 bg-white border border-gray-300">
        <Skeleton className="h-96 bg-gray-200" />
      </Card>
    );
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getStatusBadge = (status: string) => {
    const styles: { [key: string]: string } = {
      pending_approval: 'bg-yellow-100 text-yellow-700 border-yellow-200',
      pending: 'bg-blue-100 text-blue-700 border-blue-200',
      active: 'bg-green-100 text-green-700 border-green-200',
      paused: 'bg-orange-100 text-orange-700 border-orange-200',
      completed: 'bg-gray-100 text-gray-700 border-gray-200',
      cancelled: 'bg-red-100 text-red-700 border-red-200',
      rejected: 'bg-red-100 text-red-700 border-red-200',
    };

    return (
      <span className={`px-2 py-1 text-xs rounded-full border ${styles[status] || ''}`}>
        {status.replace('_', ' ').toUpperCase()}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-4">
        <div className="flex gap-2 flex-wrap">
          {['all', 'pending_approval', 'active', 'paused', 'completed', 'rejected'].map(filter => (
            <button
              key={filter}
              onClick={() => setStatusFilter(filter)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === filter
                  ? 'bg-[#309605] text-white'
                  : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'
              }`}
            >
              {filter === 'all' ? 'All' : filter.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </button>
          ))}
        </div>
        {selectedPromotions.size > 0 && (
          <button
            onClick={onBulkDelete}
            disabled={deleteLoading}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Delete Selected ({selectedPromotions.size})
          </button>
        )}
      </div>

      <Card className="bg-white border border-gray-300 shadow">
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="p-4 text-gray-700 font-medium">
                  <input
                    type="checkbox"
                    checked={promotions.length > 0 && selectedPromotions.size === promotions.length}
                    onChange={onSelectAll}
                    className="w-4 h-4 cursor-pointer accent-[#309605]"
                  />
                </th>
                <th className="p-4 text-gray-700 font-medium">Artist/User</th>
                <th className="p-4 text-gray-700 font-medium">Content Title</th>
                <th className="p-4 text-gray-700 font-medium">Type</th>
                <th className="p-4 text-gray-700 font-medium">Section</th>
                <th className="p-4 text-gray-700 font-medium">Duration</th>
                <th className="p-4 text-gray-700 font-medium">Cost</th>
                <th className="p-4 text-gray-700 font-medium">Priority</th>
                <th className="p-4 text-gray-700 font-medium">Status</th>
                <th className="p-4 text-gray-700 font-medium">Date</th>
                <th className="p-4 text-gray-700 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {promotions.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-6 text-center text-gray-700">
                    No promotions found
                  </td>
                </tr>
              ) : (
                promotions.map(promotion => (
                  <tr key={promotion.id} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                    <td className="p-4 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedPromotions.has(promotion.id)}
                        onChange={() => onSelectPromotion(promotion.id)}
                        className="w-4 h-4 cursor-pointer accent-[#309605]"
                      />
                    </td>
                    <td className="p-4 text-sm text-gray-900">
                      {promotion.users?.display_name || promotion.users?.username || 'Unknown'}
                    </td>
                    <td className="p-4 text-sm text-gray-900 max-w-xs truncate">
                      {promotion.target_title}
                    </td>
                    <td className="p-4 text-sm text-gray-700 capitalize">
                      {promotion.promotion_type.replace('_', ' ')}
                    </td>
                    <td className="p-4 text-sm text-gray-700">
                      {promotion.promotion_sections?.section_name || 'N/A'}
                    </td>
                    <td className="p-4 text-sm text-gray-700">
                      {promotion.duration_hours}h
                    </td>
                    <td className="p-4 text-sm text-[#309605] font-medium">
                      {promotion.treats_cost.toLocaleString()} T
                    </td>
                    <td className="p-4 text-sm text-gray-700 font-medium">
                      {promotion.boost_priority || 0}
                    </td>
                    <td className="p-4 text-sm">
                      {getStatusBadge(promotion.status)}
                    </td>
                    <td className="p-4 text-sm text-gray-700">
                      {formatDate(promotion.created_at)}
                    </td>
                    <td className="p-4 text-sm">
                      <div className="flex gap-1 flex-wrap">
                        {promotion.status === 'pending_approval' && (
                          <>
                            <button
                              onClick={() => onApprove(promotion.id)}
                              disabled={actionLoading === promotion.id}
                              className="p-2 bg-green-100 hover:bg-green-200 rounded-lg text-green-700 transition-colors disabled:opacity-50"
                              title="Approve"
                            >
                              <ThumbsUp className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => onReject(promotion.id)}
                              disabled={actionLoading === promotion.id}
                              className="p-2 bg-red-100 hover:bg-red-200 rounded-lg text-red-700 transition-colors disabled:opacity-50"
                              title="Reject"
                            >
                              <ThumbsDown className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {promotion.status === 'active' && (
                          <button
                            onClick={() => onPause(promotion.id)}
                            disabled={actionLoading === promotion.id}
                            className="p-2 bg-orange-100 hover:bg-orange-200 rounded-lg text-orange-700 transition-colors disabled:opacity-50"
                            title="Pause"
                          >
                            <Pause className="w-4 h-4" />
                          </button>
                        )}
                        {promotion.status === 'paused' && (
                          <button
                            onClick={() => onResume(promotion.id)}
                            disabled={actionLoading === promotion.id}
                            className="p-2 bg-green-100 hover:bg-green-200 rounded-lg text-green-700 transition-colors disabled:opacity-50"
                            title="Resume"
                          >
                            <Play className="w-4 h-4" />
                          </button>
                        )}
                        {(promotion.status === 'active' || promotion.status === 'paused') && (
                          <>
                            <button
                              onClick={() => onReorder(promotion.id, 'up')}
                              disabled={actionLoading === promotion.id}
                              className="p-2 bg-blue-100 hover:bg-blue-200 rounded-lg text-blue-700 transition-colors disabled:opacity-50"
                              title="Move Up"
                            >
                              <ArrowUp className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => onReorder(promotion.id, 'down')}
                              disabled={actionLoading === promotion.id}
                              className="p-2 bg-blue-100 hover:bg-blue-200 rounded-lg text-blue-700 transition-colors disabled:opacity-50"
                              title="Move Down"
                            >
                              <ArrowDown className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => onBoost(promotion.id, promotion.boost_priority || 0)}
                              disabled={actionLoading === promotion.id}
                              className="p-2 bg-yellow-100 hover:bg-yellow-200 rounded-lg text-yellow-700 transition-colors disabled:opacity-50"
                              title="Boost Priority"
                            >
                              <Zap className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => onViewAnalytics(promotion.id)}
                          disabled={actionLoading === promotion.id}
                          className="p-2 bg-green-100 hover:bg-green-200 rounded-lg text-green-700 transition-colors disabled:opacity-50"
                          title="View Analytics"
                        >
                          <BarChart3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onDelete(promotion.id)}
                          disabled={actionLoading === promotion.id}
                          className="p-2 bg-red-100 hover:bg-red-200 rounded-lg text-red-700 transition-colors disabled:opacity-50"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

interface PricingTabProps {
  loading: boolean;
  sections: PromotionSection[];
  pricing: PromotionPricing[];
  onUpdatePricing: (pricingId: string, newCost: number) => void;
}

function PricingTab({ loading, pricing, onUpdatePricing }: PricingTabProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<number>(0);

  if (loading) {
    return (
      <Card className="p-6 bg-white border border-gray-300">
        <Skeleton className="h-96 bg-gray-200" />
      </Card>
    );
  }

  const handleEdit = (id: string, currentCost: number) => {
    setEditingId(id);
    setEditValue(currentCost);
  };

  const handleSave = (id: string) => {
    onUpdatePricing(id, editValue);
    setEditingId(null);
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditValue(0);
  };

  const contentTypeColors: { [key: string]: string } = {
    song: 'bg-blue-100 text-blue-700 border-blue-200',
    video: 'bg-green-100 text-green-700 border-green-200',
    short_clip: 'bg-pink-100 text-pink-700 border-pink-200',
    profile: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    album: 'bg-green-100 text-green-700 border-green-200',
  };

  return (
    <div className="space-y-4">
      <Card className="bg-white border border-gray-300 shadow">
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="p-4 text-gray-700 font-medium">Section</th>
                <th className="p-4 text-gray-700 font-medium">Content Type</th>
                <th className="p-4 text-gray-700 font-medium">Duration</th>
                <th className="p-4 text-gray-700 font-medium">Cost (Treats)</th>
                <th className="p-4 text-gray-700 font-medium">Status</th>
                <th className="p-4 text-gray-700 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pricing.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-gray-700">
                    No pricing configured
                  </td>
                </tr>
              ) : (
                pricing.map(item => (
                  <tr key={item.id} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                    <td className="p-4 text-sm text-gray-900">
                      {item.promotion_sections?.section_name || 'N/A'}
                    </td>
                    <td className="p-4 text-sm">
                      <span className={`px-2 py-1 text-xs rounded-full border capitalize ${contentTypeColors[item.content_type]}`}>
                        {item.content_type.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-gray-700">
                      {item.duration_hours}h
                    </td>
                    <td className="p-4 text-sm">
                      {editingId === item.id ? (
                        <input
                          type="number"
                          value={editValue}
                          onChange={(e) => setEditValue(Number(e.target.value))}
                          className="w-24 px-3 py-1 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                          min="0"
                        />
                      ) : (
                        <span className="text-[#309605] font-medium">
                          {item.treats_cost.toLocaleString()} T
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-sm">
                      <span className={`px-2 py-1 text-xs rounded-full border ${
                        item.is_active
                          ? 'bg-green-100 text-green-700 border-green-200'
                          : 'bg-gray-100 text-gray-700 border-gray-200'
                      }`}>
                        {item.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="p-4 text-sm">
                      {editingId === item.id ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSave(item.id)}
                            className="px-3 py-1 bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg transition-colors text-xs"
                          >
                            Save
                          </button>
                          <button
                            onClick={handleCancel}
                            className="px-3 py-1 bg-white hover:bg-gray-100 border border-gray-300 text-gray-700 rounded-lg transition-colors text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleEdit(item.id, item.treats_cost)}
                          className="px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg transition-colors text-xs"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

interface SummaryTabProps {
  loading: boolean;
  stats: PromotionStats;
  mostPromotedSection: string;
  topPromoter: string;
}

function SummaryTab({ loading, stats, mostPromotedSection, topPromoter }: SummaryTabProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-3 xl:grid-cols-4 gap-6">
        {[...Array(3)].map((_, i) => (
          <Card key={i} className="p-6 bg-white border border-gray-300">
            <Skeleton className="h-32 bg-gray-200" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 xl:grid-cols-4 gap-6">
      <Card className="p-6 bg-white border border-gray-300 shadow">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-[#309605]/10 rounded-lg">
            <DollarSign className="w-6 h-6 text-[#309605]" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">Total Treats Earned</h3>
        </div>
        <p className="text-3xl font-bold text-gray-900">{stats.totalTreatsEarned.toLocaleString()}</p>
        <p className="text-sm text-gray-600 mt-2">From all promotions</p>
      </Card>

      <Card className="p-6 bg-white border border-gray-300 shadow">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-blue-100 rounded-lg">
            <Eye className="w-6 h-6 text-blue-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">Most Promoted Section</h3>
        </div>
        <p className="text-2xl font-bold text-gray-900">{mostPromotedSection}</p>
        <p className="text-sm text-gray-600 mt-2">Highest promotion count</p>
      </Card>

      <Card className="p-6 bg-white border border-gray-300 shadow">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-yellow-100 rounded-lg">
            <TrendingUp className="w-6 h-6 text-yellow-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">Top Promoter</h3>
        </div>
        <p className="text-2xl font-bold text-gray-900">{topPromoter}</p>
        <p className="text-sm text-gray-600 mt-2">Most promotions created</p>
      </Card>
    </div>
  );
}

interface SettingsTabProps {
  loading: boolean;
  settings: GlobalSettings | null;
  onUpdate: (updates: Partial<GlobalSettings>) => void;
}

function SettingsTab({ loading, settings, onUpdate }: SettingsTabProps) {
  if (loading || !settings) {
    return (
      <Card className="p-6 bg-white border border-gray-300">
        <Skeleton className="h-96 bg-gray-200" />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-6 bg-white border border-gray-300 shadow">
        <h3 className="text-lg font-semibold text-gray-900 mb-6">Global Promotion Settings</h3>

        <div className="space-y-6">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div>
              <h4 className="text-gray-900 font-medium">Auto-Approval</h4>
              <p className="text-sm text-gray-600 mt-1">Automatically approve promotions without manual review</p>
            </div>
            <button
              onClick={() => onUpdate({ auto_approval_enabled: !settings.auto_approval_enabled })}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                settings.auto_approval_enabled ? 'bg-[#309605]' : 'bg-gray-400'
              }`}
            >
              <div
                className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                  settings.auto_approval_enabled ? 'translate-x-6' : ''
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="flex-1">
              <h4 className="text-gray-900 font-medium">Default Duration (Hours)</h4>
              <p className="text-sm text-gray-600 mt-1">Default promotion duration when not specified</p>
            </div>
            <input
              type="number"
              value={settings.default_duration_hours}
              onChange={(e) => onUpdate({ default_duration_hours: Number(e.target.value) })}
              className="w-24 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
              min="1"
            />
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div>
              <h4 className="text-gray-900 font-medium">Refund on Rejection</h4>
              <p className="text-sm text-gray-600 mt-1">Refund treats when promotions are rejected</p>
            </div>
            <button
              onClick={() => onUpdate({ refund_on_rejection: !settings.refund_on_rejection })}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                settings.refund_on_rejection ? 'bg-[#309605]' : 'bg-gray-400'
              }`}
            >
              <div
                className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                  settings.refund_on_rejection ? 'translate-x-6' : ''
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div>
              <h4 className="text-gray-900 font-medium">Promotions System</h4>
              <p className="text-sm text-gray-600 mt-1">Enable or disable the entire promotion system</p>
            </div>
            <button
              onClick={() => onUpdate({ promotions_enabled: !settings.promotions_enabled })}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                settings.promotions_enabled ? 'bg-[#309605]' : 'bg-gray-400'
              }`}
            >
              <div
                className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                  settings.promotions_enabled ? 'translate-x-6' : ''
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="flex-1">
              <h4 className="text-gray-900 font-medium">Minimum Treats Balance</h4>
              <p className="text-sm text-gray-600 mt-1">Minimum treats required to create a promotion</p>
            </div>
            <input
              type="number"
              value={settings.min_treats_balance}
              onChange={(e) => onUpdate({ min_treats_balance: Number(e.target.value) })}
              className="w-24 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
              min="0"
            />
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="flex-1">
              <h4 className="text-gray-900 font-medium">Max Active Promotions per User</h4>
              <p className="text-sm text-gray-600 mt-1">Maximum concurrent promotions allowed per user</p>
            </div>
            <input
              type="number"
              value={settings.max_active_promotions_per_user}
              onChange={(e) => onUpdate({ max_active_promotions_per_user: Number(e.target.value) })}
              className="w-24 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
              min="1"
            />
          </div>
        </div>
      </Card>

      {!settings.promotions_enabled && (
        <Card className="p-4 bg-yellow-100 border border-yellow-200">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0" />
            <p className="text-sm text-yellow-700">
              Promotions system is currently disabled. Users cannot create new promotions.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}

interface AnalyticsModalProps {
  promotionId: string;
  analytics: PromotionAnalytics | null;
  onClose: () => void;
}

function AnalyticsModal({ analytics, onClose }: AnalyticsModalProps) {
  if (!analytics) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <Card className="bg-white p-6 max-w-3xl w-full">
          <div className="flex items-center justify-center p-8">
            <p className="text-gray-700">Loading analytics...</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="bg-white p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-gray-900">Promotion Analytics</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <span className="text-2xl text-gray-700">&times;</span>
          </button>
        </div>

        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 mb-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-600 mb-1">Artist/User</p>
              <p className="text-sm font-medium text-gray-900">{analytics.artistName}</p>
            </div>
            <div>
              <p className="text-xs text-gray-600 mb-1">Content Type</p>
              <p className="text-sm font-medium text-gray-900 capitalize">{analytics.contentType.replace('_', ' ')}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-gray-600 mb-1">Content Title</p>
              <p className="text-sm font-medium text-gray-900">{analytics.contentTitle}</p>
            </div>
            <div>
              <p className="text-xs text-gray-600 mb-1">Section</p>
              <p className="text-sm font-medium text-gray-900">{analytics.section}</p>
            </div>
            <div>
              <p className="text-xs text-gray-600 mb-1">Treats Spent</p>
              <p className="text-sm font-medium text-[#309605]">{analytics.treatsCost.toLocaleString()} T</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <Card className="p-4 bg-blue-50 border border-blue-200">
            <div className="flex items-center gap-3 mb-2">
              <Eye className="w-5 h-5 text-blue-600" />
              <h4 className="text-sm font-medium text-gray-700">Total Impressions</h4>
            </div>
            <p className="text-2xl font-bold text-gray-900">{analytics.totalImpressions.toLocaleString()}</p>
          </Card>

          <Card className="p-4 bg-green-50 border border-green-200">
            <div className="flex items-center gap-3 mb-2">
              <TrendingUpIcon className="w-5 h-5 text-green-600" />
              <h4 className="text-sm font-medium text-gray-700">Total Clicks</h4>
            </div>
            <p className="text-2xl font-bold text-gray-900">{analytics.totalClicks.toLocaleString()}</p>
          </Card>

          <Card className="p-4 bg-green-50 border border-green-200">
            <div className="flex items-center gap-3 mb-2">
              <BarChart3 className="w-5 h-5 text-[#309605]" />
              <h4 className="text-sm font-medium text-gray-700">Engagement Rate</h4>
            </div>
            <p className="text-2xl font-bold text-gray-900">{analytics.engagementRate.toFixed(2)}%</p>
          </Card>

          <Card className="p-4 bg-yellow-50 border border-yellow-200">
            <div className="flex items-center gap-3 mb-2">
              <Eye className="w-5 h-5 text-yellow-600" />
              <h4 className="text-sm font-medium text-gray-700">Unique Viewers</h4>
            </div>
            <p className="text-2xl font-bold text-gray-900">{analytics.uniqueViewers.toLocaleString()}</p>
          </Card>

          <Card className="p-4 bg-orange-50 border border-orange-200">
            <div className="flex items-center gap-3 mb-2">
              <TrendingUp className="w-5 h-5 text-orange-600" />
              <h4 className="text-sm font-medium text-gray-700">Average CTR</h4>
            </div>
            <p className="text-2xl font-bold text-gray-900">{analytics.averageCTR.toFixed(2)}%</p>
          </Card>
        </div>

        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <h4 className="text-sm font-semibold text-gray-900 mb-2">Performance Summary</h4>
          <p className="text-sm text-gray-700">
            This promotion has received <strong>{analytics.totalImpressions.toLocaleString()}</strong> impressions
            and <strong>{analytics.totalClicks.toLocaleString()}</strong> clicks from
            <strong> {analytics.uniqueViewers.toLocaleString()}</strong> unique viewers.
            The engagement rate is <strong>{analytics.engagementRate.toFixed(2)}%</strong> with an average
            click-through rate of <strong>{analytics.averageCTR.toFixed(2)}%</strong>.
          </p>
        </div>

        <div className="flex justify-end mt-6">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </Card>
    </div>
  );
}
