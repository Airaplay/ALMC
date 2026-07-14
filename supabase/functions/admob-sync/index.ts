import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SyncRequest {
  config_id: string;
  sync_type: "manual" | "scheduled" | "test";
  date_from?: string;
  date_to?: string;
}

interface AdMobConfig {
  id: string;
  publisher_id: string;
  service_account_email: string;
  credentials_encrypted: string;
  sync_days_back: number;
  default_safety_buffer_percentage: number;
  auth_type?: "service_account" | "oauth2";
  oauth_client_id?: string | null;
  oauth_client_secret_encrypted?: string | null;
  oauth_refresh_token_encrypted?: string | null;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface AdMobReportRow {
  date: { year: number; month: number; day: number };
  adUnit: { adUnitId: string; displayName: string };
  metricValues: {
    ESTIMATED_EARNINGS?: { microsValue?: string };
    IMPRESSIONS?: { integerValue?: string };
    CLICKS?: { integerValue?: string };
  };
}

/** Decode JWT payload (no signature verify). Used only with sync_type=scheduled + role check; gateway still validates JWT on hosted Supabase. */
function decodeJwtPayloadUnsafe(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4;
    const padded = base64 + (pad === 0 ? "" : "=".repeat(4 - pad));
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)),
    );
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function projectRefFromSupabaseUrl(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.split(".")[0] ?? "";
  } catch {
    return "";
  }
}

function strClaim(payload: Record<string, unknown>, key: string): string {
  const v = payload[key];
  if (typeof v === "string") return v.trim();
  return "";
}

/**
 * True if JWT is a Supabase service_role for this project.
 * Legacy JWTs often use iss "supabase" + ref "<project_ref>"; others use iss URL with ref in hostname.
 */
function isServiceRoleJwtForThisProject(
  jwtPayload: Record<string, unknown> | null,
  supabaseUrl: string,
): boolean {
  if (!jwtPayload) return false;
  if (strClaim(jwtPayload, "role") !== "service_role") return false;

  const ref = projectRefFromSupabaseUrl(supabaseUrl);
  if (!ref) return false;

  const jwtRef =
    strClaim(jwtPayload, "ref") ||
    strClaim(jwtPayload, "project_id") ||
    strClaim(jwtPayload, "project_ref");
  if (jwtRef !== "" && jwtRef === ref) return true;

  const iss = strClaim(jwtPayload, "iss");
  if (iss.includes(ref)) return true;

  try {
    const u = new URL(iss);
    const hostFirst = u.hostname.split(".")[0];
    if (hostFirst === ref) return true;
  } catch {
    /* iss may not be a URL (e.g. "supabase") */
  }

  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Match scheduled pg_net calls: trim + case-insensitive "Bearer" (copy/paste safe)
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
    const isServiceRole =
      serviceKey.length > 0 && token.length > 0 && token === serviceKey;

    const requestData: SyncRequest = await req.json();
    const { config_id, sync_type, date_from, date_to } = requestData;

    if (!config_id) {
      return new Response(
        JSON.stringify({ error: "config_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const syncTypeNorm =
      typeof sync_type === "string" ? sync_type.trim().toLowerCase() : "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const jwtPayload = decodeJwtPayloadUnsafe(token);
    const allowScheduledPgNet =
      syncTypeNorm === "scheduled" &&
      (isServiceRole ||
        isServiceRoleJwtForThisProject(jwtPayload, supabaseUrl));

    // Auth:
    // - manual/test: require an authenticated admin user JWT
    // - scheduled: allow service-role from pg_net (exact env match OR JWT role=service_role for this project)
    // - scheduled: also allow admin user JWT (manual trigger with scheduled type)
    if (!allowScheduledPgNet) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: "Invalid authentication" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (userError || !userData || userData.role !== "admin") {
        return new Response(
          JSON.stringify({ error: "Admin access required" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Check rate limit for non-test operations
    if (sync_type !== "test") {
      const { data: rateLimitCheck, error: rateLimitError } = await supabase.rpc(
        "check_admob_sync_rate_limit",
        { p_config_id: config_id }
      );

      if (rateLimitError) {
        console.error("Rate limit check failed:", rateLimitError);
      } else if (rateLimitCheck && !rateLimitCheck.allowed) {
        return new Response(
          JSON.stringify({
            error: "Rate limit exceeded",
            reason: rateLimitCheck.reason,
            limit: rateLimitCheck.limit,
            current: rateLimitCheck.current,
            reset_at: rateLimitCheck.reset_at,
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const { data: configData, error: configError } = await supabase
      .from("admob_api_config")
      .select("*")
      .eq("id", config_id)
      .maybeSingle();

    if (configError || !configData) {
      return new Response(
        JSON.stringify({ error: "AdMob configuration not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const config: AdMobConfig = configData;

    if (sync_type === "test") {
      const testResult = await testAdMobConnection(config);

      // Keep status updates aligned with DB function/schema (last_error/last_error_at).
      await supabase.rpc("update_admob_connection_status", {
        p_config_id: config_id,
        p_status: testResult.success ? "connected" : "error",
        p_error: testResult.success ? null : (testResult.error ?? null),
      });

      return new Response(
        JSON.stringify(testResult),
        { status: testResult.success ? 200 : 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: syncRecord, error: syncRecordError } = await supabase
      .from("admob_sync_history")
      .insert({
        config_id: config_id,
        sync_type: sync_type,
        sync_status: "in_progress",
        date_range_start: date_from || getDateNDaysAgo(config.sync_days_back || 7),
        date_range_end: date_to || getYesterday(),
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (syncRecordError) {
      console.error("Failed to create sync record:", syncRecordError);
      return new Response(
        JSON.stringify({ error: "Failed to create sync record" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    try {
      const syncResult = await syncAdMobRevenue(supabase, config, syncRecord.id, {
        dateFrom: date_from || getDateNDaysAgo(config.sync_days_back || 7),
        dateTo: date_to || getYesterday(),
        safetyBuffer: config.default_safety_buffer_percentage || 75,
      });

      await supabase
        .from("admob_sync_history")
        .update({
          sync_status: "completed",
          completed_at: new Date().toISOString(),
          total_revenue_fetched: syncResult.totalRevenue,
          records_processed: syncResult.recordsProcessed,
          records_fetched: syncResult.recordsProcessed,
          error_message: null,
        })
        .eq("id", syncRecord.id);

      // Update config sync timestamps for UI + automation.
      await supabase
        .from("admob_api_config")
        .update({
          last_sync_at: new Date().toISOString(),
          next_sync_at: new Date(Date.now() + (Number(configData.sync_frequency_hours || 24) * 60 * 60 * 1000)).toISOString(),
          connection_status: "connected",
          last_error: null,
          last_error_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", config_id);

      // Record successful sync with quota tracking
      await supabase.rpc("record_admob_sync_success", {
        p_config_id: config_id,
        p_sync_id: syncRecord.id,
        p_api_calls: 1,
        p_rows_fetched: syncResult.recordsProcessed,
        p_revenue_fetched: syncResult.totalRevenue,
      });

      return new Response(
        JSON.stringify({
          success: true,
          sync_id: syncRecord.id,
          total_revenue: syncResult.totalRevenue,
          records_processed: syncResult.recordsProcessed,
          message: "AdMob revenue sync completed successfully",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (syncError) {
      const errorMessage = syncError instanceof Error ? syncError.message : "Unknown sync error";

      await supabase
        .from("admob_sync_history")
        .update({
          sync_status: "failed",
          completed_at: new Date().toISOString(),
          error_message: errorMessage,
        })
        .eq("id", syncRecord.id);

      await supabase
        .from("admob_api_config")
        .update({
          connection_status: "error",
          last_error: errorMessage,
          last_error_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", config_id);

      // Log the error with enhanced tracking
      await supabase.rpc("log_admob_error", {
        p_config_id: config_id,
        p_sync_id: syncRecord.id,
        p_error_type: "api_error",
        p_error_message: errorMessage,
        p_operation: "sync",
        p_severity: "error",
      });

      return new Response(
        JSON.stringify({ error: errorMessage }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("AdMob sync error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function testAdMobConnection(config: AdMobConfig): Promise<{ success: boolean; error?: string; account_info?: any }> {
  try {
    const authType = config.auth_type ?? "service_account";
    let accessToken: string | null = null;
    console.log("[admob-sync][test] Starting connection test", {
      config_id: config.id,
      auth_type: authType,
      has_service_account_payload: Boolean(config.credentials_encrypted),
      has_oauth_client_id: Boolean(config.oauth_client_id),
      has_oauth_client_secret: Boolean(config.oauth_client_secret_encrypted),
      has_oauth_refresh_token: Boolean(config.oauth_refresh_token_encrypted),
      publisher_id: config.publisher_id,
    });

    if (authType === "oauth2") {
      const clientId = config.oauth_client_id ?? null;
      const clientSecret = config.oauth_client_secret_encrypted ?? null;
      const refreshToken = config.oauth_refresh_token_encrypted ?? null;

      if (!clientId || !clientSecret || !refreshToken) {
        return { success: false, error: "Missing OAuth2 credentials (client_id, client_secret, refresh_token)" };
      }

      accessToken = await getOAuth2AccessToken({
        clientId,
        clientSecret,
        refreshToken,
      });
    } else {
      if (!config.credentials_encrypted) {
        return { success: false, error: "No service account credentials configured" };
      }

      const credentials = JSON.parse(config.credentials_encrypted);

      if (!credentials.client_email || !credentials.private_key) {
        return { success: false, error: "Invalid service account credentials format" };
      }

      accessToken = await getGoogleAccessToken(credentials);
    }

    if (!accessToken) {
      console.error("[admob-sync][test] Failed to obtain access token");
      return { success: false, error: "Failed to obtain access token" };
    }

    try {
      const tokenInfoResponse = await fetch(
        `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
      );
      if (tokenInfoResponse.ok) {
        const tokenInfo = await tokenInfoResponse.json();
        console.log("[admob-sync][oauth2] tokeninfo", {
          issued_to: tokenInfo?.issued_to ?? null,
          audience: tokenInfo?.audience ?? null,
          scope: tokenInfo?.scope ?? null,
          expires_in: tokenInfo?.expires_in ?? null,
        });
      } else {
        console.error("[admob-sync][oauth2] tokeninfo failed", {
          status: tokenInfoResponse.status,
          statusText: tokenInfoResponse.statusText,
          body: await tokenInfoResponse.text(),
        });
      }
    } catch (tokenInfoError) {
      console.error("[admob-sync][oauth2] tokeninfo request threw", tokenInfoError);
    }

    const accountsResponse = await fetch(
      `https://admob.googleapis.com/v1/accounts`,
      {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!accountsResponse.ok) {
      const errorData = await accountsResponse.json();
      console.error("[admob-sync][test] AdMob accounts call failed", {
        status: accountsResponse.status,
        statusText: accountsResponse.statusText,
        google_error: errorData?.error ?? null,
      });
      return {
        success: false,
        error: `AdMob API error: ${errorData.error?.message || accountsResponse.statusText}`
      };
    }

    const accountsData = await accountsResponse.json();
    console.log("[admob-sync][test] AdMob accounts call succeeded", {
      account_count: Array.isArray(accountsData?.account) ? accountsData.account.length : 0,
    });

    return {
      success: true,
      account_info: {
        accounts: accountsData.account || [],
        publisher_id: config.publisher_id,
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Connection test failed"
    };
  }
}

async function getGoogleAccessToken(credentials: { client_email: string; private_key: string }): Promise<string | null> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 3600;

    const header = {
      alg: "RS256",
      typ: "JWT",
    };

    const payload = {
      iss: credentials.client_email,
      scope: "https://www.googleapis.com/auth/admob.report",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: expiry,
    };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signatureInput = `${encodedHeader}.${encodedPayload}`;

    const signature = await signWithRSA(credentials.private_key, signatureInput);
    const jwt = `${signatureInput}.${signature}`;

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });

    if (!tokenResponse.ok) {
      console.error("Token request failed:", await tokenResponse.text());
      return null;
    }

    const tokenData: GoogleTokenResponse = await tokenResponse.json();
    return tokenData.access_token;
  } catch (error) {
    console.error("Failed to get access token:", error);
    return null;
  }
}

function base64UrlEncode(str: string): string {
  const base64 = btoa(str);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function signWithRSA(privateKeyPem: string, data: string): Promise<string> {
  const pemContents = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\n/g, "");

  const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );

  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const signatureBuffer = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, dataBuffer);

  const signatureArray = new Uint8Array(signatureBuffer);
  const base64Signature = btoa(String.fromCharCode(...signatureArray));
  return base64Signature.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function syncAdMobRevenue(
  supabase: any,
  config: AdMobConfig,
  syncId: string,
  options: { dateFrom: string; dateTo: string; safetyBuffer: number }
): Promise<{ totalRevenue: number; recordsProcessed: number }> {
  const authType = config.auth_type ?? "service_account";
  let accessToken: string | null = null;

  if (authType === "oauth2") {
    const clientId = config.oauth_client_id ?? null;
    const clientSecret = config.oauth_client_secret_encrypted ?? null;
    const refreshToken = config.oauth_refresh_token_encrypted ?? null;

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error("Missing OAuth2 credentials (client_id, client_secret, refresh_token)");
    }

    accessToken = await getOAuth2AccessToken({
      clientId,
      clientSecret,
      refreshToken,
    });
  } else {
    const credentials = JSON.parse(config.credentials_encrypted);
    accessToken = await getGoogleAccessToken(credentials);
  }

  if (!accessToken) {
    throw new Error("Failed to obtain access token for sync");
  }

  const dateFrom = parseDateString(options.dateFrom);
  const dateTo = parseDateString(options.dateTo);

  const reportRequest = {
    reportSpec: {
      dateRange: {
        startDate: { year: dateFrom.year, month: dateFrom.month, day: dateFrom.day },
        endDate: { year: dateTo.year, month: dateTo.month, day: dateTo.day },
      },
      dimensions: ["DATE", "AD_UNIT"],
      metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "CLICKS"],
      dimensionFilters: [],
      sortConditions: [{ dimension: "DATE", order: "ASCENDING" }],
    },
  };

  const reportResponse = await fetch(
    `https://admob.googleapis.com/v1/accounts/${config.publisher_id}/networkReport:generate`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reportRequest),
    }
  );

  if (!reportResponse.ok) {
    const errorData = await reportResponse.json();
    throw new Error(`AdMob Report API error: ${errorData.error?.message || reportResponse.statusText}`);
  }

  const reportData = await reportResponse.json();

  let totalRevenue = 0;
  let recordsProcessed = 0;
  // In this system, safety_buffer_percentage represents the USABLE percentage (e.g. 75 => usable = total * 0.75).
  const usableMultiplier = Math.max(0, Math.min(1, options.safetyBuffer / 100));

  const dailyRevenues: Record<string, {
    gross: number;
    usable: number;
    impressions: number;
    clicks: number;
    banner: number;
    interstitial: number;
    rewarded: number;
    native: number;
  }> = {};

  if (reportData && Array.isArray(reportData)) {
    for (const row of reportData) {
      if (row.row) {
        const dateValue = row.row.dimensionValues?.DATE?.value;
        const earnings = row.row.metricValues?.ESTIMATED_EARNINGS?.microsValue;
        const impressions = row.row.metricValues?.IMPRESSIONS?.integerValue || "0";
        const clicks = row.row.metricValues?.CLICKS?.integerValue || "0";
        const adUnitName = (row.row.dimensionValues?.AD_UNIT?.displayLabel || row.row.dimensionValues?.AD_UNIT?.value || "")
          .toString()
          .toLowerCase();

        if (dateValue && earnings) {
          const grossRevenue = parseInt(earnings, 10) / 1000000;
          const usableRevenue = grossRevenue * usableMultiplier;

          if (!dailyRevenues[dateValue]) {
            dailyRevenues[dateValue] = {
              gross: 0,
              usable: 0,
              impressions: 0,
              clicks: 0,
              banner: 0,
              interstitial: 0,
              rewarded: 0,
              native: 0,
            };
          }

          dailyRevenues[dateValue].gross += grossRevenue;
          dailyRevenues[dateValue].usable += usableRevenue;
          dailyRevenues[dateValue].impressions += parseInt(impressions, 10);
          dailyRevenues[dateValue].clicks += parseInt(clicks, 10);

          // Best-effort ad type breakdown based on ad unit name.
          if (adUnitName.includes("reward")) dailyRevenues[dateValue].rewarded += grossRevenue;
          else if (adUnitName.includes("interstitial")) dailyRevenues[dateValue].interstitial += grossRevenue;
          else if (adUnitName.includes("native")) dailyRevenues[dateValue].native += grossRevenue;
          else if (adUnitName.includes("banner")) dailyRevenues[dateValue].banner += grossRevenue;

          totalRevenue += usableRevenue;
          recordsProcessed++;
        }
      }
    }
  }

  for (const [date, revenue] of Object.entries(dailyRevenues)) {
    const formattedDate = formatDateForDb(date);

    // Don't overwrite locked entries.
    const { data: existing, error: existingError } = await supabase
      .from("ad_daily_revenue_input")
      .select("id, is_locked")
      .eq("revenue_date", formattedDate)
      .maybeSingle();

    if (existingError) {
      console.error(`Failed to check existing revenue for ${formattedDate}:`, existingError);
    }

    if (existing?.is_locked) {
      continue;
    }

    const { error: upsertError } = await supabase
      .from("ad_daily_revenue_input")
      .upsert({
        revenue_date: formattedDate,
        total_revenue_usd: revenue.gross,
        banner_revenue: revenue.banner,
        interstitial_revenue: revenue.interstitial,
        rewarded_revenue: revenue.rewarded,
        native_revenue: revenue.native,
        safety_buffer_percentage: options.safetyBuffer,
        source: "admob_api",
        sync_id: syncId,
        notes: `Synced from AdMob API (sync_id=${syncId}).`,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "revenue_date",
      });

    if (upsertError) {
      console.error(`Failed to upsert revenue for ${date}:`, upsertError);
    }
  }

  return { totalRevenue, recordsProcessed };
}

function getDateNDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split("T")[0];
}

function getYesterday(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().split("T")[0];
}

function parseDateString(dateStr: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateStr.split("-").map(Number);
  return { year, month, day };
}

function formatDateForDb(dateStr: string): string {
  if (dateStr.includes("-")) {
    return dateStr;
  }
  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(4, 6);
  const day = dateStr.substring(6, 8);
  return `${year}-${month}-${day}`;
}

async function getOAuth2AccessToken(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<string | null> {
  try {
    console.log("[admob-sync][oauth2] Refreshing OAuth2 access token", {
      client_id_suffix: params.clientId.slice(-8),
      has_client_secret: Boolean(params.clientSecret),
      has_refresh_token: Boolean(params.refreshToken),
    });

    const body = new URLSearchParams();
    body.set("client_id", params.clientId);
    body.set("client_secret", params.clientSecret);
    body.set("refresh_token", params.refreshToken);
    body.set("grant_type", "refresh_token");

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!tokenResponse.ok) {
      console.error("[admob-sync][oauth2] Refresh token request failed", {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        body: await tokenResponse.text(),
      });
      return null;
    }

    const tokenData: GoogleTokenResponse = await tokenResponse.json();
    console.log("[admob-sync][oauth2] Access token refresh succeeded", {
      token_type: tokenData.token_type,
      expires_in: tokenData.expires_in,
      has_access_token: Boolean(tokenData.access_token),
    });
    return tokenData.access_token;
  } catch (error) {
    console.error("[admob-sync][oauth2] Failed to refresh OAuth2 access token", error);
    return null;
  }
}