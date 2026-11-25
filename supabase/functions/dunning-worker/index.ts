import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  CommercialError,
  ErrorCode,
  createErrorResponse,
  logError,
  withRetry
} from "../_shared/error-handling.ts";
import {
  createEmailService,
  EmailTemplate,
  EmailParams
} from "../_shared/email-service.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

// Initialize email service
const emailService = createEmailService();

// Error handling wrapper for dunning worker
async function handleRequest(action: string): Promise<Response> {
  try {
    switch (action) {
      case 'send_payment_reminders':
        return await sendPaymentReminders();
      case 'handle_past_due':
        return await handlePastDuePayments();
      case 'handle_grace_period':
        return await handleGracePeriod();
      case 'suspend_accounts':
        return await suspendAccounts();
      default:
        throw new CommercialError(ErrorCode.API_ENDPOINT_NOT_FOUND, 'Invalid action');
    }
  } catch (error) {
    if (error instanceof CommercialError) {
      logError(error, { action });
      return createErrorResponse(error);
    }

    const commercialError = new CommercialError(ErrorCode.INTERNAL_SERVER_ERROR, 'Internal server error', {
      original_error: error instanceof Error ? error.message : String(error),
      action
    });
    logError(commercialError);
    return createErrorResponse(commercialError);
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // This is a system worker function, authentication required via worker token
    const authorization = req.headers.get('Authorization');
    const expectedToken = Deno.env.get('DUNNING_WORKER_TOKEN');

    if (!authorization || authorization !== `Bearer ${expectedToken}`) {
      throw new CommercialError(ErrorCode.UNAUTHORIZED, 'Invalid worker token');
    }

    const { action } = await req.json() as { action: string };

    // Handle request with error handling
    return await handleRequest(action);
  } catch (error) {
    if (error instanceof CommercialError) {
      logError(error);
      return createErrorResponse(error);
    }

    const commercialError = new CommercialError(ErrorCode.INTERNAL_SERVER_ERROR, 'Internal server error', {
      original_error: error instanceof Error ? error.message : String(error)
    });
    logError(commercialError);
    return createErrorResponse(commercialError);
  }
});

async function sendPaymentReminders(): Promise<Response> {
  const now = new Date();
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const oneDayFromNow = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);

  let remindersSent = 0;
  let remindersFailed = 0;

  try {
    // Get payments due in 3 days (3 days before due date)
    const { data: paymentsDueIn3Days, error: error3Days } = await supabase
      .from('platform_payments')
      .select(`
        *,
        tenants (
          id,
          name,
          owner_id,
          subscription_status,
          subscription_period_ends
        )
      `)
      .eq('status', 'pending')
      .eq('currency', 'KES')
      .gte('due_date', threeDaysFromNow.toISOString())
      .lte('due_date', oneDayFromNow.toISOString())
      .limit(100);

    if (error3Days) {
      console.error('Error fetching payments due in 3 days:', error3Days);
      throw new CommercialError(ErrorCode.DATABASE_ERROR, 'Failed to fetch payments due in 3 days');
    }

    // Send pre-due reminders (3 days before due)
    for (const payment of paymentsDueIn3Days || []) {
      try {
        await sendPaymentReminder(payment, 'payment_pre_due_3_days');
        remindersSent++;
      } catch (error) {
        remindersFailed++;
        console.error(`Failed to send payment reminder for payment ${payment.id}:`, error);
      }
    }

    // Get payments due tomorrow (1 day before due date)
    const { data: paymentsDueTomorrow, error: errorTomorrow } = await supabase
      .from('platform_payments')
      .select(`
        *,
        tenants (
          id,
          name,
          owner_id,
          subscription_status,
          subscription_period_ends
        )
      `)
      .eq('status', 'pending')
      .gte('due_date', oneDayFromNow.toISOString())
      .lte('due_date', oneDayFromNow.toISOString())
      .limit(100);

    if (errorTomorrow) {
      console.error('Error fetching payments due tomorrow:', errorTomorrow);
      throw new CommercialError(ErrorCode.DATABASE_ERROR, 'Failed to fetch payments due tomorrow');
    }

    // Send pre-due reminders (1 day before due)
    for (const payment of paymentsDueTomorrow || []) {
      try {
        await sendPaymentReminder(payment, 'payment_pre_due_1_day');
        remindersSent++;
      } catch (error) {
        remindersFailed++;
        console.error(`Failed to send payment reminder for payment ${payment.id}:`, error);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Payment reminders sent successfully',
        reminders_3_days: paymentsDueIn3Days?.length || 0,
        reminders_1_day: paymentsDueTomorrow?.length || 0,
        reminders_sent: remindersSent,
        reminders_failed: remindersFailed
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    if (error instanceof CommercialError) {
      logError(error, { action: 'send_payment_reminders' });
      return createErrorResponse(error);
    }

    const commercialError = new CommercialError(ErrorCode.INTERNAL_SERVER_ERROR, 'Failed to send payment reminders', {
      original_error: error instanceof Error ? error.message : String(error)
    });
    logError(commercialError);
    return createErrorResponse(commercialError);
  }
}

async function handlePastDuePayments(): Promise<Response> {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

  let notificationsSent = 0;
  let notificationsFailed = 0;

  try {
    // Get payments that are past due but not in grace period yet
    const { data: pastDuePayments, error } = await supabase
      .from('platform_payments')
      .select(`
        *,
        tenants (
          id,
          name,
          owner_id,
          subscription_status,
          subscription_period_ends
        )
      `)
      .eq('status', 'pending')
      .lt('due_date', now.toISOString())
      .gte('due_date', oneDayAgo.toISOString())
      .limit(100);

    if (error) {
      console.error('Error fetching past due payments:', error);
      throw new CommercialError(ErrorCode.DATABASE_ERROR, 'Failed to fetch past due payments');
    }

    // Send past due notifications
    for (const payment of pastDuePayments || []) {
      try {
        await sendPaymentReminder(payment, 'payment_past_due');
        notificationsSent++;

        // Update tenant status to past_due
        await supabase
          .from('tenants')
          .update({
            subscription_status: 'past_due',
            updated_at: new Date().toISOString()
          })
          .eq('id', payment.tenants.id);

        // Log audit event
        await supabase.from('payment_audit_logs').insert({
          tenant_id: payment.tenants.id,
          event: 'past_due_notification_sent',
          details: { payment_id: payment.id, amount: payment.amount, due_date: payment.due_date },
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        notificationsFailed++;
        console.error(`Failed to send past due notification for payment ${payment.id}:`, error);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Past due notifications sent successfully',
        past_due_count: pastDuePayments?.length || 0,
        notifications_sent: notificationsSent,
        notifications_failed: notificationsFailed
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    if (error instanceof CommercialError) {
      logError(error, { action: 'handle_past_due_payments' });
      return createErrorResponse(error);
    }

    const commercialError = new CommercialError(ErrorCode.INTERNAL_SERVER_ERROR, 'Failed to handle past due payments', {
      original_error: error instanceof Error ? error.message : String(error)
    });
    logError(commercialError);
    return createErrorResponse(commercialError);
  }
}

async function handleGracePeriod(): Promise<Response> {
  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

  let notificationsSent = 0;
  let notificationsFailed = 0;

  try {
    // Get tenants in grace period (past due and grace period ending soon)
    const { data: gracePeriodTenants, error } = await supabase
      .from('tenants')
      .select(`
        *,
        platform_payments (
          id,
          amount,
          due_date
        )
      `)
      .eq('subscription_status', 'past_due')
      .gte('subscription_period_ends', twoDaysAgo.toISOString())
      .limit(100);

    if (error) {
      console.error('Error fetching grace period tenants:', error);
      throw new CommercialError(ErrorCode.DATABASE_ERROR, 'Failed to fetch grace period tenants');
    }

    // Send grace period notifications
    for (const tenant of gracePeriodTenants || []) {
      if (tenant.platform_payments && tenant.platform_payments.length > 0) {
        const latestPayment = tenant.platform_payments[0];
        try {
          await sendGracePeriodNotification(tenant, latestPayment);
          notificationsSent++;
        } catch (error) {
          notificationsFailed++;
          console.error(`Failed to send grace period notification for tenant ${tenant.id}:`, error);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Grace period notifications sent successfully',
        grace_period_count: gracePeriodTenants?.length || 0,
        notifications_sent: notificationsSent,
        notifications_failed: notificationsFailed
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    if (error instanceof CommercialError) {
      logError(error, { action: 'handle_grace_period' });
      return createErrorResponse(error);
    }

    const commercialError = new CommercialError(ErrorCode.INTERNAL_SERVER_ERROR, 'Failed to handle grace period', {
      original_error: error instanceof Error ? error.message : String(error)
    });
    logError(commercialError);
    return createErrorResponse(commercialError);
  }
}

async function suspendAccounts(): Promise<Response> {
  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

  let suspendedCount = 0;
  let suspensionFailed = 0;

  try {
    // Get tenants that should be suspended (past due and grace period ended)
    const { data: suspendableTenants, error } = await supabase
      .from('tenants')
      .select('*')
      .eq('subscription_status', 'past_due')
      .lt('subscription_period_ends', twoDaysAgo.toISOString())
      .limit(100);

    if (error) {
      console.error('Error fetching suspendable tenants:', error);
      throw new CommercialError(ErrorCode.DATABASE_ERROR, 'Failed to fetch suspendable tenants');
    }

    for (const tenant of suspendableTenants || []) {
      try {
        // Update tenant status to suspended
        const { error: updateError } = await supabase
          .from('tenants')
          .update({
            subscription_status: 'suspended',
            updated_at: new Date().toISOString()
          })
          .eq('id', tenant.id);

        if (!updateError) {
          suspendedCount++;

          // Send suspension notification
          await sendSuspensionNotification(tenant);

          // Pause all running campaigns
          await pauseTenantCampaigns(tenant.id);

          // Log audit event
          await supabase.from('payment_audit_logs').insert({
            tenant_id: tenant.id,
            event: 'account_suspended',
            details: { suspended_at: new Date().toISOString(), reason: 'non_payment' },
            timestamp: new Date().toISOString()
          });
        } else {
          suspensionFailed++;
        }
      } catch (error) {
        suspensionFailed++;
        console.error(`Failed to suspend tenant ${tenant.id}:`, error);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Account suspension process completed',
        suspended_count: suspendedCount,
        suspension_failed: suspensionFailed
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    if (error instanceof CommercialError) {
      logError(error, { action: 'suspend_accounts' });
      return createErrorResponse(error);
    }

    const commercialError = new CommercialError(ErrorCode.INTERNAL_SERVER_ERROR, 'Failed to suspend accounts', {
      original_error: error instanceof Error ? error.message : String(error)
    });
    logError(commercialError);
    return createErrorResponse(commercialError);
  }
}

// Send payment reminder email
async function sendPaymentReminder(payment: any, reminderType: string): Promise<void> {
  // Check if reminder already sent
  const { data: existingReminder } = await supabase
    .from('payment_reminders')
    .select('id')
    .eq('payment_id', payment.id)
    .eq('reminder_type', reminderType)
    .single();

  if (existingReminder) {
    return; // Reminder already sent
  }

  // Get notification template from database
  const { data: template } = await supabase
    .from('dunning_notification_templates')
    .select('subject, body')
    .eq('template_name', reminderType)
    .single();

  if (!template) {
    // Fallback to default email template
    const emailTemplate = getFallbackTemplate(reminderType);
    if (!emailTemplate) {
      throw new CommercialError(ErrorCode.EMAIL_SERVICE_ERROR, `Template not found for reminder type: ${reminderType}`);
    }

    // Prepare template variables
    const templateVariables = {
      tenant_name: payment.tenants.name,
      amount: payment.amount,
      due_date: new Date(payment.due_date).toLocaleDateString('en-KE', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    };

    // Send email using email service
    const emailResult = await emailService.sendTemplatedEmail(
      payment.tenants.owner_id,
      reminderType,
      templateVariables,
      'noreply@mobiwave.wa'
    );

    if (!emailResult.success) {
      throw new CommercialError(ErrorCode.EMAIL_SERVICE_ERROR, `Failed to send email: ${emailResult.error}`);
    }

    // Record reminder
    await supabase.from('payment_reminders').insert({
      tenant_id: payment.tenants.id,
      payment_id: payment.id,
      reminder_type: reminderType,
      status: 'sent',
      sent_at: new Date().toISOString()
    });

    return;
  }

  // Use database template
  const templateVariables = {
    tenant_name: payment.tenants.name,
    amount: payment.amount,
    due_date: new Date(payment.due_date).toLocaleDateString('en-KE', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  };

  // Replace template variables
  const subject = template.subject
    .replace(/\{\{tenant_name\}\}/g, templateVariables.tenant_name)
    .replace(/\{\{amount\}\}/g, templateVariables.amount.toString())
    .replace(/\{\{due_date\}\}/g, templateVariables.due_date);

  const body = template.body
    .replace(/\{\{tenant_name\}\}/g, templateVariables.tenant_name)
    .replace(/\{\{amount\}\}/g, templateVariables.amount.toString())
    .replace(/\{\{due_date\}\}/g, templateVariables.due_date);

  // Send email notification
  try {
    const emailResult = await emailService.sendEmail({
      to: payment.tenants.owner_id,
      from: 'noreply@mobiwave.wa',
      subject,
      html: body
    });

    if (!emailResult.success) {
      throw new CommercialError(ErrorCode.EMAIL_SERVICE_ERROR, `Failed to send email: ${emailResult.error}`);
    }

    // Record reminder
    await supabase.from('payment_reminders').insert({
      tenant_id: payment.tenants.id,
      payment_id: payment.id,
      reminder_type: reminderType,
      status: 'sent',
      sent_at: new Date().toISOString()
    });
  } catch (emailError) {
    console.error('Failed to send payment reminder:', emailError);

    // Record failed reminder
    await supabase.from('payment_reminders').insert({
      tenant_id: payment.tenants.id,
      payment_id: payment.id,
      reminder_type: reminderType,
      status: 'failed',
      failed_at: new Date().toISOString(),
      failure_reason: emailError instanceof Error ? emailError.message : String(emailError)
    });
  }
}

// Send grace period notification
async function sendGracePeriodNotification(tenant: any, payment: any): Promise<void> {
  const reminderType = 'payment_grace_period';

  // Check if reminder already sent
  const { data: existingReminder } = await supabase
    .from('payment_reminders')
    .select('id')
    .eq('tenant_id', tenant.id)
    .eq('reminder_type', reminderType)
    .single();

  if (existingReminder) {
    return;
  }

  // Get notification template from database
  const { data: notificationTemplate } = await supabase
    .from('dunning_notification_templates')
    .select('subject, body')
    .eq('template_name', reminderType)
    .single();

  if (!notificationTemplate) {
    throw new CommercialError(ErrorCode.EMAIL_SERVICE_ERROR, `Template not found for: ${reminderType}`);
  }

  // Prepare template variables
  const templateVariables = {
    tenant_name: tenant.name,
    amount: payment.amount,
    due_date: new Date(payment.due_date).toLocaleDateString('en-KE', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  };

  // Replace template variables
  const subject = notificationTemplate.subject
    .replace(/\{\{tenant_name\}\}/g, templateVariables.tenant_name)
    .replace(/\{\{amount\}\}/g, templateVariables.amount.toString())
    .replace(/\{\{due_date\}\}/g, templateVariables.due_date);

  const body = notificationTemplate.body
    .replace(/\{\{tenant_name\}\}/g, templateVariables.tenant_name)
    .replace(/\{\{amount\}\}/g, templateVariables.amount.toString())
    .replace(/\{\{due_date\}\}/g, templateVariables.due_date);

  // Send email notification
  try {
    const emailResult = await emailService.sendEmail({
      to: tenant.owner_id,
      from: 'noreply@mobiwave.wa',
      subject,
      html: body
    });

    if (!emailResult.success) {
      throw new CommercialError(ErrorCode.EMAIL_SERVICE_ERROR, `Failed to send email: ${emailResult.error}`);
    }

    // Record reminder
    await supabase.from('payment_reminders').insert({
      tenant_id: tenant.id,
      payment_id: payment.id,
      reminder_type: reminderType,
      status: 'sent',
      sent_at: new Date().toISOString()
    });
  } catch (emailError) {
    console.error('Failed to send grace period notification:', emailError);
    throw emailError;
  }
}

// Send suspension notification
async function sendSuspensionNotification(tenant: any): Promise<void> {
  const reminderType = 'payment_suspended';

  // Get notification template
  const { data: notificationTemplate } = await supabase
    .from('dunning_notification_templates')
    .select('subject, body')
    .eq('template_name', reminderType)
    .single();

  if (!notificationTemplate) {
    throw new CommercialError(ErrorCode.EMAIL_SERVICE_ERROR, `Template not found for: ${reminderType}`);
  }

  // Get latest payment for template variables
  const { data: latestPayment } = await supabase
    .from('platform_payments')
    .select('amount, due_date')
    .eq('tenant_id', tenant.id)
    .order('due_date', { ascending: false })
    .limit(1)
    .single();

  // Prepare template variables
  const templateVariables = {
    tenant_name: tenant.name,
    amount: latestPayment?.amount || 0,
    due_date: latestPayment ? new Date(latestPayment.due_date).toLocaleDateString('en-KE', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }) : 'N/A'
  };

  // Replace template variables
  const subject = notificationTemplate.subject
    .replace(/\{\{tenant_name\}\}/g, templateVariables.tenant_name)
    .replace(/\{\{amount\}\}/g, templateVariables.amount.toString())
    .replace(/\{\{due_date\}\}/g, templateVariables.due_date);

  const body = notificationTemplate.body
    .replace(/\{\{tenant_name\}\}/g, templateVariables.tenant_name)
    .replace(/\{\{amount\}\}/g, templateVariables.amount.toString())
    .replace(/\{\{due_date\}\}/g, templateVariables.due_date);

  // Send email notification
  try {
    const emailResult = await emailService.sendEmail({
      to: tenant.owner_id,
      from: 'noreply@mobiwave.wa',
      subject,
      html: body
    });

    if (!emailResult.success) {
      console.error('Failed to send suspension notification:', emailResult.error);
    }
  } catch (emailError) {
    console.error('Failed to send suspension notification:', emailError);
  }
}

// Pause tenant campaigns
async function pauseTenantCampaigns(tenantId: string): Promise<void> {
  // Get all running campaigns for this tenant
  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .in('status', ['running', 'scheduled']);

  if (!campaigns || campaigns.length === 0) {
    return;
  }

  // Pause all campaigns
  const campaignIds = campaigns.map(c => c.id);
  await supabase
    .from('campaigns')
    .update({ status: 'paused', updated_at: new Date().toISOString() })
    .in('id', campaignIds);

  // Send notifications to team members
  const { data: teamMembers } = await supabase
    .from('team_members')
    .select('user_id')
    .eq('tenant_id', tenantId);

  if (teamMembers && teamMembers.length > 0) {
    const pausedCount = campaigns.length;
    for (const member of teamMembers) {
      await supabase
        .from('workspace_notifications')
        .insert({
          tenant_id: tenantId,
          user_id: member.user_id,
          type: 'campaign_paused',
          title: 'Campaigns Paused',
          message: 'All campaigns have been paused due to subscription suspension.',
          data: { paused_count: pausedCount }
        });
    }
  }
}

// Get fallback email template when database template is not available
function getFallbackTemplate(templateName: string): any | null {
  const fallbackTemplates: Record<string, { subject: string; body: string }> = {
    payment_pre_due_3_days: {
      subject: 'Payment Reminder - Your subscription is due in 3 days',
      body: 'Dear {{tenant_name}}, your payment of KES {{amount}} is due in 3 days on {{due_date}}.'
    },
    payment_pre_due_1_day: {
      subject: 'URGENT: Payment Reminder - Your subscription is due tomorrow',
      body: 'Dear {{tenant_name}}, your payment of KES {{amount}} is due tomorrow on {{due_date}}.'
    },
    payment_past_due: {
      subject: 'Your MobiWave subscription payment is now past due',
      body: 'Dear {{tenant_name}}, your payment of KES {{amount}} due on {{due_date}} is now past due.'
    },
    payment_grace_period: {
      subject: 'FINAL NOTICE: Your account will be suspended in 2 days',
      body: 'Dear {{tenant_name}}, your payment of KES {{amount}} is past due. Account will be suspended in 2 days.'
    },
    payment_suspended: {
      subject: 'Your MobiWave account has been suspended',
      body: 'Dear {{tenant_name}}, your account has been suspended due to non-payment of KES {{amount}}.'
    }
  };

  return fallbackTemplates[templateName] ?? null;
}