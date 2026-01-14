// supabase/functions/check-deadlines/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ExpiredProfile {
  id: string;
  owner_id: string;
  name: string;
  next_deadline: string;
  last_known_lat: number | null;
  last_known_lng: number | null;
}

interface Guardian {
  user_id: string;
}

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
        JSON.stringify({ error: "Missing environment variable: SUPABASE_SERVICE_ROLE_KEY" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find expired profiles without active alerts
    const { data: expiredProfiles, error: profilesError } = await supabase
      .from("check_in_profiles")
      .select("id, owner_id, name, next_deadline, last_known_lat, last_known_lng")
      .lt("next_deadline", new Date().toISOString())
      .eq("is_active", true)
      .eq("is_paused", false)
      .returns<ExpiredProfile[]>();

    if (profilesError) {
      throw profilesError;
    }

    if (!expiredProfiles || expiredProfiles.length === 0) {
      return new Response(
        JSON.stringify({ message: "No expired profiles found", alertsCreated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let alertsCreated = 0;

    for (const profile of expiredProfiles) {
      // Check if there's already an active alert for this profile
      const { data: existingAlerts } = await supabase
        .from("alerts")
        .select("id")
        .eq("check_in_profile_id", profile.id)
        .is("resolved_at", null)
        .limit(1);

      if (existingAlerts?.length > 0) {
        // Already has an active alert, skip
        continue;
      }

      // Get guardians for this profile
      const { data: guardians } = await supabase
        .from("guardians")
        .select("user_id")
        .eq("check_in_profile_id", profile.id)
        .returns<Guardian[]>();

      const guardianIds = guardians?.map((g) => g.user_id) || [];

      // Create alert
      const { error: alertError } = await supabase.from("alerts").insert({
        check_in_profile_id: profile.id,
        triggered_at: new Date().toISOString(),
        alert_type: "push",
        notified_guardians: guardianIds,
      });

      if (alertError) {
        console.error(`Failed to create alert for profile ${profile.id}:`, alertError);
        continue;
      }

      alertsCreated++;

      // TODO: In Slice 6, send push notifications to guardians here
      console.log(
        `Alert created for profile ${profile.name} (${profile.id}), guardians: ${guardianIds.join(", ")}`
      );
    }

    return new Response(
      JSON.stringify({
        message: "Deadline check completed",
        profilesChecked: expiredProfiles.length,
        alertsCreated,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Error in check-deadlines function:", error);
    return new Response(
      JSON.stringify({ error: msg }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
