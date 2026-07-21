// supabase/functions/delete-user/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl) {
      return new Response(
        JSON.stringify({ error: "Missing environment variable: SUPABASE_URL" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!supabaseServiceKey) {
      return new Response(
        JSON.stringify({
          error: "Missing environment variable: SUPABASE_SERVICE_ROLE_KEY",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Get the user from the auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    const { userId } = await req.json();

    // Verify the user is deleting their own account
    if (user.id !== userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Starting account deletion for user: ${userId}`);

    // Get check-in profile IDs for this user
    const { data: profiles } = await supabaseAdmin
      .from("check_in_profiles")
      .select("id")
      .eq("owner_id", userId);

    const profileIds = profiles?.map((p) => p.id) || [];

    // Delete user data (order matters due to foreign keys)
    // 1. Push tokens
    const { error: pushTokensError } = await supabaseAdmin
      .from("push_tokens")
      .delete()
      .eq("user_id", userId);
    if (pushTokensError) {
      console.error("Error deleting push_tokens:", pushTokensError);
      throw new Error("Failed to delete push tokens");
    }

    // 2. Alerts (via check_in_profile_id)
    if (profileIds.length > 0) {
      const { error: alertsError } = await supabaseAdmin
        .from("alerts")
        .delete()
        .in("check_in_profile_id", profileIds);
      if (alertsError) {
        console.error("Error deleting alerts:", alertsError);
        throw new Error("Failed to delete alerts");
      }
    }

    // 3. Check-ins (via check_in_profile_id)
    if (profileIds.length > 0) {
      const { error: checkInsError } = await supabaseAdmin
        .from("check_ins")
        .delete()
        .in("check_in_profile_id", profileIds);
      if (checkInsError) {
        console.error("Error deleting check_ins:", checkInsError);
        throw new Error("Failed to delete check-ins");
      }
    }

    // 4. Guardian invites (as inviter or invitee)
    const { error: invitesError } = await supabaseAdmin
      .from("guardian_invites")
      .delete()
      .or(`inviter_id.eq.${userId},invitee_id.eq.${userId}`);
    if (invitesError) {
      console.error("Error deleting guardian_invites:", invitesError);
      throw new Error("Failed to delete guardian invites");
    }

    // 5. Guardians watching this user's profiles (via check_in_profile_id)
    if (profileIds.length > 0) {
      const { error: guardiansProfileError } = await supabaseAdmin
        .from("guardians")
        .delete()
        .in("check_in_profile_id", profileIds);
      if (guardiansProfileError) {
        console.error("Error deleting guardians (check_in_profile_id):", guardiansProfileError);
        throw new Error("Failed to delete guardians by profile");
      }
    }

    // 6. Guardians where this user is a guardian for others
    const { error: guardiansError } = await supabaseAdmin
      .from("guardians")
      .delete()
      .eq("guardian_user_id", userId);
    if (guardiansError) {
      console.error("Error deleting guardians (guardian_user_id):", guardiansError);
      throw new Error("Failed to delete guardian relationships");
    }

    // 7. Check-in profiles
    const { error: profilesError } = await supabaseAdmin
      .from("check_in_profiles")
      .delete()
      .eq("owner_id", userId);
    if (profilesError) {
      console.error("Error deleting check_in_profiles:", profilesError);
      throw new Error("Failed to delete check-in profiles");
    }

    // 8. Users table (extended profile)
    const { error: usersError } = await supabaseAdmin
      .from("users")
      .delete()
      .eq("id", userId);
    if (usersError) {
      console.error("Error deleting from users:", usersError);
      throw new Error("Failed to delete user profile");
    }

    // 9. Delete the auth user
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(
      userId
    );
    if (deleteError) {
      console.error("Error deleting auth user:", deleteError);
      throw deleteError;
    }

    console.log(`Account deletion completed for user: ${userId}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Error in delete-user function:", error);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
