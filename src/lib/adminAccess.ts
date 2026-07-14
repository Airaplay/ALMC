import { getUserRole, supabase } from './supabase';

export interface AdminAccess {
  hasAccess: boolean;
  roleId: string | null;
  roleKey: string | null;
  roleName: string | null;
  legacyRole: string | null;
  roleLegacyRole: string | null;
  isSuperAdmin: boolean;
  features: string[];
}

export const LEGACY_ADMIN_ROLES = ['admin', 'manager', 'editor', 'account'] as const;

export const ALL_ADMIN_FEATURE_KEYS = [
  'analytics',
  'country_performance',
  'analysis',
  'users',
  'content',
  'content_thresholds',
  'featured_artists',
  'reports',
  'flagged',
  'earnings',
  'support',
  'treat_manager',
  'external_revenue',
  'promotional_credits',
  'payment_monitoring',
  'withdrawal_requests',
  'exchange_rates',
  'financial_controls',
  'accounting',
  'artist_earnings_ledger',
  'listener_earnings_ledger',
  'ad_management',
  'native_ads',
  'web_ads',
  'feature_banners',
  'promotion_manager',
  'listener_curations',
  'contribution_rewards',
  'daily_checkin',
  'referral_management',
  'announcements',
  'mix_manager',
  'daily_mix_manager',
  'global_daily_mix_manager',
  'genre_manager',
  'mood_analysis',
  'faqs',
  'blog',
  'settings',
  'admin_settings',
] as const;

const LEGACY_ROLE_FEATURES: Record<string, string[]> = {
  admin: [...ALL_ADMIN_FEATURE_KEYS],
  manager: ALL_ADMIN_FEATURE_KEYS.filter(
    feature => ![
      'admin_settings',
      'treat_manager',
      'payment_monitoring',
      'financial_controls',
      'promotional_credits',
      'country_performance',
      'withdrawal_requests',
      'exchange_rates',
      'accounting',
      'artist_earnings_ledger',
      'listener_earnings_ledger',
      'external_revenue',
    ].includes(feature)
  ),
  editor: ['content', 'faqs', 'blog'],
  account: [
    'analytics',
    'earnings',
    'withdrawal_requests',
    'exchange_rates',
    'support',
    'payment_monitoring',
    'financial_controls',
    'promotional_credits',
    'treat_manager',
    'country_performance',
    'accounting',
    'artist_earnings_ledger',
    'listener_earnings_ledger',
    'external_revenue',
  ],
};

const emptyAccess = (legacyRole: string | null = null): AdminAccess => ({
  hasAccess: false,
  roleId: null,
  roleKey: legacyRole,
  roleName: legacyRole,
  legacyRole,
  roleLegacyRole: legacyRole,
  isSuperAdmin: legacyRole === 'admin',
  features: [],
});

const legacyAccess = (role: string | null): AdminAccess => {
  if (!role || !LEGACY_ADMIN_ROLES.includes(role as (typeof LEGACY_ADMIN_ROLES)[number])) {
    return emptyAccess(role);
  }

  return {
    hasAccess: true,
    roleId: null,
    roleKey: role,
    roleName: role.charAt(0).toUpperCase() + role.slice(1),
    legacyRole: role,
    roleLegacyRole: role,
    isSuperAdmin: role === 'admin',
    features: LEGACY_ROLE_FEATURES[role] ?? [],
  };
};

const normalizeAccess = (data: any): AdminAccess => {
  const features = Array.isArray(data?.features)
    ? data.features.filter((feature: unknown): feature is string => typeof feature === 'string')
    : [];

  return {
    hasAccess: Boolean(data?.has_access),
    roleId: typeof data?.role_id === 'string' ? data.role_id : null,
    roleKey: typeof data?.role_key === 'string' ? data.role_key : null,
    roleName: typeof data?.role_name === 'string' ? data.role_name : null,
    legacyRole: typeof data?.legacy_role === 'string' ? data.legacy_role : null,
    roleLegacyRole: typeof data?.role_legacy_role === 'string' ? data.role_legacy_role : null,
    isSuperAdmin: Boolean(data?.is_super_admin),
    features,
  };
};

export const getCurrentAdminAccess = async (): Promise<AdminAccess> => {
  try {
    const { data, error } = await supabase.rpc('admin_get_current_access');
    if (error) throw error;
    const access = normalizeAccess(data);
    if (access.hasAccess || access.legacyRole) return access;
  } catch (error) {
    console.warn('Falling back to legacy admin role access:', error);
  }

  const role = await getUserRole();
  return legacyAccess(role);
};

export const adminAccessHasFeature = (access: AdminAccess | null, featureKey: string): boolean => {
  if (!access?.hasAccess) return false;
  if (access.isSuperAdmin) return true;
  return access.features.includes(featureKey);
};
