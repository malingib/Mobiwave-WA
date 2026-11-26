import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { corsHeaders, json } from "../_shared/cors.ts";
import { verifyPaystackWebhookSignature } from "../_shared/paystack-signature.ts";
import { isTestPaystackDomain, isTestPaystackKey } from "../_shared/paystack-environment.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const webhookSigningSecret = Deno.env.get("PAYSTACK_WEBHOOK_SECRET") ?? "";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!supabaseUrl || !serviceRoleKey || !isTestPaystackKey(paystackSecretKey)) {
    console.error("Paystack webhook is missing required server configuration.");
    return json({ error: "Webhook is not configured." }, 503);
  }

  try {
    const rawBody = new Uint8Array(await request.arrayBuffer());
    if (rawBody.length === 0 || rawBody.length > 256 * 1024) return json({ error: "Invalid webhook body." }, 400);
    if (!await verifyPaystackWebhookSignature(rawBody, request.headers, {
      webhookSigningSecret,
      secretKey: paystackSecretKey,
    })) return json({ error: "Invalid Paystack signature." }, 401);

    const event = JSON.parse(new TextDecoder().decode(rawBody));
    if (!isTestPaystackDomain(event?.data?.domain)) {
      console.error("Rejected Paystack webhook from an unexpected or missing transaction domain.");
      return json({ error: "Paystack transaction environment mismatch." }, 409);
    }
    const reference = typeof event?.data?.reference === "string" ? event.data.reference : "";
    if (!reference) return json({ received: true, ignored: true });

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (event.event === "charge.failed") {
      await admin.from("platform_paystack_transactions")
        .update({
          status: "failed",
          failure_reason: String(event?.data?.gateway_response || "Paystack charge failed").slice(0, 500),
          gateway_response: event.data,
          updated_at: new Date().toISOString(),
        })
        .eq("reference", reference)
        .in("status", ["initializing", "pending"]);
      return json({ received: true });
    }

    if (event.event !== "charge.success") return json({ received: true, ignored: true });

    const { data: localTransaction, error: localError } = await admin
      .from("platform_paystack_transactions")
      .select("reference, amount_minor, currency, customer_email, status")
      .eq("reference", reference)
      .maybeSingle();
    if (localError) throw localError;
    if (!localTransaction) {
      console.warn("Signed Paystack event references an unknown MobiWave invoice payment.", reference);
      return json({ received: true, ignored: true });
    }
    if (localTransaction.status === "success") return json({ received: true, duplicate: true });

    const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${paystackSecretKey}` },
    });
    const verification = await verifyResponse.json().catch(() => null);
    if (!verifyResponse.ok || !verification?.status || verification?.data?.status !== "success") {
      throw new Error("Paystack transaction verification did not confirm a successful payment.");
    }

    const verified = verification.data;
    if (!isTestPaystackDomain(verified.domain)) {
      console.error("Rejected Paystack verification response from an unexpected or missing transaction domain.", reference);
      return json({ received: true, requires_review: true, reason: "paystack_environment_mismatch" }, 409);
    }
    const amountMinor = Number(verified.amount);
    const currency = String(verified.currency || "").toUpperCase();
    const verifiedReference = String(verified.reference || "");
    const customerEmail = String(verified.customer?.email || "").trim().toLowerCase();
    const transactionId = String(verified.id || "");
    if (!Number.isSafeInteger(amountMinor) || verifiedReference !== reference || !transactionId) {
      throw new Error("Paystack verification response is missing a valid transaction identity or amount.");
    }

    const { data: settlement, error: settlementError } = await admin.rpc("platform_paystack_settle_invoice", {
      p_reference: reference,
      p_gateway_transaction_id: transactionId,
      p_amount_minor: amountMinor,
      p_currency: currency,
      p_customer_email: customerEmail,
      p_gateway_response: {
        status: verified.status,
        channel: verified.channel || null,
        paid_at: verified.paid_at || null,
        gateway_response: verified.gateway_response || null,
        authorization: { channel: verified.authorization?.channel || null },
      },
    });
    if (settlementError) throw settlementError;
    if (!settlement?.ok) {
      console.error("Verified Paystack payment requires manual reconciliation:", reference, settlement?.error);
      return json({ received: true, requires_review: true, reason: settlement?.error || "settlement_review" });
    }

    return json({ received: true, settled: true, duplicate: !!settlement.duplicate });
  } catch (error) {
    console.error("Paystack webhook processing failed:", error);
    return json({ error: error instanceof Error ? error.message : "Webhook processing failed." }, 500);
  }
});
