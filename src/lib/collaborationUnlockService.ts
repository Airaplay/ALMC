import { supabase } from './supabase';
import { fetchWithCache, CACHE_KEYS, CACHE_TTL } from './configCache';

export interface CollaborationUnlockSettings {
  id: string;
  isEnabled: boolean;
  freeMatchesCount: number;
  unlockCostTreats: number;
  maxUnlockableMatches: number;
  updatedAt: string;
}

export interface CollaborationUnlockStatus {
  hasUnlocked: boolean;
  unlockedCount: number;
  canUnlockMore: boolean;
  remainingUnlocks: number;
}

/**
 * Get current rotation period start timestamp
 * Matches rotate every 6 hours
 */
export function getCurrentRotationPeriod(): Date {
  const now = new Date();
  const hours = now.getUTCHours();
  const rotationHour = Math.floor(hours / 6) * 6;

  const rotationStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    rotationHour,
    0,
    0,
    0
  ));

  return rotationStart;
}

/**
 * Fetch collaboration unlock settings
 * Cached for 6 hours as settings rarely change
 */
export async function getCollaborationUnlockSettings(): Promise<CollaborationUnlockSettings | null> {
  try {
    return fetchWithCache(
      CACHE_KEYS.COLLABORATION_UNLOCK_SETTINGS,
      CACHE_TTL.SIX_HOURS,
      async () => {
        const { data, error } = await supabase
          .from('collaboration_unlock_settings')
          .select('id, is_enabled, free_matches_count, unlock_cost_treats, max_unlockable_matches, updated_at')
          .single();

        if (error) {
          console.error('Error fetching collaboration unlock settings:', error);
          return null;
        }

        if (!data) {
          return null;
        }

        const settings: CollaborationUnlockSettings = {
          id: data.id,
          isEnabled: data.is_enabled,
          freeMatchesCount: data.free_matches_count,
          unlockCostTreats: data.unlock_cost_treats,
          maxUnlockableMatches: data.max_unlockable_matches,
          updatedAt: data.updated_at
        };

        return settings;
      }
    );
  } catch (error) {
    console.error('Error in getCollaborationUnlockSettings:', error);
    return null;
  }
}

/**
 * Clear settings cache (useful after admin updates settings)
 */
export function clearCollaborationUnlockSettingsCache(): void {
  settingsCache = null;
  settingsCacheTime = 0;
}

/**
 * Check if user has unlocked additional matches for current rotation
 */
export async function getUserUnlockStatus(artistId: string): Promise<CollaborationUnlockStatus> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return {
        hasUnlocked: false,
        unlockedCount: 0,
        canUnlockMore: false,
        remainingUnlocks: 0
      };
    }

    const rotationPeriod = getCurrentRotationPeriod();
    const settings = await getCollaborationUnlockSettings();

    if (!settings || !settings.isEnabled) {
      return {
        hasUnlocked: false,
        unlockedCount: 0,
        canUnlockMore: false,
        remainingUnlocks: 0
      };
    }

    const { data, error } = await supabase
      .from('collaboration_unlocks')
      .select('unlocked_count')
      .eq('user_id', user.id)
      .eq('artist_id', artistId)
      .eq('rotation_period', rotationPeriod.toISOString())
      .maybeSingle();

    if (error) {
      console.error('Error checking unlock status:', error);
    }

    const unlockedCount = data?.unlocked_count || 0;
    const canUnlockMore = unlockedCount < settings.maxUnlockableMatches;
    const remainingUnlocks = Math.max(0, settings.maxUnlockableMatches - unlockedCount);

    return {
      hasUnlocked: unlockedCount > 0,
      unlockedCount,
      canUnlockMore,
      remainingUnlocks
    };
  } catch (error) {
    console.error('Error in getUserUnlockStatus:', error);
    return {
      hasUnlocked: false,
      unlockedCount: 0,
      canUnlockMore: false,
      remainingUnlocks: 0
    };
  }
}

/**
 * Purchase unlock for additional collaboration matches
 */
export async function purchaseCollaborationUnlock(
  artistId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Get settings
    const settings = await getCollaborationUnlockSettings();
    if (!settings || !settings.isEnabled) {
      return { success: false, error: 'Collaboration unlock is currently disabled' };
    }

    // Check if already unlocked this artist in current rotation
    const rotationPeriod = getCurrentRotationPeriod();
    const { data: existingUnlock } = await supabase
      .from('collaboration_unlocks')
      .select('id')
      .eq('user_id', user.id)
      .eq('artist_id', artistId)
      .eq('rotation_period', rotationPeriod.toISOString())
      .maybeSingle();

    if (existingUnlock) {
      return { success: false, error: 'You have already unlocked this artist' };
    }

    // Check if user has reached max unlocks for this rotation
    const { data: allUnlocks } = await supabase
      .from('collaboration_unlocks')
      .select('id')
      .eq('user_id', user.id)
      .eq('rotation_period', rotationPeriod.toISOString());

    const totalUnlocks = allUnlocks?.length || 0;
    if (totalUnlocks >= settings.maxUnlockableMatches) {
      return { success: false, error: `Maximum unlocks (${settings.maxUnlockableMatches}) reached for this rotation` };
    }

    // Check wallet balance
    const { data: wallet, error: walletError } = await supabase
      .from('treat_wallets')
      .select('balance, purchased_balance, earned_balance')
      .eq('user_id', user.id)
      .single();

    if (walletError || !wallet) {
      return { success: false, error: 'Failed to fetch wallet balance' };
    }

    if (wallet.balance < settings.unlockCostTreats) {
      return { success: false, error: 'Insufficient Treats balance' };
    }

    // Calculate new balances after deduction
    // Deduct from purchased_balance first, then from earned_balance
    const amountToDeduct = settings.unlockCostTreats;
    let newPurchasedBalance = wallet.purchased_balance || 0;
    let newEarnedBalance = wallet.earned_balance || 0;

    if (newPurchasedBalance >= amountToDeduct) {
      // Deduct entirely from purchased balance
      newPurchasedBalance -= amountToDeduct;
    } else {
      // Deduct what we can from purchased, rest from earned
      const remainingToDeduct = amountToDeduct - newPurchasedBalance;
      newPurchasedBalance = 0;
      newEarnedBalance -= remainingToDeduct;
    }

    // Balance must equal earned_balance + purchased_balance (database constraint)
    const newBalance = newPurchasedBalance + newEarnedBalance;

    const { error: walletUpdateError } = await supabase
      .from('treat_wallets')
      .update({
        balance: newBalance,
        purchased_balance: newPurchasedBalance,
        earned_balance: newEarnedBalance
      })
      .eq('user_id', user.id);

    if (walletUpdateError) {
      console.error('Error updating wallet:', walletUpdateError);
      return { success: false, error: 'Failed to process payment' };
    }

    // Create transaction record
    const { error: transactionError } = await supabase
      .from('treat_transactions')
      .insert({
        user_id: user.id,
        transaction_type: 'collaboration_unlock',
        amount: -settings.unlockCostTreats,
        balance_before: wallet.balance,
        balance_after: newBalance,
        description: `Unlocked additional collaboration matches`,
        metadata: {
          artist_id: artistId,
          rotation_period: getCurrentRotationPeriod().toISOString(),
          unlock_cost: settings.unlockCostTreats
        },
        status: 'completed'
      });

    if (transactionError) {
      console.error('Error creating transaction:', transactionError);
      // Continue anyway as the wallet was successfully updated
    }

    // Record the unlock
    const { error: unlockError } = await supabase
      .from('collaboration_unlocks')
      .insert({
        user_id: user.id,
        artist_id: artistId,
        rotation_period: rotationPeriod.toISOString(),
        unlocked_count: 1,
        treat_cost: settings.unlockCostTreats
      });

    if (unlockError) {
      console.error('Error recording unlock:', unlockError);
      return { success: false, error: 'Failed to record unlock' };
    }

    return { success: true };
  } catch (error) {
    console.error('Error in purchaseCollaborationUnlock:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}

/**
 * Get unlock analytics for admin dashboard
 */
export async function getCollaborationUnlockAnalytics(days: number = 30) {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data: unlocks, error } = await supabase
      .from('collaboration_unlocks')
      .select('*')
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching unlock analytics:', error);
      return null;
    }

    const totalUnlocks = unlocks?.length || 0;
    const totalRevenue = unlocks?.reduce((sum, u) => sum + (u.treat_cost || 0), 0) || 0;
    const uniqueUsers = new Set(unlocks?.map(u => u.user_id)).size;

    // Calculate daily breakdown
    const dailyStats = new Map<string, { unlocks: number; revenue: number }>();
    unlocks?.forEach(unlock => {
      const date = new Date(unlock.created_at).toISOString().split('T')[0];
      const existing = dailyStats.get(date) || { unlocks: 0, revenue: 0 };
      dailyStats.set(date, {
        unlocks: existing.unlocks + 1,
        revenue: existing.revenue + (unlock.treat_cost || 0)
      });
    });

    return {
      totalUnlocks,
      totalRevenue,
      uniqueUsers,
      dailyStats: Array.from(dailyStats.entries()).map(([date, stats]) => ({
        date,
        ...stats
      }))
    };
  } catch (error) {
    console.error('Error in getCollaborationUnlockAnalytics:', error);
    return null;
  }
}
