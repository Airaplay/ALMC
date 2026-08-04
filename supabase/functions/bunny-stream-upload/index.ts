import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticateCaller } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface UploadResponse {
  success: boolean;
  videoId?: string;
  videoGuid?: string;
  publicUrl?: string;
  thumbnailUrl?: string;
  error?: string;
}

const ADMIN_STREAM_ROLES = new Set(["admin", "manager", "editor"]);

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ success: false, error: message } satisfies UploadResponse), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callerHasArtistProfile(
  supabase: ReturnType<typeof authenticateCaller> extends Promise<infer R>
    ? R extends { ok: true; supabase: infer S }
      ? S
      : never
    : never,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("artist_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("artist profile check failed:", error);
    return false;
  }
  return !!data;
}

async function callerCanOrgUpload(
  supabase: Parameters<typeof callerHasArtistProfile>[0],
  callerId: string,
  targetUserId: string,
  organizationId: string,
): Promise<boolean> {
  const { data: hasUpload, error: permError } = await supabase.rpc("org_member_has_permission", {
    p_org_id: organizationId,
    p_permission: "content.upload",
    p_user_id: callerId,
  });
  if (permError) {
    console.error("Org permission check failed:", permError);
    return false;
  }
  if (!hasUpload) return false;

  const { data: link, error: linkError } = await supabase
    .from("organization_artist_links")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", targetUserId)
    .eq("status", "active")
    .maybeSingle();
  if (linkError) {
    console.error("Org artist link check failed:", linkError);
    return false;
  }
  return !!link;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  const auth = await authenticateCaller(req, corsHeaders);
  if (!auth.ok) return auth.response;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const title = (formData.get("title") as string | null) ?? "";
    const collectionId = formData.get("collectionId") as string | null;
    const organizationId = (formData.get("organizationId") as string | null)?.trim() || null;
    const targetUserId = (formData.get("targetUserId") as string | null)?.trim() || null;

    if (!file) {
      return jsonError("No file provided", 400);
    }

    const role = (auth.role ?? "").toLowerCase();
    const isAdminStreamRole = auth.isServiceRole || ADMIN_STREAM_ROLES.has(role);

    if (!isAdminStreamRole) {
      if (organizationId && targetUserId && targetUserId !== auth.user.id) {
        const allowed = await callerCanOrgUpload(
          auth.supabase,
          auth.user.id,
          targetUserId,
          organizationId,
        );
        if (!allowed) {
          return jsonError(
            "Not authorized to upload video for this artist. Organization content.upload + active artist link required.",
            403,
          );
        }
        const targetIsCreator = await callerHasArtistProfile(auth.supabase, targetUserId);
        if (!targetIsCreator) {
          return jsonError("Target user is not registered as a creator", 403);
        }
      } else {
        const isCreator = await callerHasArtistProfile(auth.supabase, auth.user.id);
        if (!isCreator) {
          return jsonError("Insufficient role for this operation", 403);
        }
      }
    }

    const BUNNY_LIBRARY_ID = Deno.env.get("BUNNY_STREAM_LIBRARY_ID");
    const BUNNY_API_KEY = Deno.env.get("BUNNY_STREAM_API_KEY");
    const BUNNY_HOSTNAME = Deno.env.get("BUNNY_STREAM_HOSTNAME");

    if (!BUNNY_LIBRARY_ID || !BUNNY_API_KEY || !BUNNY_HOSTNAME) {
      throw new Error("Bunny Stream credentials not configured");
    }

    console.log(
      `Uploading file: ${file.name} (${file.size} bytes) by ${auth.user.id} (${auth.role ?? "unknown"})`,
    );

    const videoTitle = title || file.name.split(".")[0];

    const createVideoUrl = `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos`;
    const createVideoPayload: Record<string, unknown> = {
      title: videoTitle,
      moments: [],
      chapters: [],
    };

    if (collectionId) {
      createVideoPayload.collectionId = collectionId;
    }

    const createResponse = await fetch(createVideoUrl, {
      method: "POST",
      headers: {
        AccessKey: BUNNY_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(createVideoPayload),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error("Failed to create video:", errorText);
      throw new Error(`Failed to create video: ${createResponse.status} - ${errorText}`);
    }

    const videoData = (await createResponse.json()) as { guid: string; videoLibraryId: number };
    const videoGuid = videoData.guid;

    console.log(`Video created with GUID: ${videoGuid}`);

    const uploadUrl = `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${videoGuid}`;
    const fileBuffer = await file.arrayBuffer();

    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        AccessKey: BUNNY_API_KEY,
        "Content-Type": "application/octet-stream",
      },
      body: fileBuffer,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error("Failed to upload video:", errorText);
      throw new Error(`Failed to upload video: ${uploadResponse.status} - ${errorText}`);
    }

    const uploadResult = (await uploadResponse.json()) as {
      success: boolean;
      message: string;
      statusCode: number;
    };
    console.log("Upload result:", uploadResult);

    try {
      const configureResponse = await fetch(
        `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${videoGuid}`,
        {
          method: "POST",
          headers: {
            AccessKey: BUNNY_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            enableMP4Fallback: true,
            enableCDN: true,
          }),
        },
      );

      if (configureResponse.ok) {
        console.log("Configured video for optimized playback with caching");
      } else {
        console.warn("Failed to configure video settings, continuing anyway");
      }
    } catch (configError) {
      console.warn("Error configuring video settings:", configError);
    }

    const publicUrl = `https://${BUNNY_HOSTNAME}/${videoGuid}/playlist.m3u8`;
    const thumbnailUrl = `https://${BUNNY_HOSTNAME}/${videoGuid}/thumbnail.jpg`;

    if (!publicUrl.startsWith("https://")) {
      throw new Error(`Invalid URL protocol: ${publicUrl}`);
    }

    if (!BUNNY_HOSTNAME.includes(".b-cdn.net")) {
      throw new Error(`Invalid Bunny hostname: ${BUNNY_HOSTNAME}`);
    }

    if (!publicUrl.includes("/playlist.m3u8")) {
      throw new Error(`Invalid HLS URL format: ${publicUrl}`);
    }

    console.log(`Upload complete - Video ready for playback:
      - Video GUID: ${videoGuid}
      - Playback URL: ${publicUrl}
      - Thumbnail URL: ${thumbnailUrl}`);

    const response: UploadResponse = {
      success: true,
      videoId: videoGuid,
      videoGuid,
      publicUrl,
      thumbnailUrl,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Error uploading to Bunny Stream:", error);

    const errorResponse: UploadResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }
});
