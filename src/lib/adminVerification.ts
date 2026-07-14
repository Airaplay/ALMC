import { supabase } from './supabase';

export interface AdminVerificationResult {
  isAdmin: boolean;
  isManager: boolean;
  error?: string;
}

export async function verifyAdminRole(): Promise<AdminVerificationResult> {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        isAdmin: false,
        isManager: false,
        error: 'Authentication required'
      };
    }

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userError || !userData) {
      return {
        isAdmin: false,
        isManager: false,
        error: 'Unable to verify user role'
      };
    }

    return {
      isAdmin: userData.role === 'admin',
      isManager: userData.role === 'manager' || userData.role === 'admin',
      error: undefined
    };
  } catch (error) {
    console.error('Admin verification error:', error);
    return {
      isAdmin: false,
      isManager: false,
      error: 'Verification failed'
    };
  }
}

export async function requireAdminRole(): Promise<boolean> {
  const result = await verifyAdminRole();

  if (!result.isAdmin) {
    throw new Error(result.error || 'Admin access required');
  }

  return true;
}

export async function requireManagerRole(): Promise<boolean> {
  const result = await verifyAdminRole();

  if (!result.isManager) {
    throw new Error(result.error || 'Manager or admin access required');
  }

  return true;
}

export async function checkAdminAction(actionName: string): Promise<boolean> {
  const result = await verifyAdminRole();

  if (!result.isAdmin) {
    console.warn(`Unauthorized admin action attempted: ${actionName}`);
    return false;
  }

  console.log(`Admin action authorized: ${actionName}`);
  return true;
}
