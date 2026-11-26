import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false, autoRefreshToken: false } },
);

type Invoice = {
  id: string;
  tenant_id: string;
  invoice_number: string;
  tenant_name_snapshot: string;
  billing_email_snapshot: string;
  currency: string;
  subtotal_minor: number;
  due_on: string;
  status: string;
};

type Subscription = {
  tenant_id: string;
  status: string;
  grace_ends_on: string | null;
  suspended_at: string | null;
  admin_override: boolean;
};

const EVENT_TEMPLATES: Record<string, string> = {
  reminder_3_days: "payment_pre_due_3_days",
  reminder_1_day: "payment_pre_due_1_day",
  past_due: "payment_past_due",
  grace_final: "payment_grace_period",
  suspended: "payment_suspended",
};

const EVENT_COPY: Record<string, { title: string; body: string; severity: string }> = {
  reminder_3_days: {
    title: "Subscription payment due in 3 days",
    body: "Invoice {{invoice_number}} for {{amount}} is due on {{due_date}}.",
    severity: "warning",
  },
  reminder_1_day: {
    title: "Subscription payment due tomorrow",
    body: "Invoice {{invoice_number}} for {{amount}} is due on {{due_date}}. Please pay to avoid interruption.",
    severity: "warning",
  },
  past_due: {
    title: "Subscription invoice is overdue",
    body: "Invoice {{invoice_number}} for {{amount}} was due on {{due_date}}. Your 2-day grace period has started.",
    severity: "warning",
  },
  grace_final: {
    title: "Final notice: subscription suspension tomorrow",
    body: "Invoice {{invoice_number}} remains unpaid. Your 2-day grace period ends tomorrow; pay the outstanding balance to avoid suspension.",
    severity: "critical",
  },
  suspended: {
    title: "Subscription suspended for non-payment",
    body: "Invoice {{invoice_number}} remains unpaid after the 2-day grace period. Subscription access has been suspended until payment is verified.",
    severity: "critical",
  },
};

function nairobiToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dayDifference(later: string, earlier: string): number {
  return Math.round(
    (Date.parse(`${later}T00:00:00.000Z`) - Date.parse(`${earlier}T00:00:00.000Z`)) / 86_400_000,
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] ?? char);
}

function formatAmount(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "long",
    timeZone: "Africa/Nairobi",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

async function finishEvent(id: string, status: "sent" | "failed" | "skipped", error?: string) {
  const { error: updateError } = await supabase
    .from("platform_invoice_dunning_events")
    .update({
      status,
      last_error: error ? error.slice(0, 2000) : null,
      delivered_at: status === "sent" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (updateError) throw updateError;
}

async function claimEvent(invoice: Invoice, eventType: string, channel: "email" | "in_app"): Promise<string | null> {
  const { data, error } = await supabase.rpc("claim_platform_invoice_dunning_event", {
    p_invoice_id: invoice.id,
    p_tenant_id: invoice.tenant_id,
    p_event_type: eventType,
    p_channel: channel,
  });
  if (error) throw error;
  return typeof data === "string" ? data : null;
}

async function deliverEmail(
  invoice: Invoice,
  eventType: string,
  outstandingMinor: number,
  currentBillingEmail?: string,
): Promise<void> {
  const recipient = [invoice.billing_email_snapshot, currentBillingEmail]
    .map((email) => (email ?? "").trim())
    .find((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ?? "";
  if (!recipient) {
    console.warn("[platform-billing-dunning] email skipped: invoice has no valid billing email", invoice.invoice_number);
    return;
  }

  const relayUrl = Deno.env.get("DUNNING_EMAIL_RELAY_URL");
  const relayToken = Deno.env.get("DUNNING_EMAIL_RELAY_TOKEN");
  if (!relayUrl || !relayToken) {
    console.warn("[platform-billing-dunning] email deferred: SMTP relay is not configured", invoice.invoice_number);
    return;
  }

  const eventId = await claimEvent(invoice, eventType, "email");
  if (!eventId) return;

  try {
    const templateName = EVENT_TEMPLATES[eventType];
    const { data: template, error: templateError } = await supabase
      .from("dunning_notification_templates")
      .select("subject,body")
      .eq("template_name", templateName)
      .eq("is_active", true)
      .maybeSingle();

    if (templateError) throw templateError;
    if (!template) throw new Error(`Active email template not found: ${templateName}`);

    const variables: Record<string, string> = {
      tenant_name: invoice.tenant_name_snapshot,
      amount: formatAmount(outstandingMinor, invoice.currency),
      due_date: formatDate(invoice.due_on),
      invoice_number: invoice.invoice_number,
    };
    let subject = template.subject as string;
    let body = template.body as string;
    for (const [key, value] of Object.entries(variables)) {
      subject = subject.replaceAll(`{{${key}}}`, value);
      body = body.replaceAll(`{{${key}}}`, escapeHtml(value));
    }
    const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#202124;max-width:620px;margin:0 auto;padding:24px">${body.split(/\r?\n/).map((line: string) => line ? `<p>${line}</p>` : "").join("")}</body></html>`;
    const response = await fetch(relayUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${relayToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: recipient,
        subject,
        html,
        idempotencyKey: `mobiwave-wa-${invoice.id}-${eventType}`,
      }),
    });
    if (!response.ok) throw new Error(`SMTP relay returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
    await finishEvent(eventId, "sent");
  } catch (error) {
    await finishEvent(eventId, "failed", error instanceof Error ? error.message : String(error));
  }
}

async function createInAppNotification(invoice: Invoice, eventType: string, outstandingMinor: number): Promise<void> {
  const eventId = await claimEvent(invoice, eventType, "in_app");
  if (!eventId) return;

  try {
    const copy = EVENT_COPY[eventType];
    const variables = {
      invoice_number: invoice.invoice_number,
      amount: formatAmount(outstandingMinor, invoice.currency),
      due_date: formatDate(invoice.due_on),
    };
    let body = copy.body;
    for (const [key, value] of Object.entries(variables)) {
      body = body.replaceAll(`{{${key}}}`, value);
    }

    const { error } = await supabase.from("workspace_notifications").insert({
      tenant_id: invoice.tenant_id,
      recipient_user_id: null,
      category: "billing",
      severity: copy.severity,
      title: copy.title,
      body,
      entity_type: "invoice",
      entity_id: invoice.id,
      dedupe_key: `invoice:${invoice.id}:${eventType}`,
      metadata: {
        invoice_number: invoice.invoice_number,
        due_on: invoice.due_on,
        amount_due_minor: outstandingMinor,
        currency: invoice.currency,
        event_type: eventType,
      },
    });

    if (error && error.code !== "23505") throw error;
    await finishEvent(eventId, "sent");
  } catch (error) {
    await finishEvent(eventId, "failed", error instanceof Error ? error.message : String(error));
  }
}

async function emitEvent(invoice: Invoice, eventType: string, outstandingMinor: number, currentBillingEmail?: string) {
  await Promise.all([
    createInAppNotification(invoice, eventType, outstandingMinor),
    deliverEmail(invoice, eventType, outstandingMinor, currentBillingEmail),
  ]);
}

async function processDunning(dryRun: boolean, asOf?: string) {
  const today = dryRun && asOf ? asOf : nairobiToday();
  const { data: invoices, error: invoiceError } = await supabase
    .from("platform_invoices")
    .select("id,tenant_id,invoice_number,tenant_name_snapshot,billing_email_snapshot,currency,subtotal_minor,due_on,status")
    .eq("status", "issued")
    .order("due_on", { ascending: true })
    .limit(500);
  if (invoiceError) throw invoiceError;
  if (!invoices?.length) {
    return { today, scanned: 0, eligible: 0, events_planned: [], emails_skipped: 0, suspensions: 0, email_provider_configured: Boolean(Deno.env.get("DUNNING_EMAIL_RELAY_URL") && Deno.env.get("DUNNING_EMAIL_RELAY_TOKEN")) };
  }

  const invoiceIds = invoices.map((invoice: Invoice) => invoice.id);
  const tenantIds = [...new Set(invoices.map((invoice: Invoice) => invoice.tenant_id))];
  const [paymentsResult, itemsResult, tenantsResult, subscriptionsResult, accountsResult, ownerMembersResult] = await Promise.all([
    supabase.from("platform_invoice_payments").select("invoice_id,amount_minor,reversed_at").in("invoice_id", invoiceIds),
    supabase.from("platform_invoice_items").select("invoice_id,description").in("invoice_id", invoiceIds),
    supabase.from("tenants").select("id,is_demo,billing_exempt").in("id", tenantIds),
    supabase.from("platform_customer_subscriptions").select("tenant_id,status,grace_ends_on,suspended_at,admin_override").in("tenant_id", tenantIds),
    supabase.from("platform_customer_accounts").select("tenant_id,billing_email").in("tenant_id", tenantIds),
    supabase.from("tenant_members").select("tenant_id,user_id").eq("role", "owner").in("tenant_id", tenantIds),
  ]);
  for (const result of [paymentsResult, itemsResult, tenantsResult, subscriptionsResult, accountsResult, ownerMembersResult]) {
    if (result.error) throw result.error;
  }

  const paidByInvoice = new Map<string, number>();
  for (const payment of paymentsResult.data ?? []) {
    if (!payment.reversed_at) {
      paidByInvoice.set(payment.invoice_id, (paidByInvoice.get(payment.invoice_id) ?? 0) + Number(payment.amount_minor));
    }
  }
  const monthlyInvoiceIds = new Set<string>();
  for (const item of itemsResult.data ?? []) {
    if (String(item.description).toLowerCase().includes("monthly subscription")) {
      monthlyInvoiceIds.add(item.invoice_id);
    }
  }
  const tenantById = new Map((tenantsResult.data ?? []).map((tenant: any) => [tenant.id, tenant]));
  const subscriptionByTenant = new Map((subscriptionsResult.data ?? []).map((subscription: Subscription) => [subscription.tenant_id, subscription]));
  const billingEmailByTenant = new Map<string, string>();
  for (const account of accountsResult.data ?? []) {
    const email = String((account as any).billing_email ?? "").trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      billingEmailByTenant.set((account as any).tenant_id, email);
    }
  }

  // Registration email is the billing contact of record. Only use an owner
  // account whose email Supabase has explicitly confirmed; never send to an
  // unverified address or guess from an arbitrary workspace member.
  const verifiedOwnerEmails = new Map<string, Set<string>>();
  await Promise.all((ownerMembersResult.data ?? []).map(async (member: any) => {
    const { data, error } = await supabase.auth.admin.getUserById(member.user_id);
    if (error) {
      console.warn("[platform-billing-dunning] owner email lookup failed", member.tenant_id);
      return;
    }
    const user = data.user;
    const email = (user?.email ?? "").trim();
    if (!user?.email_confirmed_at || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    const emails = verifiedOwnerEmails.get(member.tenant_id) ?? new Set<string>();
    emails.add(email);
    verifiedOwnerEmails.set(member.tenant_id, emails);
  }));
  for (const [tenantId, emails] of verifiedOwnerEmails) {
    // Avoid choosing arbitrarily if a tenant has multiple distinct owner emails.
    if (!billingEmailByTenant.has(tenantId) && emails.size === 1) {
      billingEmailByTenant.set(tenantId, [...emails][0]);
    }
  }

  const eligible: Array<{ invoice: Invoice; outstanding: number; daysUntil: number; monthly: boolean }> = [];
  const eventsPlanned: Array<{ invoice_number: string; event_type: string; outstanding_minor: number }> = [];
  let emailsSkipped = 0;
  let suspensions = 0;

  for (const invoice of invoices as Invoice[]) {
    const tenant = tenantById.get(invoice.tenant_id) as any;
    if (!tenant || tenant.is_demo === true || tenant.billing_exempt === true) continue;
    const outstanding = Math.max(Number(invoice.subtotal_minor) - (paidByInvoice.get(invoice.id) ?? 0), 0);
    if (outstanding <= 0) continue;
    const daysUntil = dayDifference(invoice.due_on, today);
    const monthly = monthlyInvoiceIds.has(invoice.id);
    eligible.push({ invoice, outstanding, daysUntil, monthly });

    const events: string[] = [];
    if (daysUntil === 3) events.push("reminder_3_days");
    if (daysUntil === 1) events.push("reminder_1_day");
    if (daysUntil <= -1) events.push("past_due");
    if (daysUntil <= -2) events.push("grace_final");
    for (const eventType of events) {
      eventsPlanned.push({ invoice_number: invoice.invoice_number, event_type: eventType, outstanding_minor: outstanding });
      if (!dryRun) await emitEvent(invoice, eventType, outstanding, billingEmailByTenant.get(invoice.tenant_id));
    }
  }

  const monthlyByTenant = new Map<string, typeof eligible[number]>();
  for (const row of eligible) {
    if (!row.monthly) continue;
    const current = monthlyByTenant.get(row.invoice.tenant_id);
    if (!current || row.invoice.due_on < current.invoice.due_on) monthlyByTenant.set(row.invoice.tenant_id, row);
  }

  for (const [tenantId, row] of monthlyByTenant) {
    const subscription = subscriptionByTenant.get(tenantId);
    if (!subscription) continue;
    if (subscription.status === "canceled" || subscription.status === "paused") continue;
    // An explicit admin activation is a deliberate override until an administrator changes it.
    if (subscription.admin_override === true) continue;

    const daysPastDue = -row.daysUntil;
    if (daysPastDue < 1) continue;

    const graceEndsOn = addDays(row.invoice.due_on, 2);
    let nextStatus: string | null = null;
    if (daysPastDue >= 3) nextStatus = "suspended";
    else if (daysPastDue >= 2) nextStatus = "grace";
    else nextStatus = "past_due";

    if (dryRun) {
      if (nextStatus === "suspended" && subscription.status !== "suspended") {
        suspensions++;
        eventsPlanned.push({ invoice_number: row.invoice.invoice_number, event_type: "suspended", outstanding_minor: row.outstanding });
      }
      continue;
    }

    if (subscription.status !== nextStatus) {
      const now = new Date().toISOString();
      const update: Record<string, unknown> = {
        status: nextStatus,
        grace_ends_on: graceEndsOn,
        last_status_change_at: now,
        updated_at: now,
      };
      if (nextStatus === "suspended") update.suspended_at = now;
      else update.suspended_at = null;

      const { error: updateError } = await supabase
        .from("platform_customer_subscriptions")
        .update(update)
        .eq("tenant_id", tenantId);
      if (updateError) throw updateError;

      await supabase.from("platform_billing_audit").insert({
        actor_id: null,
        action: nextStatus === "suspended" ? "subscription_auto_suspended_nonpayment" : nextStatus === "grace" ? "subscription_grace_period_started" : "subscription_marked_past_due",
        entity_type: "subscription",
        entity_id: tenantId,
        details: {
          invoice_id: row.invoice.id,
          invoice_number: row.invoice.invoice_number,
          due_on: row.invoice.due_on,
          grace_ends_on: graceEndsOn,
          previous_status: subscription.status,
          next_status: nextStatus,
        },
      });

    }
    if (nextStatus === "suspended") {
      if (subscription.status !== "suspended") suspensions++;
      if (!dryRun) await emitEvent(row.invoice, "suspended", row.outstanding, billingEmailByTenant.get(row.invoice.tenant_id));
    }
  }

  if (dryRun) {
    for (const event of eventsPlanned) {
      const invoice = eligible.find((row) => row.invoice.invoice_number === event.invoice_number)?.invoice;
      const billingEmail = invoice
        ? [invoice.billing_email_snapshot, billingEmailByTenant.get(invoice.tenant_id)]
          .map((email) => (email ?? "").trim())
          .find((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ?? ""
        : "";
      if (invoice && !billingEmail) emailsSkipped++;
    }
  }

  return {
    today,
    scanned: invoices.length,
    eligible: eligible.length,
    events_planned: eventsPlanned,
    emails_skipped: emailsSkipped,
    suspensions,
    dry_run: dryRun,
    email_provider_configured: Boolean(Deno.env.get("DUNNING_EMAIL_RELAY_URL") && Deno.env.get("DUNNING_EMAIL_RELAY_TOKEN")),
  };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const token = request.headers.get("x-internal-token");
    if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const { data: valid, error: authError } = await supabase.rpc("verify_internal_function_token", {
      p_token: token,
    });
    if (authError || valid !== true) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const payload = await request.json().catch(() => ({}));
    const action = payload?.action ?? "process";
    if (action !== "process" && action !== "dry_run") {
      return Response.json({ error: "Unsupported action" }, { status: 400 });
    }
    const asOf = payload?.as_of;
    if (action === "dry_run" && asOf !== undefined && (typeof asOf !== "string" || !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(asOf))) {
      return Response.json({ error: "as_of must be a YYYY-MM-DD date and is only supported for dry_run." }, { status: 400 });
    }

    const result = await processDunning(action === "dry_run", asOf);
    return Response.json({ success: true, ...result });
  } catch (error) {
    console.error("[platform-billing-dunning] failed", error);
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : "Unexpected worker error",
    }, { status: 500 });
  }
});
