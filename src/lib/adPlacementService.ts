import { supabase } from './supabase';

export interface AdPlacement {
  id: string;
  placement_key: string;
  placement_name: string;
  screen_name: string;
  ad_unit_id: string | null;
  ad_type: 'banner' | 'interstitial' | 'rewarded';
  position: string | null;
  is_enabled: boolean;
  display_priority: number;
  conditions: Record<string, any>;
  ad_unit?: {
    id: string;
    unit_id: string;
    unit_type: string;
    ecpm_floor: number;
    auto_cpm_bidding: boolean;
  };
  network?: {
    id: string;
    network: string;
    app_id: string;
    api_key: string;
    ecpm_floor: number;
    is_mediation_primary: boolean;
    is_mediation_secondary: boolean;
    sdk_key: string | null;
  };
}

/**
 * Get active placement configuration for a specific placement key
 */
export async function getActivePlacement(placementKey: string): Promise<AdPlacement | null> {
  try {
    // Try RPC function first (if it exists)
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_active_placement_config', {
      placement_key_param: placementKey
    });

    // If RPC function exists and returns data, use it
    if (!rpcError && rpcData) {
      // Transform the data to match our interface
      const placement = rpcData.placement;
      const adUnit = rpcData.ad_unit;
      const network = rpcData.network;

      return {
        id: placement.id,
        placement_key: placement.key || placement.placement_key,
        placement_name: placement.name || placement.placement_name,
        screen_name: placement.screen || placement.screen_name,
        ad_unit_id: adUnit?.id || null,
        ad_type: placement.ad_type as 'banner' | 'interstitial' | 'rewarded',
        position: placement.position,
        is_enabled: true,
        display_priority: placement.display_priority || 0,
        conditions: placement.conditions || {},
        ad_unit: adUnit ? {
          id: adUnit.id,
          unit_id: adUnit.unit_id,
          unit_type: adUnit.unit_type,
          ecpm_floor: adUnit.ecpm_floor || 0,
          auto_cpm_bidding: adUnit.auto_cpm_bidding || false
        } : undefined,
        network: network ? {
          id: network.id,
          network: network.network,
          app_id: network.app_id,
          api_key: network.api_key,
          ecpm_floor: 0,
          is_mediation_primary: false,
          is_mediation_secondary: false,
          sdk_key: null
        } : undefined
      };
    }

    // Fallback: Query database directly if RPC function doesn't exist
    const { data, error } = await supabase
      .from('ad_placements')
      .select(`
        *,
        ad_units (
          id,
          unit_id,
          unit_type,
          ecpm_floor,
          auto_cpm_bidding,
          network_id,
          ad_networks (
            id,
            network,
            app_id,
            api_key
          )
        )
      `)
      .eq('placement_key', placementKey)
      .eq('is_enabled', true)
      .order('display_priority', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error fetching placement config:', error);
      return null;
    }

    if (!data) return null;

    return {
      id: data.id,
      placement_key: data.placement_key,
      placement_name: data.placement_name,
      screen_name: data.screen_name,
      ad_unit_id: data.ad_unit_id,
      ad_type: data.ad_type as 'banner' | 'interstitial' | 'rewarded',
      position: data.position,
      is_enabled: data.is_enabled,
      display_priority: data.display_priority,
      conditions: data.conditions || {},
      ad_unit: data.ad_units ? {
        id: data.ad_units.id,
        unit_id: data.ad_units.unit_id,
        unit_type: data.ad_units.unit_type,
        ecpm_floor: data.ad_units.ecpm_floor || 0,
        auto_cpm_bidding: data.ad_units.auto_cpm_bidding || false
      } : undefined,
      network: data.ad_units?.ad_networks ? {
        id: data.ad_units.ad_networks.id,
        network: data.ad_units.ad_networks.network,
        app_id: data.ad_units.ad_networks.app_id,
        api_key: data.ad_units.ad_networks.api_key,
        ecpm_floor: 0,
        is_mediation_primary: false,
        is_mediation_secondary: false,
        sdk_key: null
      } : undefined
    };
  } catch (error) {
    console.error('Error in getActivePlacement:', error);
    return null;
  }
}

/**
 * Get all active placements for a screen
 */
export async function getActivePlacementsForScreen(screenName: string): Promise<AdPlacement[]> {
  try {
    const { data, error } = await supabase
      .from('ad_placements')
      .select(`
        *,
        ad_units (
          id,
          unit_id,
          unit_type,
          ecpm_floor,
          auto_cpm_bidding,
          network_id,
          ad_networks (
            id,
            network,
            app_id,
            api_key
          )
        )
      `)
      .eq('screen_name', screenName)
      .eq('is_enabled', true)
      .order('display_priority', { ascending: false });

    if (error) {
      console.error('Error fetching placements:', error);
      return [];
    }

    return (data || []).map((placement: any) => ({
      id: placement.id,
      placement_key: placement.placement_key,
      placement_name: placement.placement_name,
      screen_name: placement.screen_name,
      ad_unit_id: placement.ad_unit_id,
      ad_type: placement.ad_type,
      position: placement.position,
      is_enabled: placement.is_enabled,
      display_priority: placement.display_priority,
      conditions: placement.conditions || {},
      ad_unit: placement.ad_units ? {
        id: placement.ad_units.id,
        unit_id: placement.ad_units.unit_id,
        unit_type: placement.ad_units.unit_type,
        ecpm_floor: placement.ad_units.ecpm_floor || 0,
        auto_cpm_bidding: placement.ad_units.auto_cpm_bidding || false
      } : undefined,
      network: placement.ad_units?.ad_networks ? {
        id: placement.ad_units.ad_networks.id,
        network: placement.ad_units.ad_networks.network,
        app_id: placement.ad_units.ad_networks.app_id,
        api_key: placement.ad_units.ad_networks.api_key,
        ecpm_floor: 0,
        is_mediation_primary: false,
        is_mediation_secondary: false,
        sdk_key: null
      } : undefined
    }));
  } catch (error) {
    console.error('Error in getActivePlacementsForScreen:', error);
    return [];
  }
}

/**
 * Check if placement conditions are met
 */
export function checkPlacementConditions(placement: AdPlacement, context: Record<string, any>): boolean {
  const conditions = placement.conditions;
  if (!conditions || Object.keys(conditions).length === 0) {
    return true; // No conditions means always show
  }

  // Check each condition
  for (const [key, value] of Object.entries(conditions)) {
    if (context[key] !== value) {
      return false;
    }
  }

  return true;
}
