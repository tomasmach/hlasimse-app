import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Missing environment variables" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id;

    // First fetch user profile and check-in profiles
    const [usersResult, profilesResult] = await Promise.all([
      supabaseAdmin.from("users").select("*").eq("id", userId),
      supabaseAdmin.from("check_in_profiles").select("*").eq("owner_id", userId),
    ]);

    const profileIds = profilesResult.data?.map((p) => p.id) || [];

    // Then fetch related data that depends on profileIds
    const [checkInsResult, guardiansResult, invitesResult, alertsResult] =
      await Promise.all([
        profileIds.length > 0
          ? supabaseAdmin
              .from("check_ins")
              .select("*")
              .in("check_in_profile_id", profileIds)
          : Promise.resolve({ data: [] }),
        profileIds.length > 0
          ? supabaseAdmin
              .from("guardians")
              .select("*")
              .in("check_in_profile_id", profileIds)
          : Promise.resolve({ data: [] }),
        supabaseAdmin
          .from("guardian_invites")
          .select("*")
          .or(`inviter_id.eq.${userId},invitee_id.eq.${userId}`),
        profileIds.length > 0
          ? supabaseAdmin
              .from("alerts")
              .select("*")
              .in("check_in_profile_id", profileIds)
          : Promise.resolve({ data: [] }),
      ]);

    const exportData = {
      exported_at: new Date().toISOString(),
      user: usersResult.data?.[0] || null,
      check_in_profiles: profilesResult.data || [],
      check_ins: checkInsResult.data || [],
      guardians: guardiansResult.data || [],
      guardian_invites: invitesResult.data || [],
      alerts: alertsResult.data || [],
    };

    return new Response(JSON.stringify(exportData, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
