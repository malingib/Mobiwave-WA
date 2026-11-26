import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { corsHeaders, json, readRequestJson } from "../_shared/cors.ts";
import { paystackEnvironmentIsValid } from "../_shared/paystack-environment.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const paystackMode = Deno.env.get("PAYSTACK_MODE");

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !paystackEnvironmentIsValid(paystackMode, paystackSecretKey) || paystackMode !== "test") {
    return json({ error: "Subscription checkout is not configured yet." }, 503);
  }

  try {
    const authorization = request.headers.get("Authorization") ?? "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token || token === authorization) return json({ error: "Sign in to continue." }, 401);

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "Your session is invalid. Sign in again." }, 401);

    const body = await readRequestJson(request, 16 * 1024);
    const invoiceId = typeof body.invoice_id === "string" ? body.invoice_id : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invoiceId)) {
      return json({ error: "A valid invoice is required." }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: invoice, error: invoiceError } = await admin
      .from("platform_invoices")
      .select("id, tenant_id, invoice_number, currency, status, billing_email_snapshot")
      .eq("id", invoiceId)
      .maybeSingle();
    if (invoiceError) throw invoiceError;
    if (!invoice) return json({ error: "Invoice not found." }, 404);

    const { data: membership, error: membershipError } = await admin
      .from("tenant_members")
      .select("role")
      .eq("tenant_id", invoice.tenant_id)
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) return json({ error: "You do not have access to this workspace invoice." }, 403);
    if (invoice.status !== "issued") return json({ error: "This invoice is not currently payable." }, 409);

    const email = String(invoice.billing_email_snapshot || userData.user.email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ error: "Add a valid billing email to your workspace account before paying this invoice." }, 400);
    }

    const reference = `MWPAY-${crypto.randomUUID()}`;
    const { data: prepared, error: prepareError } = await admin.rpc("platform_paystack_prepare_checkout", {
      p_invoice_id: invoice.id,
      p_reference: reference,
      p_customer_email: email,
    });
    if (prepareError) throw prepareError;
    if (!prepared?.ok) {
      const messages: Record<string, string> = {
        invoice_not_found: "Invoice not found.",
        invoice_not_payable: "This invoice is not currently payable.",
        invoice_already_settled: "This invoice has already been settled.",
        checkout_initializing: "Checkout is being prepared. Please try again in a moment.",
        existing_checkout_amount_conflict: "An earlier checkout needs reconciliation. Please contact MobiWave before retrying.",
      };
      return json({ error: messages[prepared?.error] || "Could not prepare this invoice for payment.", code: prepared?.error }, 409);
    }

    if (!prepared.created) {
      return json({
        ok: true,
        authorization_url: prepared.authorization_url,
        reference: prepared.reference,
        amount_minor: prepared.amount_minor,
        currency: prepared.currency,
        invoice_number: prepared.invoice_number,
        reused: true,
      });
    }

    const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount: String(prepared.amount_minor),
        currency: prepared.currency,
        reference: prepared.reference,
        callback_url: "https://wap.mobiwave.co.ke",
        metadata: {
          purpose: "mobiwave_wa_subscription",
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number,
          tenant_id: invoice.tenant_id,
        },
      }),
    });

    const payload = await paystackResponse.json().catch(() => null);
    if (!paystackResponse.ok || !payload?.status || !payload?.data?.authorization_url) {
      const reason = String(payload?.message || "Paystack could not initialize checkout.").slice(0, 500);
      await admin.from("platform_paystack_transactions")
        .update({ status: "failed", failure_reason: reason, gateway_response: payload || {}, updated_at: new Date().toISOString() })
        .eq("reference", prepared.reference)
        .eq("status", "initializing");
      return json({ error: "Paystack checkout could not be started. Please retry or contact MobiWave.", detail: reason }, 502);
    }

    const { error: updateError } = await admin.from("platform_paystack_transactions")
      .update({
        status: "pending",
        authorization_url: payload.data.authorization_url,
        access_code: payload.data.access_code || null,
        gateway_response: { initialized: true },
        updated_at: new Date().toISOString(),
      })
      .eq("reference", prepared.reference)
      .eq("status", "initializing");
    if (updateError) throw updateError;

    return json({
      ok: true,
      authorization_url: payload.data.authorization_url,
      reference: prepared.reference,
      amount_minor: prepared.amount_minor,
      currency: prepared.currency,
      invoice_number: prepared.invoice_number,
      reused: false,
    });
  } catch (error) {
    console.error("Paystack checkout initialization failed:", error);
    return json({ error: error instanceof Error ? error.message : "Could not start checkout." }, 500);
  }
});
