import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { corsHeaders, json, errorMessage, readRequestJson } from "../_shared/cors.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Authentication required.");
    const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Verify user has platform admin role
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: userError } = await userClient.auth.getUser(authHeader.slice(7));
    if (userError || !userData.user) throw new Error("Session is invalid or expired.");
    
    const { data: { user: platformUser }, error: platformError } = await userClient.rpc("check_platform_admin", { p_user_id: userData.user.id });
    if (platformError || !platformUser) throw new Error("Platform admin access required.");
    
    const body = await readRequestJson(request);
    const name = String(body.name ?? "").trim();
    const slug = String(body.slug ?? "").trim().toLowerCase();
    const email = String(body.email ?? "").trim();
    const demoDays = Number(body.demo_days ?? 7); // Default 7-day demo
    
    if (name.length < 2 || name.length > 160 || !/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug)) {
      return json({ error: "Workspace name must be 2–160 characters; slug must be 3–64 lowercase letters, numbers or hyphens." }, 400);
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Valid email address required for demo user." }, 400);
    }
    if (demoDays < 1 || demoDays > 30) {
      return json({ error: "Demo period must be between 1 and 30 days." }, 400);
    }
    
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    
    // Check if workspace already exists
    const { data: existingTenant } = await admin.from("tenants").select("id").eq("slug", slug).maybeSingle();
    if (existingTenant) {
      return json({ error: "That workspace URL is already in use." }, 400);
    }
    
    // Create workspace
    const { data: tenant, error: tenantError } = await admin.from("tenants").insert({ name, slug, is_demo: true }).select("id,name,slug").single();
    if (tenantError) return json({ error: "Could not create workspace: " + tenantError.message }, 400);
    
    // Create demo user account if it doesn't exist
    let userId = null;
    const { data: userList, error: userListError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (userListError) {
      await admin.from("tenants").delete().eq("id", tenant.id);
      return json({ error: "Could not check existing demo user: " + userListError.message }, 500);
    }
    const existingUser = userList.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
    if (existingUser) {
      userId = existingUser.id;
    } else {
      const { data: newUser, error: createUserError } = await admin.auth.admin.createUser({
        email,
        password: Math.random().toString(36).slice(-12), // Random password
        email_confirm: true,
      });
      if (createUserError) {
        await admin.from("tenants").delete().eq("id", tenant.id);
        return json({ error: "Could not create demo user account: " + createUserError.message }, 400);
      }
      userId = newUser.user.id;
    }
    
    // Add demo user as workspace owner
    const { error: memberError } = await admin.from("tenant_members").insert({ 
      tenant_id: tenant.id, 
      user_id: userId, 
      role: "owner",
      is_demo: true 
    });
    if (memberError) {
      await admin.from("tenants").delete().eq("id", tenant.id);
      return json({ error: "Could not assign demo user to workspace: " + memberError.message }, 400);
    }
    
    // Initialize workspace settings
    const { error: settingsError } = await admin.from("tenant_settings").insert({ 
      tenant_id: tenant.id, 
      ai_enabled: false,
      is_demo: true 
    });
    if (settingsError) {
      await admin.from("tenant_members").delete().eq("tenant_id", tenant.id);
      await admin.from("tenants").delete().eq("id", tenant.id);
      return json({ error: "Could not initialize workspace settings: " + settingsError.message }, 400);
    }
    
    // Initialize usage limits
    const { error: limitError } = await admin.from("tenant_usage_limits").insert({ 
      tenant_id: tenant.id, 
      monthly_message_limit: 0, 
      monthly_ai_request_limit: 500,
      is_demo: true 
    });
    if (limitError) {
      await admin.from("tenant_settings").delete().eq("tenant_id", tenant.id);
      await admin.from("tenant_members").delete().eq("tenant_id", tenant.id);
      await admin.from("tenants").delete().eq("id", tenant.id);
      return json({ error: "Could not initialize workspace usage limits: " + limitError.message }, 400);
    }
    
    // Assign demo subscription with extended trial period
    const { data: entryTier, error: tierError } = await admin.from("platform_billing_tiers")
      .select("id,currency,monthly_price_minor")
      .eq("active", true).eq("is_public", true)
      .order("display_order", { ascending: true }).limit(1).maybeSingle();
    
    if (tierError) {
      await admin.from("tenant_usage_limits").delete().eq("tenant_id", tenant.id);
      await admin.from("tenant_settings").delete().eq("tenant_id", tenant.id);
      await admin.from("tenant_members").delete().eq("tenant_id", tenant.id);
      await admin.from("tenants").delete().eq("id", tenant.id);
      return json({ error: "Could not load the entry plan: " + tierError.message }, 400);
    }
    
    if (entryTier) {
      const today = new Date();
      const isoDate = (date: Date) => date.toISOString().slice(0, 10);
      const trialEnds = new Date(today); trialEnds.setUTCDate(trialEnds.getUTCDate() + demoDays);
      const graceEnds = new Date(today); graceEnds.setUTCDate(graceEnds.getUTCDate() + demoDays + 7);
      
      const { error: subscriptionError } = await admin.from("platform_customer_subscriptions").insert({
        tenant_id: tenant.id,
        tier_id: entryTier.id,
        status: "trialing",
        currency: entryTier.currency,
        monthly_price_minor: entryTier.monthly_price_minor,
        starts_on: isoDate(today),
        trial_ends_on: isoDate(trialEnds),
        grace_ends_on: isoDate(graceEnds),
        is_demo: true,
        demo_ends_on: isoDate(trialEnds), // Track when demo expires
      });
      
      if (subscriptionError) {
        await admin.from("tenant_usage_limits").delete().eq("tenant_id", tenant.id);
        await admin.from("tenant_settings").delete().eq("tenant_id", tenant.id);
        await admin.from("tenant_members").delete().eq("tenant_id", tenant.id);
        await admin.from("tenants").delete().eq("id", tenant.id);
        return json({ error: "Could not start the demo subscription: " + subscriptionError.message }, 400);
      }
    }
    
    // Send welcome email to demo user
    try {
      const { error: emailError } = await admin.functions.invoke("send-demo-welcome", {
        body: { 
          email, 
          workspace_name: name, 
          workspace_url: `https://wap.mobiwave.co.ke/${slug}`,
          demo_days: demoDays,
          login_url: `https://wap.mobiwave.co.ke/login`
        }
      });
      if (emailError) console.warn("Demo welcome email failed:", emailError.message);
    } catch (emailError) {
      console.warn("Demo welcome email error:", emailError);
    }
    
    return json({ 
      ok: true, 
      tenant,
      demo_user: { email, user_id: userId },
      demo_ends_on: new Date(Date.now() + demoDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    });
  } catch (error) {
    const message = errorMessage(error);
    return json({ error: message }, /authentication|sign in|session is invalid/i.test(message) ? 401 : 400);
  }
});