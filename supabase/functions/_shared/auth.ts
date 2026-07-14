/**
 * Shared authentication / authorization helpers for Supabase Edge Functions.
 *
 * Always derive the caller from the bearer token. Never trust user_id or role
 * from the request body — those are caller-controlled and forgeable.
 *
 * Usage:
 *   const auth = await requireAdminCaller(req);
 *   if (!auth.ok) return auth.response;       // already-formatted 401/403
 *   const { user, role, supabase } = auth;    // service-role client + verified caller
 */

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type AdminPortalRole = 'admin' | 'manager' | 'editor' | 'account';

export const ADMIN_PORTAL_ROLES: readonly AdminPortalRole[] = [
  'admin',
  'manager',
  'editor',
  'account',
];

export interface AuthFailure {
  ok: false;
  response: Response;
}

export interface AuthSuccess {
  ok: true;
  /** Service-role Supabase client (bypasses RLS) — use only after caller is verified. */
  supabase: SupabaseClient;
  /** Verified Supabase auth user derived from the JWT. */
  user: { id: string; email: string | null };
  /** Caller role from `public.users.role`, lowercased. Null when no profile row exists. */
  role: string | null;
  /** Bearer token (without `Bearer ` prefix). Never echo this back to clients. */
  bearer: string;
  /** True when the caller is the Supabase service role (server-to-server). */
  isServiceRole: boolean;
}

export type AuthResult = AuthSuccess | AuthFailure;

function jsonResponse(body: unknown, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

function getServiceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return createClient(url, key, { auth: { persistSession: false } });
}

function extractBearer(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith('bearer ')) return null;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Verify the caller's bearer token and look up their role.
 * Returns a verified caller plus a service-role client (RLS-bypassing) for downstream work.
 *
 * If the token equals the service role key, returns `isServiceRole=true` and a synthetic
 * user record (id == 'service_role'), so server-to-server callers don't need a profile row.
 */
export async function authenticateCaller(req: Request, corsHeaders: HeadersInit): Promise<AuthResult> {
  const bearer = extractBearer(req);
  if (!bearer) {
    return {
      ok: false,
      response: jsonResponse({ error: 'Authorization bearer token required' }, 401, corsHeaders),
    };
  }

  const supabase = getServiceClient();

  // Server-to-server: caller presented the service role key.
  const serviceKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();
  if (serviceKey && bearer === serviceKey) {
    return {
      ok: true,
      supabase,
      user: { id: 'service_role', email: null },
      role: 'service_role',
      bearer,
      isServiceRole: true,
    };
  }

  const { data: userResult, error: authError } = await supabase.auth.getUser(bearer);
  if (authError || !userResult?.user) {
    return {
      ok: false,
      response: jsonResponse({ error: 'Invalid or expired token' }, 401, corsHeaders),
    };
  }

  const user = userResult.user;
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    return {
      ok: false,
      response: jsonResponse({ error: 'Failed to verify caller profile' }, 500, corsHeaders),
    };
  }

  const role = (profile?.role ?? null) as string | null;
  const normalizedRole = typeof role === 'string' ? role.toLowerCase() : null;

  return {
    ok: true,
    supabase,
    user: { id: user.id, email: user.email ?? null },
    role: normalizedRole,
    bearer,
    isServiceRole: false,
  };
}

/**
 * Authenticate the caller and require they hold one of the given portal roles
 * (or be the service role). Defaults to admin-only.
 */
export async function requireRoleCaller(
  req: Request,
  corsHeaders: HeadersInit,
  allowedRoles: readonly string[] = ['admin'],
): Promise<AuthResult> {
  const result = await authenticateCaller(req, corsHeaders);
  if (!result.ok) return result;

  if (result.isServiceRole) return result;

  const allowed = new Set(allowedRoles.map((r) => r.toLowerCase()));
  if (!result.role || !allowed.has(result.role)) {
    return {
      ok: false,
      response: jsonResponse(
        { error: 'Insufficient role for this operation' },
        403,
        corsHeaders,
      ),
    };
  }

  return result;
}

/**
 * Convenience: require the caller is an authenticated user (any role).
 * Use for endpoints where the user must be signed in but role doesn't matter
 * (e.g. paying for their own treats).
 */
export async function requireAuthenticatedCaller(
  req: Request,
  corsHeaders: HeadersInit,
): Promise<AuthResult> {
  const result = await authenticateCaller(req, corsHeaders);
  if (!result.ok) return result;
  return result;
}

/**
 * Convenience: require the caller is an admin or one of the admin portal roles.
 */
export async function requireAdminCaller(
  req: Request,
  corsHeaders: HeadersInit,
): Promise<AuthResult> {
  return requireRoleCaller(req, corsHeaders, ADMIN_PORTAL_ROLES);
}
