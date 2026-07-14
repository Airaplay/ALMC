import { Users, Music, Video, Zap, Globe } from 'lucide-react';
import { useState, useEffect } from 'react';
import {
  AlertTriangle,
  Plus,
  Trash2,
  Check,
  X,
  RefreshCw,
  BarChart
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { AdRevenueSection } from './AdRevenueSection';
import { AdSafetyCapsSection } from './AdSafetyCapsSection';
import { WebAdsSection } from './WebAdsSection';

interface AdNetworkConfig {
  id: string;
  network: string;
  api_key: string;
  app_id: string;
  is_active: boolean;
  is_mediation_primary?: boolean;
  is_mediation_secondary?: boolean;
  created_at: string;
}

interface AdUnitConfig {
  id: string;
  network_id: string;
  unit_type: string;
  unit_id: string;
  placement: string;
  is_active: boolean;
  created_at: string;
}

interface AdDisplayRule {
  id: string;
  rule_type: string; // 'role', 'content_type', 'country'
  rule_value: string; // role name, content type, or country code
  is_enabled: boolean;
  created_at: string;
}

export const AdManagementSection = (): JSX.Element => {
  // Main tab state
  const [mainTab, setMainTab] = useState<'management' | 'revenue' | 'safety'>('management');

  // State for ad networks
  const [adNetworks, setAdNetworks] = useState<AdNetworkConfig[]>([]);
  const [isLoadingNetworks, setIsLoadingNetworks] = useState(true);
  const [networkError, setNetworkError] = useState<string | null>(null);

  // State for ad units
  const [adUnits, setAdUnits] = useState<AdUnitConfig[]>([]);
  const [isLoadingUnits, setIsLoadingUnits] = useState(true);
  const [unitError, setUnitError] = useState<string | null>(null);
  
  // State for display rules
  const [displayRules, setDisplayRules] = useState<AdDisplayRule[]>([]);
  const [isLoadingRules, setIsLoadingRules] = useState(true);
  const [rulesError, setRulesError] = useState<string | null>(null);
  
  // State for new network form
  const [showNetworkForm, setShowNetworkForm] = useState(false);
  const [newNetwork, setNewNetwork] = useState({
    network: 'admob',
    api_key: '',
    app_id: '',
    is_active: true,
    is_mediation_primary: false,
    is_mediation_secondary: false
  });
  
  // State for new ad unit form
  const [showUnitForm, setShowUnitForm] = useState(false);
  const [newUnit, setNewUnit] = useState({
    network_id: '',
    unit_type: 'banner',
    unit_id: '',
    placement: 'home_screen',
    is_active: true
  });
  
  // State for new rule form
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [newRule, setNewRule] = useState({
    rule_type: 'role',
    rule_value: 'listener',
    is_enabled: true
  });
  
  // State for form submission
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  
  // State for countries list
  const [countries, setCountries] = useState<string[]>([]);
  
  // Tabs state
  const [activeTab, setActiveTab] = useState<'networks' | 'units' | 'rules' | 'mediation' | 'placements' | 'web_ads'>('networks');
  
  // Mediation config state
  const [mediationConfig, setMediationConfig] = useState<any>(null);
  const [isLoadingMediation, setIsLoadingMediation] = useState(true);
  
  // Placements state
  const [placements, setPlacements] = useState<any[]>([]);
  const [isLoadingPlacements, setIsLoadingPlacements] = useState(true);
  const [placementError, setPlacementError] = useState<string | null>(null);
  const [showPlacementForm, setShowPlacementForm] = useState(false);
  const [newPlacement, setNewPlacement] = useState({
    placement_key: '',
    placement_name: '',
    screen_name: '',
    ad_unit_id: '',
    ad_type: 'banner' as 'banner' | 'interstitial' | 'rewarded',
    position: '',
    is_enabled: true,
    display_priority: 0
  });
  
  // Placement keys for dropdown
  const [placementKeys, setPlacementKeys] = useState<Array<{key: string, name: string, screen: string}>>([]);
  const [isLoadingPlacementKeys, setIsLoadingPlacementKeys] = useState(false);
  const [useCustomPlacementKey, setUseCustomPlacementKey] = useState(false);

  const formatRuleValue = (type: string, value: string): string => {
    switch (type) {
      case 'role':
        return value.charAt(0).toUpperCase() + value.slice(1);
      case 'content_type':
        switch (value) {
          case 'song': return 'Music';
          case 'video': return 'Video';
          case 'short_clip': return 'Short Clip';
          default: return value.charAt(0).toUpperCase() + value.slice(1);
        }
      case 'country':
        return value;
      default:
        return value;
    }
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  useEffect(() => {
    fetchAdNetworks();
    fetchAdUnits();
    fetchDisplayRules();
    fetchCountries();
    fetchMediationConfig();
    fetchPlacements();
    fetchPlacementKeys();
  }, []);

  const fetchAdNetworks = async () => {
    try {
      setIsLoadingNetworks(true);
      setNetworkError(null);
      
      const { data, error } = await supabase
        .from('ad_networks')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      setAdNetworks(data || []);
    } catch (err) {
      console.error('Error fetching ad networks:', err);
      setNetworkError('Failed to load ad networks');
    } finally {
      setIsLoadingNetworks(false);
    }
  };

  const fetchAdUnits = async () => {
    try {
      setIsLoadingUnits(true);
      setUnitError(null);
      
      const { data, error } = await supabase
        .from('ad_units')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      setAdUnits(data || []);
    } catch (err) {
      console.error('Error fetching ad units:', err);
      setUnitError('Failed to load ad units');
    } finally {
      setIsLoadingUnits(false);
    }
  };

  const fetchDisplayRules = async () => {
    try {
      setIsLoadingRules(true);
      setRulesError(null);
      
      const { data, error } = await supabase
        .from('ad_display_rules')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      setDisplayRules(data || []);
    } catch (err) {
      console.error('Error fetching display rules:', err);
      setRulesError('Failed to load display rules');
    } finally {
      setIsLoadingRules(false);
    }
  };

  const fetchCountries = async () => {
    try {
      // Get unique countries from users table
      const { data, error } = await supabase
        .from('users')
        .select('country')
        .not('country', 'is', null)
        .order('country');

      if (error) throw error;
      
      // Extract unique countries
      const uniqueCountries = Array.from(new Set(data.map(item => item.country).filter(Boolean)));
      setCountries(uniqueCountries);
    } catch (err) {
      console.error('Error fetching countries:', err);
      // Don't set error state to avoid blocking the UI
    }
  };

  const fetchMediationConfig = async () => {
    try {
      setIsLoadingMediation(true);
      const { data, error } = await supabase
        .from('ad_mediation_config')
        .select(`
          *,
          primary_network:ad_networks!ad_mediation_config_primary_network_id_fkey(*),
          secondary_network:ad_networks!ad_mediation_config_secondary_network_id_fkey(*)
        `)
        .eq('is_active', true)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 is "not found"
      setMediationConfig(data || null);
    } catch (err) {
      console.error('Error fetching mediation config:', err);
    } finally {
      setIsLoadingMediation(false);
    }
  };

  const fetchPlacements = async () => {
    try {
      setIsLoadingPlacements(true);
      const { data, error } = await supabase
        .from('ad_placements')
        .select(`
          *,
          ad_units (
            id,
            unit_id,
            unit_type,
            ad_networks (
              id,
              network,
              app_id
            )
          )
        `)
        .order('screen_name', { ascending: true })
        .order('display_priority', { ascending: false });

      if (error) throw error;
      setPlacements(data || []);
    } catch (err) {
      console.error('Error fetching placements:', err);
    } finally {
      setIsLoadingPlacements(false);
    }
  };

  const fetchPlacementKeys = async () => {
    try {
      setIsLoadingPlacementKeys(true);
      const { data, error } = await supabase
        .from('ad_placements')
        .select('placement_key, placement_name, screen_name')
        .eq('is_enabled', true)
        .order('screen_name', { ascending: true })
        .order('placement_name', { ascending: true });

      if (error) throw error;
      
      // Transform to simple array for dropdown
      const keys = (data || []).map((p: any) => ({
        key: p.placement_key,
        name: p.placement_name,
        screen: p.screen_name
      }));
      setPlacementKeys(keys);
    } catch (err) {
      console.error('Error fetching placement keys:', err);
      // If table doesn't exist yet, use empty array (backward compatible)
      setPlacementKeys([]);
    } finally {
      setIsLoadingPlacementKeys(false);
    }
  };

  const handleNetworkInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setNewNetwork(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleNetworkCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    setNewNetwork(prev => ({
      ...prev,
      [name]: checked,
    }));
  };

  const handleUnitInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setNewUnit(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleUnitCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    setNewUnit(prev => ({
      ...prev,
      [name]: checked,
    }));
  };

  const handleRuleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setNewRule(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleRuleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    setNewRule(prev => ({
      ...prev,
      [name]: checked,
    }));
  };

  const handleSubmitNetwork = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormSuccess(null);
    
    try {
      const networkData: any = {
        network: newNetwork.network,
        api_key: newNetwork.api_key,
        app_id: newNetwork.app_id,
        is_active: newNetwork.is_active
      };

      // Add optional fields if present (only if migration has been applied)
      // Try to detect if migration columns exist by attempting to include them
      // If they cause errors, we'll catch and retry without them
      const optionalNetworkFields: string[] = [];
      
      if ((newNetwork as any).sdk_key && (newNetwork as any).sdk_key.trim()) {
        optionalNetworkFields.push('sdk_key');
        networkData.sdk_key = (newNetwork as any).sdk_key;
      }
      if ((newNetwork as any).ecpm_floor && (newNetwork as any).ecpm_floor !== '') {
        const ecpm = parseFloat((newNetwork as any).ecpm_floor);
        if (!isNaN(ecpm)) {
          optionalNetworkFields.push('ecpm_floor');
          networkData.ecpm_floor = ecpm;
        }
      }
      if ((newNetwork as any).is_mediation_primary !== undefined && (newNetwork as any).is_mediation_primary) {
        optionalNetworkFields.push('is_mediation_primary');
        networkData.is_mediation_primary = true;
      }
      if ((newNetwork as any).is_mediation_secondary !== undefined && (newNetwork as any).is_mediation_secondary) {
        optionalNetworkFields.push('is_mediation_secondary');
        networkData.is_mediation_secondary = true;
      }

      let { data, error } = await supabase
        .from('ad_networks')
        .insert([networkData])
        .select();
      
      // If error is about missing columns, retry without optional fields
      if (error && optionalNetworkFields.length > 0 && 
          (error.message?.includes('column') || error.message?.includes('does not exist'))) {
        console.warn('Optional fields not available, retrying without them:', error.message);
        // Remove optional fields and retry
        const basicNetworkData = {
          network: newNetwork.network,
          api_key: newNetwork.api_key,
          app_id: newNetwork.app_id,
          is_active: newNetwork.is_active
        };
        const retryResult = await supabase
          .from('ad_networks')
          .insert([basicNetworkData])
          .select();
        data = retryResult.data;
        error = retryResult.error;
      }
      
      if (error) throw error;
      
      if (!data || data.length === 0) {
        throw new Error('No data returned from insert');
      }
      
      setFormSuccess('Ad network added successfully');
      setAdNetworks(prev => [data![0], ...prev]);
      setShowNetworkForm(false);
      setNewNetwork({
        network: 'admob',
        api_key: '',
        app_id: '',
        is_active: true,
        is_mediation_primary: false,
        is_mediation_secondary: false
      });
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setFormSuccess(null);
      }, 3000);
    } catch (err: any) {
      console.error('Error adding ad network:', err);
      const errorMessage = err?.message || err?.details || err?.hint || 'Failed to add ad network';
      setNetworkError(`Failed to add ad network: ${errorMessage}`);
      
      // Check if it's a schema error
      if (errorMessage.includes('column') && errorMessage.includes('does not exist')) {
        setNetworkError('Database schema not updated. Please run the migration: npx supabase db push');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormSuccess(null);
    
    try {
      const unitData: any = {
        network_id: newUnit.network_id,
        unit_type: newUnit.unit_type,
        unit_id: newUnit.unit_id,
        placement: newUnit.placement,
        is_active: newUnit.is_active
      };

      // Add optional fields if present (only if migration has been applied)
      const optionalUnitFields: string[] = [];
      
      if ((newUnit as any).ecpm_floor && (newUnit as any).ecpm_floor !== '') {
        const ecpm = parseFloat((newUnit as any).ecpm_floor);
        if (!isNaN(ecpm)) {
          optionalUnitFields.push('ecpm_floor');
          unitData.ecpm_floor = ecpm;
        }
      }
      if ((newUnit as any).auto_cpm_bidding !== undefined && (newUnit as any).auto_cpm_bidding) {
        optionalUnitFields.push('auto_cpm_bidding');
        unitData.auto_cpm_bidding = true;
      }

      let { data, error } = await supabase
        .from('ad_units')
        .insert([unitData])
        .select();
      
      // If error is about missing columns, retry without optional fields
      if (error && optionalUnitFields.length > 0 && 
          (error.message?.includes('column') || error.message?.includes('does not exist'))) {
        console.warn('Optional fields not available, retrying without them:', error.message);
        // Remove optional fields and retry
        const basicUnitData = {
          network_id: newUnit.network_id,
          unit_type: newUnit.unit_type,
          unit_id: newUnit.unit_id,
          placement: newUnit.placement,
          is_active: newUnit.is_active
        };
        const retryResult = await supabase
          .from('ad_units')
          .insert([basicUnitData])
          .select();
        data = retryResult.data;
        error = retryResult.error;
      }
      
      if (error) throw error;
      
      if (!data || data.length === 0) {
        throw new Error('No data returned from insert');
      }
      
      setFormSuccess('Ad unit added successfully');
      setAdUnits(prev => [data![0], ...prev]);
      setShowUnitForm(false);
      setNewUnit({
        network_id: '',
        unit_type: 'banner',
        unit_id: '',
        placement: '',
        is_active: true
      });
      // Refresh placement keys after adding unit (in case it's linked to a placement)
      fetchPlacementKeys();
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setFormSuccess(null);
      }, 3000);
    } catch (err: any) {
      console.error('Error adding ad unit:', err);
      const errorMessage = err?.message || err?.details || err?.hint || 'Failed to add ad unit';
      setUnitError(`Failed to add ad unit: ${errorMessage}`);
      
      // Check if it's a schema error
      if (errorMessage.includes('column') && errorMessage.includes('does not exist')) {
        setUnitError('Database schema not updated. Please run the migration: npx supabase db push');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormSuccess(null);
    
    try {
      const { data, error } = await supabase
        .from('ad_display_rules')
        .insert([
          {
            rule_type: newRule.rule_type,
            rule_value: newRule.rule_value,
            is_enabled: newRule.is_enabled
          }
        ])
        .select();
      
      if (error) throw error;
      
      setFormSuccess('Display rule added successfully');
      setDisplayRules(prev => [data[0], ...prev]);
      setShowRuleForm(false);
      setNewRule({
        rule_type: 'role',
        rule_value: 'listener',
        is_enabled: true
      });
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setFormSuccess(null);
      }, 3000);
    } catch (err) {
      console.error('Error adding display rule:', err);
      setRulesError('Failed to add display rule');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleNetworkStatus = async (id: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('ad_networks')
        .update({ is_active: !currentStatus })
        .eq('id', id);
      
      if (error) throw error;
      
      // Update local state
      setAdNetworks(prev => 
        prev.map(network => 
          network.id === id ? { ...network, is_active: !currentStatus } : network
        )
      );
    } catch (err) {
      console.error('Error toggling network status:', err);
      setNetworkError('Failed to update network status');
    }
  };

  const toggleUnitStatus = async (id: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('ad_units')
        .update({ is_active: !currentStatus })
        .eq('id', id);
      
      if (error) throw error;
      
      // Update local state
      setAdUnits(prev => 
        prev.map(unit => 
          unit.id === id ? { ...unit, is_active: !currentStatus } : unit
        )
      );
    } catch (err) {
      console.error('Error toggling unit status:', err);
      setUnitError('Failed to update unit status');
    }
  };

  const toggleRuleStatus = async (id: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('ad_display_rules')
        .update({ is_enabled: !currentStatus })
        .eq('id', id);
      
      if (error) throw error;
      
      // Update local state
      setDisplayRules(prev => 
        prev.map(rule => 
          rule.id === id ? { ...rule, is_enabled: !currentStatus } : rule
        )
      );
    } catch (err) {
      console.error('Error toggling rule status:', err);
      setRulesError('Failed to update rule status');
    }
  };

  const deleteNetwork = async (id: string) => {
    if (!confirm('Are you sure you want to delete this ad network? This will also delete all associated ad units.')) {
      return;
    }
    
    try {
      const { error } = await supabase
        .from('ad_networks')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      
      // Update local state
      setAdNetworks(prev => prev.filter(network => network.id !== id));
      // Also filter out any ad units associated with this network
      setAdUnits(prev => prev.filter(unit => unit.network_id !== id));
    } catch (err) {
      console.error('Error deleting ad network:', err);
      setNetworkError('Failed to delete ad network');
    }
  };

  const deleteUnit = async (id: string) => {
    if (!confirm('Are you sure you want to delete this ad unit?')) {
      return;
    }
    
    try {
      const { error } = await supabase
        .from('ad_units')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      
      // Update local state
      setAdUnits(prev => prev.filter(unit => unit.id !== id));
    } catch (err) {
      console.error('Error deleting ad unit:', err);
      setUnitError('Failed to delete ad unit');
    }
  };

  const deleteRule = async (id: string) => {
    if (!confirm('Are you sure you want to delete this display rule?')) {
      return;
    }
    
    try {
      const { error } = await supabase
        .from('ad_display_rules')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      
      // Update local state
      setDisplayRules(prev => prev.filter(rule => rule.id !== id));
    } catch (err) {
      console.error('Error deleting display rule:', err);
      setRulesError('Failed to delete display rule');
    }
  };

  const getNetworkName = (id: string): string => {
    const network = adNetworks.find(n => n.id === id);
    return network ? network.network : 'Unknown';
  };

  return (
    <div className="space-y-6 min-h-full">
      {/* Header with Main Tabs */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Ad Management & Monetization</h2>
              <p className="text-gray-600 mt-1">
                Manage ad networks, revenue settings, and safety caps
              </p>
            </div>

            {mainTab === 'management' && (
              <div className="flex items-center gap-4">
                <a
                  href="/admin"
                  className="flex items-center gap-2 px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg transition-colors duration-200"
                >
                  <BarChart className="w-4 h-4" />
                  <span>Dashboard Analytics</span>
                </a>

                <button
                  onClick={() => {
                    fetchAdNetworks();
                    fetchAdUnits();
                    fetchDisplayRules();
                  }}
                  className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700"
                  title="Refresh"
                >
                  <RefreshCw className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>

          {/* Main Tabs */}
          <div className="flex space-x-2">
            <button
              onClick={() => setMainTab('management')}
              className={`px-6 py-3 font-medium text-sm transition-colors rounded-t-lg ${
                mainTab === 'management'
                  ? 'bg-[#309605] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Ad Management
            </button>
            <button
              onClick={() => setMainTab('revenue')}
              className={`px-6 py-3 font-medium text-sm transition-colors rounded-t-lg ${
                mainTab === 'revenue'
                  ? 'bg-[#309605] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Ad Revenue
            </button>
            <button
              onClick={() => setMainTab('safety')}
              className={`px-6 py-3 font-medium text-sm transition-colors rounded-t-lg ${
                mainTab === 'safety'
                  ? 'bg-[#309605] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Ad Safety Caps
            </button>
          </div>
        </div>

        {/* Main Tab Content */}
        <div className="p-6">
          {mainTab === 'management' && (
            <div className="space-y-8">
              {/* Success Message */}
              {formSuccess && (
                <div className="p-4 bg-green-100 border border-green-200 rounded-lg">
                  <p className="text-green-700">{formSuccess}</p>
                </div>
              )}

              {/* Sub-Tabs */}
              <div className="flex border-b border-gray-200">
                <button
                  onClick={() => setActiveTab('networks')}
                  className={`py-4 px-6 font-medium text-base transition-colors duration-200 relative ${
                    activeTab === 'networks' ? 'text-[#309605] border-b-2 border-[#309605]' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Ad Networks
                </button>
                <button
                  onClick={() => setActiveTab('units')}
                  className={`py-4 px-6 font-medium text-base transition-colors duration-200 relative ${
                    activeTab === 'units' ? 'text-[#309605] border-b-2 border-[#309605]' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Ad Units
                </button>
                <button
                  onClick={() => setActiveTab('rules')}
                  className={`py-4 px-6 font-medium text-base transition-colors duration-200 relative ${
                    activeTab === 'rules' ? 'text-[#309605] border-b-2 border-[#309605]' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Display Rules
        </button>
        <button
          onClick={() => setActiveTab('mediation')}
          className={`py-4 px-6 font-medium text-base transition-colors duration-200 relative ${
            activeTab === 'mediation' ? 'text-[#309605] border-b-2 border-[#309605]' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Mediation
        </button>
        <button
          onClick={() => setActiveTab('placements')}
          className={`py-4 px-6 font-medium text-base transition-colors duration-200 relative ${
            activeTab === 'placements' ? 'text-[#309605] border-b-2 border-[#309605]' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Placements
        </button>
        <button
          onClick={() => setActiveTab('web_ads')}
          className={`py-4 px-6 font-medium text-base transition-colors duration-200 relative flex items-center gap-2 ${
            activeTab === 'web_ads' ? 'text-[#309605] border-b-2 border-[#309605]' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Globe className="w-4 h-4" />
          Web Ads
        </button>
      </div>

      {/* Ad Networks Tab */}
      {activeTab === 'networks' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-xl font-semibold text-gray-900">Ad Networks</h3>
            <button
              onClick={() => setShowNetworkForm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-[#309605] hover:bg-[#3ba208] rounded-lg text-white text-sm font-medium transition-all duration-200"
            >
              <Plus className="w-4 h-4" />
              Add Network
            </button>
          </div>

          {/* Network Form */}
          {showNetworkForm && (
            <div className="bg-gray-100 p-6 rounded-lg border border-gray-200 mb-6">
              <h4 className="text-lg font-semibold text-gray-900 mb-4">Add Ad Network</h4>
              
              <form onSubmit={handleSubmitNetwork} className="space-y-4">
                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-2">
                    Network *
                  </label>
                  <select
                    name="network"
                    value={newNetwork.network}
                    onChange={handleNetworkInputChange}
                    required
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                  >
                    <option value="admob">Google AdMob (Android / iOS app)</option>
                    <option value="adsense">Google AdSense (website)</option>
                    <option value="monetag">Monetag</option>
                    <option value="facebook">Facebook Audience Network</option>
                    <option value="unity">Unity Ads</option>
                    <option value="applovin">AppLovin</option>
                    <option value="monetag">Monetag</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-2">
                    {newNetwork.network === "adsense"
                      ? "AdSense publisher ID (ca-pub-…) *"
                      : "API Key / Publisher ID *"}
                  </label>
                  <input
                    type="text"
                    name="api_key"
                    value={newNetwork.api_key}
                    onChange={handleNetworkInputChange}
                    required
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                    placeholder={
                      newNetwork.network === "adsense"
                        ? "ca-pub-4739421992298461"
                        : "Enter API key or publisher ID"
                    }
                  />
                  {newNetwork.network === "adsense" && (
                    <p className="text-xs text-gray-500 mt-1">
                      Used on airaplay.com (web build). Same value as the AdSense script client ID.
                    </p>
                  )}
                </div>
                
                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-2">
                    {newNetwork.network === "adsense" ? "Site name / label *" : "App ID *"}
                  </label>
                  <input
                    type="text"
                    name="app_id"
                    value={newNetwork.app_id}
                    onChange={handleNetworkInputChange}
                    required
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                    placeholder={
                      newNetwork.network === "adsense" ? "airaplay.com" : "Enter app ID"
                    }
                  />
                </div>
                
                {newNetwork.network === 'applovin' && (
                  <div>
                    <label className="block text-gray-700 text-sm font-medium mb-2">
                      SDK Key (AppLovin)
                    </label>
                    <input
                      type="text"
                      name="sdk_key"
                      value={(newNetwork as any).sdk_key || ''}
                      onChange={handleNetworkInputChange}
                      className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                      placeholder="Enter AppLovin SDK Key"
                    />
                  </div>
                )}
                
                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-2">
                    eCPM Floor (USD)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    name="ecpm_floor"
                    value={(newNetwork as any).ecpm_floor || ''}
                    onChange={handleNetworkInputChange}
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                    placeholder="e.g., 1.50 for AdMob, 2.50 for AppLovin"
                  />
                  <p className="text-xs text-gray-500 mt-1">Minimum CPM for this network</p>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="is_mediation_primary"
                      name="is_mediation_primary"
                      checked={(newNetwork as any).is_mediation_primary || false}
                      onChange={(e) => {
                        setNewNetwork(prev => ({
                          ...prev,
                          is_mediation_primary: e.target.checked,
                          is_mediation_secondary: e.target.checked ? false : prev.is_mediation_secondary
                        }));
                      }}
                      className="w-4 h-4 rounded border-gray-300 text-[#309605] focus:ring-[#309605]"
                    />
                    <label htmlFor="is_mediation_primary" className="ml-2 text-gray-700 text-sm">
                      Mediation Primary (AdMob)
                    </label>
                  </div>
                  
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="is_mediation_secondary"
                      name="is_mediation_secondary"
                      checked={(newNetwork as any).is_mediation_secondary || false}
                      onChange={(e) => {
                        setNewNetwork(prev => ({
                          ...prev,
                          is_mediation_secondary: e.target.checked,
                          is_mediation_primary: e.target.checked ? false : prev.is_mediation_primary
                        }));
                      }}
                      className="w-4 h-4 rounded border-gray-300 text-[#309605] focus:ring-[#309605]"
                    />
                    <label htmlFor="is_mediation_secondary" className="ml-2 text-gray-700 text-sm">
                      Mediation Secondary (AppLovin)
                    </label>
                  </div>
                </div>
                
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="is_active"
                    name="is_active"
                    checked={newNetwork.is_active}
                    onChange={handleNetworkCheckboxChange}
                    className="w-4 h-4 rounded border-gray-300 text-[#309605] focus:ring-[#309605]"
                  />
                  <label htmlFor="is_active" className="ml-2 text-gray-700 text-sm">
                    Active
                  </label>
                </div>
                
                {networkError && (
                  <div className="p-3 bg-red-100 border border-red-200 rounded-lg">
                    <p className="text-red-700 text-sm">{networkError}</p>
                  </div>
                )}
                
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowNetworkForm(false);
                      setNetworkError(null);
                    }}
                    className="px-4 py-2 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg text-gray-700 transition-all duration-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-[#309605] hover:bg-[#3ba208] rounded-lg text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? 'Adding...' : 'Add Network'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Networks List */}
          {isLoadingNetworks ? (
            <div className="flex items-center justify-center py-12">
              {null}
              <p className="ml-4 text-gray-700">Loading ad networks...</p>
            </div>
          ) : networkError && adNetworks.length === 0 ? (
            <div className="p-6 bg-red-100 border border-red-200 rounded-lg text-center">
              <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
              <p className="text-red-700">{networkError}</p>
              <button
                onClick={fetchAdNetworks}
                className="mt-4 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg"
              >
                Try Again
              </button>
            </div>
          ) : adNetworks.length === 0 ? (
            <div className="p-6 bg-gray-100 rounded-lg text-center">
              <p className="text-gray-700">No ad networks configured yet. Add your first ad network to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-left">
                    <th className="p-4 text-gray-700 font-medium">Network</th>
                    <th className="p-4 text-gray-700 font-medium">API Key / Publisher ID</th>
                    <th className="p-4 text-gray-700 font-medium">App ID</th>
                    <th className="p-4 text-gray-700 font-medium">Status</th>
                    <th className="p-4 text-gray-700 font-medium">Added</th>
                    <th className="p-4 text-gray-700 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {adNetworks.map((network) => (
                    <tr key={network.id} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="p-4">
                        <div className="font-medium text-gray-900 capitalize">{network.network}</div>
                      </td>
                      <td className="p-4">
                        <div className="text-gray-700 font-mono text-sm">
                          {network.api_key.substring(0, 8)}...{network.api_key.substring(network.api_key.length - 4)}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="text-gray-700 font-mono text-sm">{network.app_id}</div>
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          network.is_active 
                            ? 'bg-green-100 text-green-700 border border-green-200' 
                            : 'bg-red-100 text-red-700 border border-red-200'
                        }`}>
                          {network.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="p-4 text-gray-700">{formatDate(network.created_at)}</td>
                      <td className="p-4">
                        <div className="flex space-x-2">
                          <button
                            onClick={() => toggleNetworkStatus(network.id, network.is_active)}
                            className={`p-2 rounded-lg ${
                              network.is_active 
                                ? 'bg-red-100 hover:bg-red-200 text-red-700' 
                                : 'bg-green-100 hover:bg-green-200 text-green-700'
                            }`}
                            title={network.is_active ? 'Deactivate' : 'Activate'}
                          >
                            {network.is_active ? <X size={16} /> : <Check size={16} />}
                          </button>
                          <button
                            onClick={() => deleteNetwork(network.id)}
                            className="p-2 bg-red-100 hover:bg-red-200 rounded-lg text-red-700"
                            title="Delete"
                          >
                            <Trash2 size={16} />
                          </button>
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

      {/* Ad Units Tab */}
      {activeTab === 'units' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-xl font-semibold text-gray-900">Ad Units</h3>
            <button
              onClick={() => {
                if (adNetworks.length === 0) {
                  alert('Please add at least one ad network first');
                  return;
                }
                setShowUnitForm(true);
                setNewUnit({
                  ...newUnit,
                  network_id: adNetworks[0].id
                });
              }}
              className="flex items-center gap-2 px-4 py-2 bg-[#309605] hover:bg-[#3ba208] rounded-lg text-white text-sm font-medium transition-all duration-200"
            >
              <Plus className="w-4 h-4" />
              Add Ad Unit
            </button>
          </div>

          {/* Unit Form */}
          {showUnitForm && (
            <div className="bg-gray-100 p-6 rounded-lg border border-gray-200 mb-6">
              <h4 className="text-lg font-semibold text-gray-900 mb-4">Add Ad Unit</h4>
              
              <form onSubmit={handleSubmitUnit} className="space-y-4">
                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-2">
                    Ad Network *
                  </label>
                  <select
                    name="network_id"
                    value={newUnit.network_id}
                    onChange={handleUnitInputChange}
                    required
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                  >
                    <option value="">Select ad network</option>
                    {adNetworks.map(network => (
                      <option key={network.id} value={network.id}>
                        {network.network} ({network.app_id})
                      </option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-2">
                    Ad Unit Type *
                  </label>
                  <select
                    name="unit_type"
                    value={newUnit.unit_type}
                    onChange={handleUnitInputChange}
                    required
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                  >
                    <option value="banner">Banner</option>
                    <option value="adsense">AdSense display</option>
                    <option value="interstitial">Interstitial</option>
                    <option value="rewarded">Rewarded</option>
                    <option value="native">Native</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-2">
                    {adNetworks.find((n) => n.id === newUnit.network_id)?.network === "adsense"
                      ? "AdSense slot ID (numeric) *"
                      : "Ad Unit ID *"}
                  </label>
                  <input
                    type="text"
                    name="unit_id"
                    value={newUnit.unit_id}
                    onChange={handleUnitInputChange}
                    required
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                    placeholder={
                      adNetworks.find((n) => n.id === newUnit.network_id)?.network === "adsense"
                        ? "e.g. 1234567890 (from AdSense → Ads → By ad unit)"
                        : "Enter ad unit ID"
                    }
                  />
                </div>
                
                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-2">
                    Placement Key *
                  </label>
                  {isLoadingPlacementKeys ? (
                    <div className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-500">
                      Loading placement keys...
                    </div>
                  ) : (
                    <select
                      name="placement"
                      value={newUnit.placement}
                      onChange={handleUnitInputChange}
                      required
                      className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                    >
                      <option value="">Select Placement Key</option>
                      {placementKeys.length > 0 ? (
                        placementKeys.map((pk) => (
                          <option key={pk.key} value={pk.key}>
                            {pk.name} ({pk.screen}) - {pk.key}
                          </option>
                        ))
                      ) : (
                        <>
                          <option value="home_screen">Home Screen (Legacy)</option>
                          <option value="explore_screen">Explore Screen (Legacy)</option>
                          <option value="library_screen">Library Screen (Legacy)</option>
                          <option value="profile_screen">Profile Screen (Legacy)</option>
                          <option value="between_songs">Between Songs (Legacy)</option>
                          <option value="after_video">After Video (Legacy)</option>
                          <option value="playlist_view">Playlist View (Legacy)</option>
                        </>
                      )}
                    </select>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    {placementKeys.length > 0 
                      ? `${placementKeys.length} placement key(s) available. Create new placements in the Placements tab.`
                      : 'No placement keys found. Create placements in the Placements tab first, or use legacy placement values.'}
                  </p>
                </div>
                
                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-2">
                    eCPM Floor (USD)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    name="ecpm_floor"
                    value={(newUnit as any).ecpm_floor || ''}
                    onChange={handleUnitInputChange}
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                    placeholder="e.g., 1.50"
                  />
                  <p className="text-xs text-gray-500 mt-1">Minimum CPM for this ad unit</p>
                </div>
                
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="auto_cpm_bidding"
                    name="auto_cpm_bidding"
                    checked={(newUnit as any).auto_cpm_bidding !== false}
                    onChange={(e) => {
                      setNewUnit(prev => ({
                        ...prev,
                        auto_cpm_bidding: e.target.checked
                      }));
                    }}
                    className="w-4 h-4 rounded border-gray-300 text-[#309605] focus:ring-[#309605]"
                  />
                  <label htmlFor="auto_cpm_bidding" className="ml-2 text-gray-700 text-sm">
                    Enable Automatic CPM Bidding
                  </label>
                </div>
                
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="unit_is_active"
                    name="is_active"
                    checked={newUnit.is_active}
                    onChange={handleUnitCheckboxChange}
                    className="w-4 h-4 rounded border-gray-300 text-[#309605] focus:ring-[#309605]"
                  />
                  <label htmlFor="unit_is_active" className="ml-2 text-gray-700 text-sm">
                    Active
                  </label>
                </div>
                
                {unitError && (
                  <div className="p-3 bg-red-100 border border-red-200 rounded-lg">
                    <p className="text-red-700 text-sm">{unitError}</p>
                  </div>
                )}
                
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowUnitForm(false);
                      setUnitError(null);
                    }}
                    className="px-4 py-2 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg text-gray-700 transition-all duration-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-[#309605] hover:bg-[#3ba208] rounded-lg text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? 'Adding...' : 'Add Unit'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Units List */}
          {isLoadingUnits ? (
            <div className="flex items-center justify-center py-12">
              {null}
              <p className="ml-4 text-gray-700">Loading ad units...</p>
            </div>
          ) : unitError && adUnits.length === 0 ? (
            <div className="p-6 bg-red-100 border border-red-200 rounded-lg text-center">
              <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
              <p className="text-red-700">{unitError}</p>
              <button
                onClick={fetchAdUnits}
                className="mt-4 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg"
              >
                Try Again
              </button>
            </div>
          ) : adUnits.length === 0 ? (
            <div className="p-6 bg-gray-100 rounded-lg text-center">
              <p className="text-gray-700">No ad units configured yet. Add your first ad unit to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-left">
                    <th className="p-4 text-gray-700 font-medium">Network</th>
                    <th className="p-4 text-gray-700 font-medium">Type</th>
                    <th className="p-4 text-gray-700 font-medium">Unit ID</th>
                    <th className="p-4 text-gray-700 font-medium">Placement</th>
                    <th className="p-4 text-gray-700 font-medium">Status</th>
                    <th className="p-4 text-gray-700 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {adUnits.map((unit) => (
                    <tr key={unit.id} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="p-4">
                        <div className="font-medium text-gray-900 capitalize">{getNetworkName(unit.network_id)}</div>
                      </td>
                      <td className="p-4">
                        <div className="text-gray-700 capitalize">{unit.unit_type}</div>
                      </td>
                      <td className="p-4">
                        <div className="text-gray-700 font-mono text-sm">
                          {unit.unit_id.length > 20 
                            ? `${unit.unit_id.substring(0, 10)}...${unit.unit_id.substring(unit.unit_id.length - 10)}`
                            : unit.unit_id
                          }
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="text-gray-700">
                          {unit.placement.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                        </div>
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          unit.is_active 
                            ? 'bg-green-100 text-green-700 border border-green-200' 
                            : 'bg-red-100 text-red-700 border border-red-200'
                        }`}>
                          {unit.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex space-x-2">
                          <button
                            onClick={() => toggleUnitStatus(unit.id, unit.is_active)}
                            className={`p-2 rounded-lg ${
                              unit.is_active 
                                ? 'bg-red-100 hover:bg-red-200 text-red-700' 
                                : 'bg-green-100 hover:bg-green-200 text-green-700'
                            }`}
                            title={unit.is_active ? 'Deactivate' : 'Activate'}
                          >
                            {unit.is_active ? <X size={16} /> : <Check size={16} />}
                          </button>
                          <button
                            onClick={() => deleteUnit(unit.id)}
                            className="p-2 bg-red-100 hover:bg-red-200 rounded-lg text-red-700"
                            title="Delete"
                          >
                            <Trash2 size={16} />
                          </button>
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

      {/* Display Rules Tab */}
      {activeTab === 'rules' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold text-gray-900">Ad Display Rules</h3>
            <button
              onClick={() => setShowRuleForm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-[#309605] hover:bg-[#3ba208] rounded-lg text-white text-sm font-medium transition-all duration-200"
            >
              <Plus className="w-4 h-4" />
              Add Rule
            </button>
          </div>
          
          {/* Rule Form */}
          {showRuleForm && (
            <div className="bg-gray-100 p-6 rounded-lg border border-gray-200 mb-6">
              <h4 className="text-lg font-semibold text-gray-900 mb-4">Add Display Rule</h4>
              
              <form onSubmit={handleSubmitRule} className="space-y-4">
                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-2">
                    Rule Type *
                  </label>
                  <select
                    name="rule_type"
                    value={newRule.rule_type}
                    onChange={handleRuleInputChange}
                    required
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                  >
                    <option value="role">User Role</option>
                    <option value="content_type">Content Type</option>
                    <option value="country">Country</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-2">
                    Rule Value *
                  </label>
                  {newRule.rule_type === 'role' && (
                    <select
                      name="rule_value"
                      value={newRule.rule_value}
                      onChange={handleRuleInputChange}
                      required
                      className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                    >
                      <option value="listener">Listener</option>
                      <option value="creator">Creator</option>
                      <option value="admin">Admin</option>
                    </select>
                  )}
                  
                  {newRule.rule_type === 'content_type' && (
                    <select
                      name="rule_value"
                      value={newRule.rule_value}
                      onChange={handleRuleInputChange}
                      required
                      className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                    >
                      <option value="song">Music</option>
                      <option value="video">Video</option>
                      <option value="short_clip">Short Clip</option>
                    </select>
                  )}
                  
                  {newRule.rule_type === 'country' && (
                    <select
                      name="rule_value"
                      value={newRule.rule_value}
                      onChange={handleRuleInputChange}
                      required
                      className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                    >
                      <option value="">Select country</option>
                      {countries.map(country => (
                        <option key={country} value={country}>
                          {country}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="rule_is_enabled"
                    name="is_enabled"
                    checked={newRule.is_enabled}
                    onChange={handleRuleCheckboxChange}
                    className="w-4 h-4 rounded border-gray-300 text-[#309605] focus:ring-[#309605]"
                  />
                  <label htmlFor="rule_is_enabled" className="ml-2 text-gray-700 text-sm">
                    Enabled
                  </label>
                </div>
                
                {rulesError && (
                  <div className="p-3 bg-red-100 border border-red-200 rounded-lg">
                    <p className="text-red-700 text-sm">{rulesError}</p>
                  </div>
                )}
                
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowRuleForm(false);
                      setRulesError(null);
                    }}
                    className="px-4 py-2 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg text-gray-700 transition-all duration-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || (newRule.rule_type === 'country' && !newRule.rule_value)}
                    className="px-4 py-2 bg-[#309605] hover:bg-[#3ba208] rounded-lg text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? 'Adding...' : 'Add Rule'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Rules List */}
          {isLoadingRules ? (
            <div className="flex items-center justify-center py-12">
              {null}
              <p className="ml-4 text-gray-700">Loading display rules...</p>
            </div>
          ) : rulesError && displayRules.length === 0 ? (
            <div className="p-6 bg-red-100 border border-red-200 rounded-lg text-center">
              <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
              <p className="text-red-700">{rulesError}</p>
              <button
                onClick={fetchDisplayRules}
                className="mt-4 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg"
              >
                Try Again
              </button>
            </div>
          ) : displayRules.length === 0 ? (
            <div className="p-6 bg-gray-100 rounded-lg text-center">
              <p className="text-gray-700">No display rules configured yet. Add your first rule to control ad visibility.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-left">
                    <th className="p-4 text-gray-700 font-medium">Rule Type</th>
                    <th className="p-4 text-gray-700 font-medium">Value</th>
                    <th className="p-4 text-gray-700 font-medium">Status</th>
                    <th className="p-4 text-gray-700 font-medium">Created</th>
                    <th className="p-4 text-gray-700 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRules.map((rule) => (
                    <tr key={rule.id} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="p-4">
                        <div className="font-medium text-gray-900">
                          {rule.rule_type === 'role' && (
                            <div className="flex items-center gap-2">
                              <Users className="w-4 h-4 text-blue-600" />
                              <span>User Role</span>
                            </div>
                          )}
                          {rule.rule_type === 'content_type' && (
                            <div className="flex items-center gap-2">
                              {rule.rule_value === 'song' && <Music className="w-4 h-4 text-purple-600" />}
                              {rule.rule_value === 'video' && <Video className="w-4 h-4 text-pink-600" />}
                              {rule.rule_value === 'short_clip' && <Zap className="w-4 h-4 text-yellow-600" />}
                              <span>Content Type</span>
                            </div>
                          )}
                          {rule.rule_type === 'country' && (
                            <div className="flex items-center gap-2">
                              <Globe className="w-4 h-4 text-green-600" />
                              <span>Country</span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="text-gray-700">{formatRuleValue(rule.rule_type, rule.rule_value)}</div>
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          rule.is_enabled 
                            ? 'bg-green-100 text-green-700 border border-green-200' 
                            : 'bg-red-100 text-red-700 border border-red-200'
                        }`}>
                          {rule.is_enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </td>
                      <td className="p-4 text-gray-700">{formatDate(rule.created_at)}</td>
                      <td className="p-4">
                        <div className="flex space-x-2">
                          <button
                            onClick={() => toggleRuleStatus(rule.id, rule.is_enabled)}
                            className={`p-2 rounded-lg ${
                              rule.is_enabled 
                                ? 'bg-red-100 hover:bg-red-200 text-red-700' 
                                : 'bg-green-100 hover:bg-green-200 text-green-700'
                            }`}
                            title={rule.is_enabled ? 'Disable' : 'Enable'}
                          >
                            {rule.is_enabled ? <X size={16} /> : <Check size={16} />}
                          </button>
                          <button
                            onClick={() => deleteRule(rule.id)}
                            className="p-2 bg-red-100 hover:bg-red-200 rounded-lg text-red-700"
                            title="Delete"
                          >
                            <Trash2 size={16} />
                          </button>
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

      {/* Mediation Tab */}
      {activeTab === 'mediation' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-xl font-semibold text-gray-900">Ad Mediation Configuration</h3>
              <p className="text-sm text-gray-600 mt-1">Configure AdMob as primary and AppLovin as secondary with automatic CPM bidding</p>
            </div>
          </div>

          {isLoadingMediation ? (
            <div className="flex items-center justify-center py-12">
              {null}
              <p className="ml-4 text-gray-700">Loading mediation configuration...</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow p-6">
              {mediationConfig ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                      <h4 className="font-semibold text-gray-900 mb-2">Primary Network (AdMob)</h4>
                      {mediationConfig.primary_network ? (
                        <div className="space-y-2">
                          <p className="text-sm text-gray-700">
                            <span className="font-medium">Network:</span> {mediationConfig.primary_network.network}
                          </p>
                          <p className="text-sm text-gray-700">
                            <span className="font-medium">App ID:</span> {mediationConfig.primary_network.app_id}
                          </p>
                          <p className="text-sm text-gray-700">
                            <span className="font-medium">eCPM Floor:</span> ${mediationConfig.primary_network.ecpm_floor || '1.50'}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">No primary network configured</p>
                      )}
                    </div>

                    <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                      <h4 className="font-semibold text-gray-900 mb-2">Secondary Network (AppLovin)</h4>
                      {mediationConfig.secondary_network ? (
                        <div className="space-y-2">
                          <p className="text-sm text-gray-700">
                            <span className="font-medium">Network:</span> {mediationConfig.secondary_network.network}
                          </p>
                          <p className="text-sm text-gray-700">
                            <span className="font-medium">App ID:</span> {mediationConfig.secondary_network.app_id}
                          </p>
                          <p className="text-sm text-gray-700">
                            <span className="font-medium">eCPM Floor:</span> ${mediationConfig.secondary_network.ecpm_floor || '2.50'}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">No secondary network configured</p>
                      )}
                    </div>
                  </div>

                  <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-1">Automatic CPM Bidding</h4>
                        <p className="text-sm text-gray-600">The network with the highest CPM will serve the ad first</p>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                        mediationConfig.auto_cpm_bidding
                          ? 'bg-green-100 text-green-700 border border-green-200'
                          : 'bg-gray-100 text-gray-700 border border-gray-200'
                      }`}>
                        {mediationConfig.auto_cpm_bidding ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-gray-600 mb-4">No mediation configuration found. Configure networks with mediation roles first.</p>
                  <button
                    onClick={() => {
                      setActiveTab('networks');
                      setShowNetworkForm(true);
                    }}
                    className="px-4 py-2 bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg"
                  >
                    Configure Networks
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Placements Tab */}
      {activeTab === 'placements' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-xl font-semibold text-gray-900">Ad Placements</h3>
            <button
              onClick={() => {
                if (adUnits.length === 0) {
                  alert('Please add at least one ad unit first');
                  return;
                }
                setShowPlacementForm(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-[#309605] hover:bg-[#3ba208] rounded-lg text-white text-sm font-medium transition-all duration-200"
            >
              <Plus className="w-4 h-4" />
              Add Placement
            </button>
          </div>

          {showPlacementForm && (
            <div className="bg-gray-100 p-6 rounded-lg border border-gray-200 mb-6">
              <h4 className="text-lg font-semibold text-gray-900 mb-4">Add Ad Placement</h4>
              <form onSubmit={async (e) => {
                e.preventDefault();
                setIsSubmitting(true);
                setFormSuccess(null);
                
                setPlacementError(null);
                
                try {
                  // Validate required fields
                  if (!newPlacement.placement_key || !newPlacement.placement_key.trim()) {
                    setPlacementError('Please enter a placement key');
                    setIsSubmitting(false);
                    return;
                  }
                  if (!newPlacement.placement_name || !newPlacement.placement_name.trim()) {
                    setPlacementError('Please enter a placement name');
                    setIsSubmitting(false);
                    return;
                  }
                  if (!newPlacement.screen_name) {
                    setPlacementError('Please select a screen name');
                    setIsSubmitting(false);
                    return;
                  }
                  if (!newPlacement.ad_unit_id) {
                    setPlacementError('Please select an ad unit');
                    setIsSubmitting(false);
                    return;
                  }

                  // Prepare placement data with proper formatting
                  const placementData: any = {
                    placement_key: newPlacement.placement_key.trim(),
                    placement_name: newPlacement.placement_name.trim(),
                    screen_name: newPlacement.screen_name,
                    ad_unit_id: newPlacement.ad_unit_id,
                    ad_type: newPlacement.ad_type,
                    is_enabled: newPlacement.is_enabled,
                    display_priority: newPlacement.display_priority || 0,
                    conditions: {} // Default empty conditions object
                  };

                  // Add position if provided
                  if (newPlacement.position && newPlacement.position.trim()) {
                    placementData.position = newPlacement.position.trim();
                  }

                  console.log('Submitting placement:', placementData);

                  // First check if table exists
                  const { error: tableError } = await supabase
                    .from('ad_placements')
                    .select('id')
                    .limit(1);

                  if (tableError) {
                    console.error('Table check error:', tableError);
                    // If table doesn't exist, provide helpful message
                    if (tableError.message?.includes('relation') || tableError.message?.includes('does not exist') || tableError.code === '42P01') {
                      throw new Error('The ad_placements table does not exist. Please run the migration: npx supabase db push');
                    }
                    throw tableError;
                  }

                  // Now insert the placement
                  const { data, error } = await supabase
                    .from('ad_placements')
                    .insert([placementData])
                    .select();

                  if (error) {
                    console.error('Supabase insert error details:', {
                      message: error.message,
                      details: error.details,
                      hint: error.hint,
                      code: error.code,
                      status: (error as any).status,
                      statusText: (error as any).statusText
                    });
                    // Ensure error has all properties
                    const enhancedError: any = {
                      ...error,
                      message: error.message || 'Unknown database error',
                      details: error.details || null,
                      hint: error.hint || null,
                      code: error.code || null,
                      status: (error as any).status || null,
                      statusText: (error as any).statusText || null
                    };
                    throw enhancedError;
                  }

                  if (!data || data.length === 0) {
                    throw new Error('No data returned from insert - placement may not have been created');
                  }

                  setFormSuccess('Placement added successfully');
                  setPlacements(prev => [...prev, data[0]]);
                  setShowPlacementForm(false);
                  setNewPlacement({
                    placement_key: '',
                    placement_name: '',
                    screen_name: '',
                    ad_unit_id: '',
                    ad_type: 'banner',
                    position: '',
                    is_enabled: true,
                    display_priority: 0
                  });
                  setUseCustomPlacementKey(false);
                  // Refresh placement keys dropdown
                  fetchPlacementKeys();
                  setTimeout(() => setFormSuccess(null), 3000);
                } catch (err: any) {
                  // Comprehensive error logging
                  console.group('❌ Placement Insert Error');
                  console.error('Error object:', err);
                  console.error('Error type:', typeof err);
                  console.error('Error keys:', err ? Object.keys(err) : 'null');
                  console.error('Error stringified:', JSON.stringify(err, null, 2));
                  console.error('Error message:', err?.message);
                  console.error('Error details:', err?.details);
                  console.error('Error hint:', err?.hint);
                  console.error('Error code:', err?.code);
                  console.error('Error status:', err?.status);
                  console.error('Error statusText:', err?.statusText);
                  console.error('Full error:', err);
                  console.groupEnd();
                  
                  // Build detailed error message
                  let errorMessage = 'Failed to add placement: ';
                  let foundMessage = false;
                  
                  // Try multiple ways to get error message - check all possible paths
                  if (err?.message) {
                    errorMessage += err.message;
                    foundMessage = true;
                  }
                  if (!foundMessage && err?.details) {
                    errorMessage += err.details;
                    foundMessage = true;
                  }
                  if (!foundMessage && err?.hint) {
                    errorMessage += err.hint;
                    foundMessage = true;
                  }
                  if (!foundMessage && err?.error?.message) {
                    errorMessage += err.error.message;
                    foundMessage = true;
                  }
                  if (!foundMessage && typeof err === 'string') {
                    errorMessage += err;
                    foundMessage = true;
                  }
                  if (!foundMessage && err?.toString && err.toString() !== '[object Object]') {
                    errorMessage += err.toString();
                    foundMessage = true;
                  }
                  
                  if (!foundMessage) {
                    errorMessage += 'Unknown error occurred. ';
                    // Add raw error info for debugging
                    if (err) {
                      errorMessage += `Error type: ${typeof err}`;
                      if (err.code) errorMessage += `, Code: ${err.code}`;
                      if (err.status) errorMessage += `, Status: ${err.status}`;
                    }
                    errorMessage += ' Please check browser console (F12) for full details.';
                  }

                  // Add specific guidance for common errors
                  const errorStr = JSON.stringify(err).toLowerCase();
                  const errorMsg = (err?.message || '').toLowerCase();
                  
                  if (err?.code === '23505' || errorMsg.includes('duplicate') || errorMsg.includes('unique') || errorStr.includes('duplicate')) {
                    errorMessage += '\n\n⚠️ This placement key already exists. Please use a different key.';
                  } else if (err?.code === '23503' || errorMsg.includes('foreign key') || errorStr.includes('foreign key')) {
                    errorMessage += '\n\n⚠️ The selected ad unit does not exist. Please select a valid ad unit.';
                  } else if (errorMsg.includes('column') || errorMsg.includes('does not exist') || errorStr.includes('relation') || errorStr.includes('table')) {
                    errorMessage += '\n\n⚠️ Database schema not updated. Please run the migration:\n\nnpx supabase db push\n\nOr manually apply the migration in Supabase Dashboard.';
                  } else if (errorMsg.includes('permission') || errorMsg.includes('policy') || errorMsg.includes('rls') || errorStr.includes('permission') || errorStr.includes('policy')) {
                    errorMessage += '\n\n⚠️ You do not have permission to add placements. Please check your admin role.';
                  } else if (errorMsg.includes('null value') || errorMsg.includes('not null') || errorStr.includes('null')) {
                    errorMessage += '\n\n⚠️ Required field is missing. Please fill in all required fields.';
                  } else if (err?.status === 401 || err?.status === 403) {
                    errorMessage += '\n\n⚠️ Authentication error. Please refresh the page and try again.';
                  } else if (err?.status === 404) {
                    errorMessage += '\n\n⚠️ Table not found. Please ensure the migration has been applied.';
                  }

                  setPlacementError(errorMessage);
                } finally {
                  setIsSubmitting(false);
                }
              }} className="space-y-4">
                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-2">Placement Key *</label>
                  {isLoadingPlacementKeys ? (
                    <div className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-500">
                      Loading placement keys...
                    </div>
                  ) : (
                    <>
                      {!useCustomPlacementKey ? (
                        <select
                          value={newPlacement.placement_key}
                          onChange={(e) => {
                            const selectedKey = e.target.value;
                            if (selectedKey === '__custom__') {
                              setUseCustomPlacementKey(true);
                              setNewPlacement(prev => ({ ...prev, placement_key: '' }));
                            } else {
                              const selectedPlacement = placementKeys.find(pk => pk.key === selectedKey);
                              setNewPlacement(prev => ({
                                ...prev,
                                placement_key: selectedKey,
                                // Auto-fill name and screen if selecting existing placement
                                placement_name: selectedPlacement ? selectedPlacement.name : prev.placement_name,
                                screen_name: selectedPlacement ? selectedPlacement.screen : prev.screen_name
                              }));
                            }
                          }}
                          required={!useCustomPlacementKey}
                          className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                        >
                          <option value="">Select Placement Key</option>
                          {placementKeys.length > 0 && (
                            <optgroup label="Existing Placement Keys">
                              {placementKeys.map((pk) => (
                                <option key={pk.key} value={pk.key}>
                                  {pk.name} ({pk.screen}) - {pk.key}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          <optgroup label="App (Android / iOS — AdMob)">
                            <option value="home_screen_banner">Home Screen Banner</option>
                            <option value="home_screen_interstitial">Home Screen Interstitial</option>
                            <option value="mini_music_player_top_banner">Mini Music Player Top Banner</option>
                            <option value="music_player_bottom_banner">Music Player Bottom Banner</option>
                            <option value="during_song_playback_banner">During Song Playback Banner</option>
                            <option value="before_song_play_interstitial">Before Song Play Interstitial</option>
                            <option value="after_song_play_interstitial">After Song Play Interstitial</option>
                            <option value="video_player_bottom_banner">Video Player Bottom Banner</option>
                            <option value="before_video_play_interstitial">Before Video Play Interstitial</option>
                            <option value="after_video_play_rewarded">After Video Play Rewarded</option>
                            <option value="album_player_bottom_banner">Album Player Bottom Banner</option>
                            <option value="playlist_player_bottom_banner">Playlist Player Bottom Banner</option>
                            <option value="daily_mix_player_bottom_banner">Daily Mix Player Bottom Banner</option>
                            <option value="loops_video_bottom_banner">Loops Video Bottom Banner</option>
                          </optgroup>
                          <optgroup label="Web (airaplay.com — AdSense)">
                            <option value="web_home_screen_banner">Web Home Screen Banner</option>
                            <option value="web_mini_music_player_top_banner">Web Mini Player Top Banner</option>
                            <option value="web_music_player_bottom_banner">Web Music Player Bottom Banner</option>
                            <option value="web_album_player_bottom_banner">Web Album Player Bottom Banner</option>
                            <option value="web_playlist_player_bottom_banner">Web Playlist Player Bottom Banner</option>
                            <option value="web_daily_mix_player_bottom_banner">Web Daily Mix Player Bottom Banner</option>
                            <option value="web_video_player_bottom_banner">Web Video Player Bottom Banner</option>
                            <option value="web_loops_video_bottom_banner">Web Loops Video Bottom Banner</option>
                            <option value="web_before_song_play_interstitial">Web Before Song Play Interstitial</option>
                            <option value="web_before_video_play_interstitial">Web Before Video Play Interstitial</option>
                          </optgroup>
                          <option value="__custom__">➕ Create Custom Placement Key</option>
                        </select>
                      ) : (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={newPlacement.placement_key}
                            onChange={(e) => setNewPlacement(prev => ({ ...prev, placement_key: e.target.value }))}
                            required
                            className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                            placeholder="Enter custom placement key (e.g., home_screen_banner)"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setUseCustomPlacementKey(false);
                              setNewPlacement(prev => ({ ...prev, placement_key: '' }));
                            }}
                            className="text-xs text-[#309605] hover:text-[#3ba208] underline"
                          >
                            ← Select from dropdown instead
                          </button>
                        </div>
                      )}
                      <p className="text-xs text-gray-500 mt-1">
                        {placementKeys.length > 0 
                          ? `Select from ${placementKeys.length} existing placement key(s), choose a template, or create a custom one.`
                          : 'Select a template or create a custom placement key (e.g., home_screen_banner).'}
                      </p>
                    </>
                  )}
                </div>
                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-2">Placement Name *</label>
                  <input
                    type="text"
                    value={newPlacement.placement_name}
                    onChange={(e) => setNewPlacement(prev => ({ ...prev, placement_name: e.target.value }))}
                    required
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg"
                    placeholder="e.g., Home Screen Banner"
                  />
                </div>
                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-2">Screen Name *</label>
                  <select
                    value={newPlacement.screen_name}
                    onChange={(e) => setNewPlacement(prev => ({ ...prev, screen_name: e.target.value }))}
                    required
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg"
                  >
                    <option value="">Select Screen</option>
                    <option value="HomePlayer">Home Screen</option>
                    <option value="MiniMusicPlayer">Mini Music Player</option>
                    <option value="MusicPlayerScreen">Music Player</option>
                    <option value="VideoPlayerScreen">Video Player</option>
                    <option value="AlbumPlayerScreen">Album Player</option>
                    <option value="PlaylistPlayerScreen">Playlist Player</option>
                    <option value="LoopsVideoDisplay">Loops Video Display</option>
                    <option value="ExploreScreen">Explore Screen</option>
                    <option value="LibraryScreen">Library Screen</option>
                    <option value="ProfileScreen">Profile Screen</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-2">Ad Unit *</label>
                  <select
                    value={newPlacement.ad_unit_id}
                    onChange={(e) => setNewPlacement(prev => ({ ...prev, ad_unit_id: e.target.value }))}
                    required
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg"
                  >
                    <option value="">Select Ad Unit</option>
                    {adUnits.map(unit => (
                      <option key={unit.id} value={unit.id}>
                        {unit.unit_type} - {unit.placement} ({unit.unit_id.substring(0, 20)}...)
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-2">Ad Type *</label>
                  <select
                    value={newPlacement.ad_type}
                    onChange={(e) => setNewPlacement(prev => ({ ...prev, ad_type: e.target.value as any }))}
                    required
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg"
                  >
                    <option value="banner">Banner</option>
                    <option value="interstitial">Interstitial</option>
                    <option value="rewarded">Rewarded</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-2">Position</label>
                  <select
                    value={newPlacement.position}
                    onChange={(e) => setNewPlacement(prev => ({ ...prev, position: e.target.value }))}
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg"
                  >
                    <option value="">Select Position</option>
                    <option value="top">Top</option>
                    <option value="bottom">Bottom</option>
                    <option value="center">Center</option>
                    <option value="before_content">Before Content</option>
                    <option value="after_content">After Content</option>
                    <option value="in_content">In Content</option>
                  </select>
                </div>
                
                {placementError && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-red-800 text-sm font-medium mb-1">Error</p>
                        <p className="text-red-700 text-sm whitespace-pre-line">{placementError}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPlacementError(null)}
                        className="text-red-600 hover:text-red-800"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
                
                {formSuccess && (
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-green-800 text-sm">{formSuccess}</p>
                  </div>
                )}
                
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowPlacementForm(false);
                      setPlacementError(null);
                      setFormSuccess(null);
                    }}
                    className="px-4 py-2 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg text-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-[#309605] hover:bg-[#3ba208] rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? 'Adding...' : 'Add Placement'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {isLoadingPlacements ? (
            <div className="flex items-center justify-center py-12">
              {null}
              <p className="ml-4 text-gray-700">Loading placements...</p>
            </div>
          ) : placements.length === 0 ? (
            <div className="p-6 bg-gray-100 rounded-lg text-center">
              <p className="text-gray-700">No placements configured yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-left">
                    <th className="p-4 text-gray-700 font-medium">Placement Key</th>
                    <th className="p-4 text-gray-700 font-medium">Screen</th>
                    <th className="p-4 text-gray-700 font-medium">Ad Type</th>
                    <th className="p-4 text-gray-700 font-medium">Position</th>
                    <th className="p-4 text-gray-700 font-medium">Status</th>
                    <th className="p-4 text-gray-700 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {placements.map((placement) => (
                    <tr key={placement.id} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="p-4 font-medium text-gray-900">{placement.placement_key}</td>
                      <td className="p-4 text-gray-700">{placement.screen_name}</td>
                      <td className="p-4 text-gray-700 capitalize">{placement.ad_type}</td>
                      <td className="p-4 text-gray-700">{placement.position || 'N/A'}</td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          placement.is_enabled
                            ? 'bg-green-100 text-green-700 border border-green-200'
                            : 'bg-red-100 text-red-700 border border-red-200'
                        }`}>
                          {placement.is_enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex space-x-2">
                          <button
                            onClick={async () => {
                              const { error } = await supabase
                                .from('ad_placements')
                                .update({ is_enabled: !placement.is_enabled })
                                .eq('id', placement.id);
                              if (!error) {
                                setPlacements(prev => prev.map(p => p.id === placement.id ? { ...p, is_enabled: !p.is_enabled } : p));
                                fetchPlacementKeys(); // Refresh dropdown
                              }
                            }}
                            className={`p-2 rounded-lg ${
                              placement.is_enabled
                                ? 'bg-red-100 hover:bg-red-200 text-red-700'
                                : 'bg-green-100 hover:bg-green-200 text-green-700'
                            }`}
                          >
                            {placement.is_enabled ? <X size={16} /> : <Check size={16} />}
                          </button>
                          <button
                            onClick={async () => {
                              if (confirm('Delete this placement?')) {
                                const { error } = await supabase
                                  .from('ad_placements')
                                  .delete()
                                  .eq('id', placement.id);
                                if (!error) {
                                  setPlacements(prev => prev.filter(p => p.id !== placement.id));
                                  fetchPlacementKeys(); // Refresh dropdown
                                }
                              }
                            }}
                            className="p-2 bg-red-100 hover:bg-red-200 rounded-lg text-red-700"
                          >
                            <Trash2 size={16} />
                          </button>
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
          </div>
        )}

      {activeTab === 'web_ads' && (
        <div className="mt-6">
          <WebAdsSection />
        </div>
      )}

        {mainTab === 'revenue' && (
          <AdRevenueSection />
        )}

        {mainTab === 'safety' && (
          <AdSafetyCapsSection />
        )}
      </div>
    </div>
    </div>
  );
};
