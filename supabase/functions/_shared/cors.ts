/**
 * Centralized CORS Configuration
 *
 * Security: Restricts origins to specific domains instead of wildcard (*)
 * This prevents unauthorized cross-origin requests from malicious sites.
 */

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://vwcadgjaivvffxwgnkzy.supabase.co', // Production
  'http://localhost:5173', // Local development
  'http://localhost:5174', // Alternative local port
  'capacitor://localhost', // Capacitor mobile app
  'ionic://localhost', // Ionic mobile app
  'airaplay://localhost', // Custom app scheme
];

/**
 * Get CORS headers for a given origin
 * @param origin - The requesting origin from request headers
 * @returns CORS headers object
 */
export function getCorsHeaders(origin: string | null): Record<string, string> {
  // Check if origin is in allowed list
  const allowedOrigin = origin && ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0]; // Default to production

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
    'Access-Control-Max-Age': '86400', // 24 hours
  };
}

/**
 * Get simple CORS headers (for backward compatibility)
 * Uses production origin as default
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
  'Access-Control-Max-Age': '86400',
};

/**
 * Handle OPTIONS preflight request
 * @param req - The incoming request
 * @returns Response with CORS headers
 */
export function handleCors(req: Request): Response {
  const origin = req.headers.get('origin');
  const headers = getCorsHeaders(origin);

  return new Response(null, {
    status: 200,
    headers,
  });
}
