import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { jwtDecode } from "npm:jwt-decode@4.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface UploadResponse {
  success: boolean;
  publicUrl?: string;
  error?: string;
  cached?: boolean;
}

async function validateUserAuth(req: Request): Promise<string> {
  const authHeader = req.headers.get("Authorization");

  if (!authHeader) {
    throw new Error("Missing Authorization header");
  }

  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("Invalid Authorization header format");
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwtDecode<{ sub: string; exp: number }>(token);

    if (!decoded.sub) {
      throw new Error("Invalid token: missing user ID");
    }

    if (decoded.exp && decoded.exp * 1000 < Date.now()) {
      throw new Error("Token has expired");
    }

    return decoded.sub;
  } catch (err) {
    if (err instanceof Error && err.message.includes("expired")) {
      throw new Error("Token has expired");
    }
    throw new Error("Invalid or malformed token");
  }
}

function getServiceClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Supabase credentials not configured");
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey);
}

async function verifyUserIsCreator(userId: string): Promise<void> {
  if (!userId) return;

  const supabase = getServiceClient();

  const { data: artistProfile, error } = await supabase
    .from("artist_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Error checking artist profile:", error);
    throw new Error("Failed to verify user permissions");
  }

  if (!artistProfile) {
    throw new Error("User is not registered as a creator");
  }
}

async function verifyUploadPermission(
  authenticatedUserId: string,
  targetUserId: string | null,
): Promise<void> {
  const supabase = getServiceClient();
  const { data: caller, error } = await supabase
    .from("users")
    .select("role")
    .eq("id", authenticatedUserId)
    .maybeSingle();

  if (error) {
    console.error("Error checking caller role:", error);
    throw new Error("Failed to verify user permissions");
  }

  const role = caller?.role ?? "";
  const isAdminOrManager = role === "admin" || role === "manager";

  if (isAdminOrManager && targetUserId && targetUserId !== authenticatedUserId) {
    await verifyUserIsCreator(targetUserId);
    return;
  }

  if (!isAdminOrManager && targetUserId && targetUserId !== authenticatedUserId) {
    throw new Error("Not authorized to upload on behalf of another user");
  }

  await verifyUserIsCreator(authenticatedUserId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    // Validate authentication - REQUIRED
    let authenticatedUserId: string;

    try {
      authenticatedUserId = await validateUserAuth(req);
      console.log(`✅ Authenticated user: ${authenticatedUserId}`);
    } catch (authError) {
      console.error("Auth validation failed:", authError instanceof Error ? authError.message : authError);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Authentication required",
          details: authError instanceof Error ? authError.message : "Unknown authentication error"
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const formData = await req.formData();
    const clientUserId = formData.get("userId") as string | null;

    // Verify caller can upload (creators for self; admins/managers for target user)
    try {
      await verifyUploadPermission(authenticatedUserId, clientUserId);
      console.log(`✅ Upload permission verified`);
    } catch (authError) {
      console.error("Upload permission check failed:", authError instanceof Error ? authError.message : authError);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Creator verification required",
          details: authError instanceof Error ? authError.message : "User is not registered as a creator"
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const BUNNY_STORAGE_ZONE = Deno.env.get("BUNNY_STORAGE_ZONE");
    const BUNNY_STORAGE_API_KEY = Deno.env.get("BUNNY_STORAGE_API_KEY");
    let BUNNY_CDN_HOSTNAME = Deno.env.get("BUNNY_CDN_HOSTNAME") || "airaplay.b-cdn.net";
    const BUNNY_STORAGE_ENDPOINT = Deno.env.get("BUNNY_STORAGE_ENDPOINT") || "uk.storage.bunnycdn.com";

    // Normalize CDN hostname - ensure it has .b-cdn.net suffix
    if (!BUNNY_CDN_HOSTNAME.includes(".b-cdn.net")) {
      console.warn(`⚠️ CDN hostname "${BUNNY_CDN_HOSTNAME}" is missing .b-cdn.net suffix. Correcting to: ${BUNNY_CDN_HOSTNAME}.b-cdn.net`);
      BUNNY_CDN_HOSTNAME = `${BUNNY_CDN_HOSTNAME}.b-cdn.net`;
    }

    // Ensure hostname is lowercase
    BUNNY_CDN_HOSTNAME = BUNNY_CDN_HOSTNAME.toLowerCase();

    console.log("Bunny configuration:", {
      zone: BUNNY_STORAGE_ZONE,
      storageEndpoint: BUNNY_STORAGE_ENDPOINT,
      cdnHostname: BUNNY_CDN_HOSTNAME,
      hasApiKey: !!BUNNY_STORAGE_API_KEY,
    });

    if (!BUNNY_STORAGE_ZONE || !BUNNY_STORAGE_API_KEY) {
      const missingVars = [];
      if (!BUNNY_STORAGE_ZONE) missingVars.push("BUNNY_STORAGE_ZONE");
      if (!BUNNY_STORAGE_API_KEY) missingVars.push("BUNNY_STORAGE_API_KEY");

      throw new Error(`Bunny Storage is not configured. Missing environment variables: ${missingVars.join(", ")}. Please configure these in your Supabase project settings.`);
    }

    const file = formData.get("file") as File;
    const contentType = formData.get("contentType") as string;
    const customPath = formData.get("customPath") as string;

    if (clientUserId && authenticatedUserId && clientUserId !== authenticatedUserId) {
      console.log(`Admin upload on behalf of user: target=${clientUserId}, caller=${authenticatedUserId}`);
    }

    if (!file) {
      throw new Error("No file provided");
    }

    console.log(`📊 File info: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

    // Sanitize filename: remove special characters, keep alphanumeric, hyphens, underscores, and dots
    const sanitizeFilename = (filename: string): string => {
      const nameParts = filename.split('.');
      const extension = nameParts.pop() || '';
      const nameWithoutExt = nameParts.join('.');

      // Replace spaces with hyphens, remove special characters except hyphens and underscores
      const sanitized = nameWithoutExt
        .replace(/\s+/g, '-')
        .replace(/[^a-zA-Z0-9\-_]/g, '')
        .toLowerCase();

      return extension ? `${sanitized}.${extension}` : sanitized;
    };

    // Always use original filename with timestamp prefix for readability
    console.log('⚡ Using original filename with timestamp prefix');
    const sanitizedName = sanitizeFilename(file.name);
    const timestamp = Date.now();
    const fileName = `${timestamp}_${sanitizedName}`;

    const storagePath = `${customPath || contentType}/${fileName}`;

    console.log(`📂 Storage path: ${storagePath}`);

    console.log(`Uploading new file: ${fileName} (${file.size} bytes)`);
    const uploadUrl = `https://${BUNNY_STORAGE_ENDPOINT}/${BUNNY_STORAGE_ZONE}/${storagePath}`;

    console.log(`Upload URL: ${uploadUrl}`);
    console.log(`API Key (first 10 chars): ${BUNNY_STORAGE_API_KEY.substring(0, 10)}...`);
    console.log(`File size: ${(file.size / 1024 / 1024).toFixed(2)} MB`);

    let uploadResponse: Response;
    if (file.size > 10 * 1024 * 1024) {
      console.log('⚡ Using streaming upload for large file');

      const fileStream = file.stream();

      uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "AccessKey": BUNNY_STORAGE_API_KEY,
          "Content-Type": file.type || "application/octet-stream",
          "Content-Length": file.size.toString(),
          "Cache-Control": "public, max-age=2592000",
          "CDN-Cache-Control": "public, max-age=2592000",
        },
        body: fileStream,
        duplex: "half" as RequestDuplex,
      });
    } else {
      console.log('📦 Using buffer upload for small file');
      const fileBuffer = await file.arrayBuffer();

      uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "AccessKey": BUNNY_STORAGE_API_KEY,
          "Content-Type": file.type || "application/octet-stream",
          "Cache-Control": "public, max-age=2592000",
          "CDN-Cache-Control": "public, max-age=2592000",
        },
        body: fileBuffer,
      });
    }

    console.log(`Upload response status: ${uploadResponse.status}`);

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error(`Failed to upload file: ${uploadResponse.status} - ${errorText}`);

      if (uploadResponse.status === 401) {
        throw new Error(`Bunny Storage authentication failed (401). The API key is invalid or expired. Please update BUNNY_STORAGE_API_KEY in your Supabase project settings.`);
      } else if (uploadResponse.status === 403) {
        throw new Error(`Bunny Storage access denied (403). The API key doesn't have permission to upload to this storage zone.`);
      } else if (uploadResponse.status === 404) {
        throw new Error(`Bunny Storage zone not found (404). Please verify BUNNY_STORAGE_ZONE is correct.`);
      } else {
        throw new Error(`Bunny Storage upload failed (${uploadResponse.status}): ${errorText}`);
      }
    }

    const publicUrl = `https://${BUNNY_CDN_HOSTNAME}/${storagePath}`;
    console.log(`✅ File uploaded successfully: ${publicUrl}`);

    return new Response(
      JSON.stringify({
        success: true,
        publicUrl: publicUrl,
        cached: false,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600",
        },
      }
    );
  } catch (error) {
    console.error("Error uploading to Bunny Storage:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
