import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticateCaller } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type Json = Record<string, unknown>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function assertOrgInvitePermission(
  supabase: ReturnType<typeof authenticateCaller> extends Promise<infer R>
    ? R extends { ok: true; supabase: infer S }
      ? S
      : never
    : never,
  orgId: string,
  userId: string,
): Promise<void> {
  const { data: allowed, error } = await supabase.rpc("org_member_has_permission", {
    p_org_id: orgId,
    p_permission: "artists.invite",
    p_user_id: userId,
  });
  if (error) throw new Error(error.message || "Failed to verify permission");
  if (!allowed) throw new Error("Missing artists.invite permission");
}

async function findAuthUserIdByEmail(
  supabase: Parameters<typeof assertOrgInvitePermission>[0],
  email: string,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return null;

  try {
    const response = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
      {
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
        },
      },
    );
    if (!response.ok) return null;
    const payload = await response.json();
    const users = Array.isArray(payload?.users)
      ? payload.users
      : Array.isArray(payload)
        ? payload
        : payload?.id
          ? [payload]
          : [];
    const match = users.find(
      (u: { email?: string; id?: string }) => (u.email ?? "").toLowerCase() === email,
    );
    return match?.id ?? null;
  } catch (err) {
    console.warn("auth admin email lookup failed:", err);
    return null;
  }
}

async function ensureAuthAndPublicUser(
  supabase: Parameters<typeof assertOrgInvitePermission>[0],
  email: string,
  stageName: string,
): Promise<string> {
  let userId = await findAuthUserIdByEmail(supabase, email);

  if (!userId) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        display_name: stageName,
        signup_source: "almc_org_created",
      },
    });
    if (error) {
      // Race: user may have been created concurrently.
      const msg = error.message || "";
      if (/already|registered|exists/i.test(msg)) {
        userId = await findAuthUserIdByEmail(supabase, email);
      }
      if (!userId) throw new Error(msg || "Failed to create artist account");
    } else {
      userId = data.user?.id ?? null;
    }
  }

  if (!userId) throw new Error("Failed to resolve artist account");

  const { error: upsertError } = await supabase.from("users").upsert(
    {
      id: userId,
      email,
      display_name: stageName || email.split("@")[0],
      role: "listener",
      country_last_changed_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (upsertError) {
    throw new Error(upsertError.message || "Failed to create user profile");
  }

  return userId;
}

async function ensureArtistProfile(
  supabase: Parameters<typeof assertOrgInvitePermission>[0],
  userId: string,
  metadata: Json,
): Promise<string> {
  const { data: profileId, error } = await supabase.rpc(
    "create_artist_profile_from_invite_metadata",
    {
      p_user_id: userId,
      p_metadata: metadata,
    },
  );
  if (error) throw new Error(error.message || "Failed to create artist profile");
  if (!profileId) throw new Error("Artist profile was not created");
  return profileId as string;
}

async function activateOrgLink(
  supabase: Parameters<typeof assertOrgInvitePermission>[0],
  orgId: string,
  artistProfileId: string,
  userId: string,
  permissionPreset: string,
  createdBy: string,
): Promise<void> {
  const preset = (permissionPreset || "full_management").toLowerCase();
  const permissions =
    preset === "view_only"
      ? ["content.view"]
      : preset === "upload_only"
        ? ["content.view", "content.upload"]
        : ["content.view", "content.upload", "content.promote", "treats.buy"];

  const { error } = await supabase.from("organization_artist_links").upsert(
    {
      organization_id: orgId,
      artist_profile_id: artistProfileId,
      user_id: userId,
      status: "active",
      linked_at: new Date().toISOString(),
      permission_preset: preset,
      custom_permissions: permissions,
      created_by: createdBy,
      revoked_at: null,
      revoked_by: null,
    },
    { onConflict: "organization_id,artist_profile_id" },
  );
  if (error) throw new Error(error.message || "Failed to link artist to organization");
}

async function queueClaimEmail(
  _supabase: Parameters<typeof assertOrgInvitePermission>[0],
  email: string,
  _userId: string,
  _orgId: string,
  stageName: string,
): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) return;

    // Send a password-recovery link so the artist can claim the account.
    await fetch(`${supabaseUrl}/auth/v1/recover`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        data: { display_name: stageName, signup_source: "almc_org_created" },
      }),
    });
  } catch (err) {
    console.warn("claim email failed:", err);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const auth = await authenticateCaller(req, corsHeaders);
  if (!auth.ok) return auth.response;
  if (auth.isServiceRole) {
    return json({ error: "User session required" }, 401);
  }

  try {
    const body = (await req.json()) as Json;
    const action = String(body.action ?? "create");
    const organizationId = String(body.organizationId ?? "").trim();
    const email = normalizeEmail(String(body.email ?? ""));

    if (!organizationId) return json({ error: "organizationId is required" }, 400);
    if (!email || !email.includes("@")) return json({ error: "Valid email is required" }, 400);

    await assertOrgInvitePermission(auth.supabase, organizationId, auth.user.id);

    if (action === "confirm") {
      const code = String(body.code ?? "")
        .replace(/[^A-Za-z0-9]/g, "")
        .toUpperCase();
      if (code.length < 8) return json({ error: "Verification code is required" }, 400);

      const { data: inv, error: invError } = await auth.supabase
        .from("organization_artist_invitations")
        .select("*")
        .eq("organization_id", organizationId)
        .ilike("invitee_email", email)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .or(`invitation_code.eq.${code},token_hash.eq.${code}`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (invError) throw new Error(invError.message);
      if (!inv) return json({ error: "Verification code does not match this invitation" }, 400);

      const metadata = (inv.artist_metadata ?? {}) as Json;
      const invitationType = String(inv.invitation_type ?? "link_existing");
      const permissionPreset = String(metadata.permission_preset ?? "full_management");
      const stageName = String(metadata.stage_name ?? email.split("@")[0]);

      let userId = (inv.invitee_user_id as string | null) ?? null;
      if (!userId) {
        const { data: u } = await auth.supabase
          .from("users")
          .select("id")
          .ilike("email", email)
          .maybeSingle();
        userId = (u?.id as string | undefined) ?? null;
      }

      if (!userId && invitationType === "create_new") {
        userId = await ensureAuthAndPublicUser(auth.supabase, email, stageName);
      }

      if (!userId) {
        return json(
          {
            error:
              invitationType === "create_new"
                ? "Could not create artist account for this email"
                : "This artist does not have an Airaplay artist profile on this email yet",
          },
          400,
        );
      }

      let artistProfileId = (inv.artist_profile_id as string | null) ?? null;
      if (!artistProfileId) {
        const { data: ap } = await auth.supabase
          .from("artist_profiles")
          .select("id")
          .eq("user_id", userId)
          .maybeSingle();
        artistProfileId = (ap?.id as string | undefined) ?? null;
      }

      if (!artistProfileId && invitationType === "create_new") {
        artistProfileId = await ensureArtistProfile(auth.supabase, userId, metadata);
      }

      if (!artistProfileId) {
        return json(
          { error: "Artist profile could not be created from this invitation" },
          400,
        );
      }

      await activateOrgLink(
        auth.supabase,
        organizationId,
        artistProfileId,
        userId,
        permissionPreset,
        (inv.created_by as string) || auth.user.id,
      );

      await auth.supabase
        .from("organization_artist_invitations")
        .update({
          status: "accepted",
          responded_at: new Date().toISOString(),
          invitee_user_id: userId,
          artist_profile_id: artistProfileId,
        })
        .eq("id", inv.id);

      return json({
        success: true,
        artist_profile_id: artistProfileId,
        invitation_id: inv.id,
        user_id: userId,
      });
    }

    // Default: create new artist immediately from ALMC dashboard
    const metadata = (body.metadata ?? {}) as Json;
    const stageName = String(metadata.stage_name ?? "").trim();
    const genre = String(metadata.genre ?? "").trim();
    const country = String(metadata.country ?? "").trim();
    const permissionPreset = String(metadata.permission_preset ?? "full_management");

    if (!stageName) return json({ error: "Artist name is required" }, 400);
    if (!genre) return json({ error: "Genre is required" }, 400);
    if (!country) return json({ error: "Country is required" }, 400);

    // If already linked to this org, block.
    {
      const existingUserId = await findAuthUserIdByEmail(auth.supabase, email);
      if (existingUserId) {
        const { data: link } = await auth.supabase
          .from("organization_artist_links")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("user_id", existingUserId)
          .in("status", ["active", "pending_invite"])
          .maybeSingle();
        if (link) {
          return json({ error: "Artist is already linked or invited" }, 400);
        }
      }
    }

    const userId = await ensureAuthAndPublicUser(auth.supabase, email, stageName);
    const artistProfileId = await ensureArtistProfile(auth.supabase, userId, {
      ...metadata,
      stage_name: stageName,
      genre,
      country,
      permission_preset: permissionPreset,
    });

    await activateOrgLink(
      auth.supabase,
      organizationId,
      artistProfileId,
      userId,
      permissionPreset,
      auth.user.id,
    );

    // Cancel any pending invite for this email so roster stays clean.
    await auth.supabase
      .from("organization_artist_invitations")
      .update({ status: "cancelled", responded_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .ilike("invitee_email", email)
      .eq("status", "pending");

    await queueClaimEmail(auth.supabase, email, userId, organizationId, stageName);

    try {
      await auth.supabase.rpc("log_organization_activity", {
        p_org_id: organizationId,
        p_action: "artist_created",
        p_artist_profile_id: artistProfileId,
        p_resource_type: "artist_profile",
        p_resource_id: artistProfileId,
        p_metadata: { email, invitation_type: "create_new", permission_preset: permissionPreset },
      });
    } catch (err) {
      console.warn("log activity failed:", err);
    }

    return json({
      success: true,
      artist_profile_id: artistProfileId,
      user_id: userId,
      created: true,
    });
  } catch (error) {
    console.error("almc-create-artist error:", error);
    return json(
      { error: error instanceof Error ? error.message : "Failed to create artist" },
      500,
    );
  }
});
