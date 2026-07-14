import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function base64UrlSha256Async(plain: string): Promise<string> {
  const data = new TextEncoder().encode(plain);
  const buf = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  return b64.replace(/\n/g, "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function signBunnyCdnUrlAsync(
  url: string,
  securityKey: string,
  expirationSecondsFromNow: number,
  userIp: string | null,
): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + expirationSecondsFromNow;
  const parsedUrl = new URL(url);
  const parameters = new URLSearchParams(parsedUrl.search);
  const signaturePath = decodeURIComponent(parsedUrl.pathname);
  parameters.sort();

  let parameterData = "";
  let parameterDataUrl = "";
  parameters.forEach((value, key) => {
    if (value === "") return;
    if (key === "token" || key === "expires") return;
    if (parameterData.length > 0) parameterData += "&";
    parameterData += `${key}=${value}`;
    parameterDataUrl += `&${key}=${encodeURIComponent(value)}`;
  });

  const hashableBase =
    securityKey +
    signaturePath +
    String(expires) +
    (userIp != null && userIp !== "" ? userIp : "") +
    parameterData;

  const token = await base64UrlSha256Async(hashableBase);

  return `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}?token=${token}${parameterDataUrl}&expires=${expires}`;
}

function hostAllowed(hostname: string, patterns: string[]): boolean {
  const h = hostname.toLowerCase();
  return patterns.some((p) => p.startsWith(".") ? h.endsWith(p) || h === p.slice(1) : h === p || h.endsWith(`.${p}`));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing or invalid Authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: { song_id?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const songId = typeof body.song_id === "string" ? body.song_id.trim() : "";
    if (!songId) {
      return new Response(JSON.stringify({ error: "song_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: statusRaw, error: statusError } = await userClient.rpc("get_offline_download_status");
    if (statusError) {
      return new Response(JSON.stringify({ error: "status_check_failed", details: statusError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const status = statusRaw as { active?: boolean } | null;
    if (!status?.active) {
      return new Response(JSON.stringify({ error: "offline_download_not_active" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: song, error: songError } = await admin
      .from("songs")
      .select("id, audio_url")
      .eq("id", songId)
      .maybeSingle();

    if (songError || !song?.audio_url) {
      return new Response(JSON.stringify({ error: "song_not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const audioUrl = String(song.audio_url).trim();
    if (!audioUrl.startsWith("https://")) {
      return new Response(JSON.stringify({ error: "invalid_audio_url" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ttlSec = Math.min(
      Math.max(60, Number(Deno.env.get("OFFLINE_DOWNLOAD_URL_TTL_SECONDS") ?? "3600") || 3600),
      86400,
    );

    const hostPatterns = (Deno.env.get("BUNNY_SIGNED_URL_HOST_SUFFIXES") ?? "b-cdn.net")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    let parsed: URL;
    try {
      parsed = new URL(audioUrl);
    } catch {
      return new Response(JSON.stringify({ error: "invalid_audio_url" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const bunnyKey = Deno.env.get("BUNNY_CDN_TOKEN_AUTHENTICATION_KEY") ?? "";
    const useSigning = bunnyKey.length > 0 && hostAllowed(parsed.hostname, hostPatterns);

    if (useSigning) {
      const userIp = Deno.env.get("BUNNY_SIGN_INCLUDE_CLIENT_IP") === "1"
        ? (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "")
        : null;
      const signedUrl = await signBunnyCdnUrlAsync(audioUrl, bunnyKey, ttlSec, userIp || null);
      return new Response(
        JSON.stringify({
          url: signedUrl,
          signed: true,
          expires_in_seconds: ttlSec,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const allowUnsigned = Deno.env.get("ALLOW_UNSIGNED_OFFLINE_AUDIO_URL") === "1";
    if (!allowUnsigned && bunnyKey.length > 0 && !hostAllowed(parsed.hostname, hostPatterns)) {
      return new Response(
        JSON.stringify({
          error: "audio_host_not_configured_for_signing",
          hint: "Set BUNNY_SIGNED_URL_HOST_SUFFIXES or ALLOW_UNSIGNED_OFFLINE_AUDIO_URL=1 for dev.",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        url: audioUrl,
        signed: false,
        expires_in_seconds: null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "internal_error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
