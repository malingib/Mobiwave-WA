// Email service for MobiWave WA commercial functions
// Supports multiple email providers: Resend (default), SendGrid, AWS SES

import {
  CommercialError,
  ErrorCode,
  logError
} from "./error-handling.ts";

export interface EmailProvider {
  name: string;
  sendEmail(params: EmailParams): Promise<EmailResult>;
}

export interface EmailParams {
  to: string;
  from: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  content: string;
  contentType?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider?: string;
}

// Resend email provider
export class ResendEmailProvider implements EmailProvider {
  name = 'resend';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async sendEmail(params: EmailParams): Promise<EmailResult> {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: params.from,
          to: [params.to],
          subject: params.subject,
          html: params.html,
          text: params.text,
          reply_to: params.replyTo,
          attachments: params.attachments
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Resend API error: ${response.status} - ${errorText}`,
          provider: this.name
        };
      }

      const data = await response.json();
      return {
        success: true,
        messageId: data.id,
        provider: this.name
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        provider: this.name
      };
    }
  }
}

// SendGrid email provider
export class SendGridEmailProvider implements EmailProvider {
  name = 'sendgrid';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async sendEmail(params: EmailParams): Promise<EmailResult> {
    try {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          personalizations: [{
            to: [{ email: params.to }],
            subject: params.subject,
            reply_to: params.replyTo ? [{ email: params.replyTo }] : undefined
          }],
          from: { email: params.from },
          content: params.html
            ? [{ type: 'text/html', value: params.html }]
            : [{ type: 'text/plain', value: params.text || '' }],
          attachments: params.attachments?.map(att => ({
            content: att.content,
            filename: att.filename,
            type: att.contentType || 'application/octet-stream',
            disposition: 'attachment'
          }))
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `SendGrid API error: ${response.status} - ${errorText}`,
          provider: this.name
        };
      }

      return {
        success: true,
        messageId: response.headers.get('X-Message-Id') ?? undefined,
        provider: this.name
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        provider: this.name
      };
    }
  }
}

// Email service with provider fallback and retry logic
export class EmailService {
  private providers: EmailProvider[] = [];
  private readonly maxRetries: number = 3;
  private readonly retryDelayMs: number = 2000;

  constructor(providers: EmailProvider[]) {
    this.providers = providers;
  }

  // Add a provider
  addProvider(provider: EmailProvider): void {
    this.providers.push(provider);
  }

  // Send email with retry logic and provider fallback
  async sendEmail(params: EmailParams): Promise<EmailResult> {
    const lastErrors: Array<{ provider: string; error: string }> = [];

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      for (const provider of this.providers) {
        try {
          const result = await provider.sendEmail(params);
          if (result.success) {
            logInfo(`Email sent successfully via ${provider.name} to ${params.to}`);
            return result;
          }
          // Provider failed, try next provider
          lastErrors.push({ provider: provider.name, error: result.error || 'Unknown error' });
        } catch (error) {
          lastErrors.push({ provider: provider.name, error: error instanceof Error ? error.message : String(error) });
        }
      }

      // All providers failed on this attempt, wait before retry
      if (attempt < this.maxRetries) {
        await new Promise(resolve => setTimeout(resolve, this.retryDelayMs * attempt));
      }
    }

    // All attempts failed
    const errorMessage = `Failed to send email after ${this.maxRetries} attempts. Last errors: ${JSON.stringify(lastErrors)}`;
    logError(new CommercialError(ErrorCode.EMAIL_SERVICE_ERROR, errorMessage, { lastErrors }));

    return {
      success: false,
      error: errorMessage,
      provider: 'none'
    };
  }

  // Send templated email
  async sendTemplatedEmail(
    to: string,
    templateName: string,
    variables: Record<string, string>,
    from: string = 'noreply@mobiwave.wa'
  ): Promise<EmailResult> {
    const template = getEmailTemplate(templateName);
    if (!template) {
      throw new CommercialError(ErrorCode.EMAIL_SERVICE_ERROR, `Email template not found: ${templateName}`);
    }

    // Replace template variables
    let subject = template.subject;
    let body = template.body;

    for (const [key, value] of Object.entries(variables)) {
      subject = subject.replace(new RegExp(`{{${key}}}`, 'g'), value);
      body = body.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }

    return this.sendEmail({
      to,
      from,
      subject,
      html: body
    });
  }

  // Send batch emails
  async sendBatchEmails(
    emails: Array<{ to: string; templateName: string; variables: Record<string, string> }>,
    from: string = 'noreply@mobiwave.wa'
  ): Promise<Array<{ email: string; success: boolean; error?: string }>> {
    const results = await Promise.allSettled(
      emails.map(async ({ to, templateName, variables }) => {
        try {
          const result = await this.sendTemplatedEmail(to, templateName, variables, from);
          return { email: to, success: result.success, error: result.error };
        } catch (error) {
          return { email: to, success: false, error: error instanceof Error ? error.message : String(error) };
        }
      })
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return { email: emails[index].to, success: false, error: result.reason instanceof Error ? result.reason.message : String(result.reason) };
    });
  }
}

// Email template management
export interface EmailTemplate {
  name: string;
  subject: string;
  body: string;
  isActive: boolean;
}

// Default email templates
const defaultEmailTemplates: EmailTemplate[] = [
  {
    name: 'payment_pre_due_3_days',
    subject: 'Payment Reminder - Your subscription is due in 3 days',
    body: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #2563eb;">Payment Reminder</h2>
          <p>Dear {{tenant_name}},</p>
          <p>This is a reminder that your MobiWave subscription payment of <strong>KES {{amount}}</strong> is due in <strong>3 days</strong> (due on {{due_date}}).</p>
          <p>Please ensure your payment is processed to avoid any service interruption. You can make payments through your MobiWave dashboard.</p>
          <p>If you have any questions about your subscription, please contact our support team.</p>
          <p>Best regards,<br>The MobiWave Team</p>
        </div>
      </body>
      </html>
    `,
    isActive: true
  },
  {
    name: 'payment_pre_due_1_day',
    subject: 'URGENT: Payment Reminder - Your subscription is due tomorrow',
    body: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #dc2626;">URGENT: Payment Reminder</h2>
          <p>Dear {{tenant_name}},</p>
          <p>This is an urgent reminder that your MobiWave subscription payment of <strong>KES {{amount}}</strong> is due <strong>tomorrow</strong> (due on {{due_date}}).</p>
          <p>Please ensure your payment is processed immediately to avoid any service interruption. You can make payments through your MobiWave dashboard.</p>
          <p>If you have any questions about your subscription, please contact our support team.</p>
          <p>Best regards,<br>The MobiWave Team</p>
        </div>
      </body>
      </html>
    `,
    isActive: true
  },
  {
    name: 'payment_past_due',
    subject: 'Your MobiWave subscription payment is now past due',
    body: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #dc2626;">Payment Past Due</h2>
          <p>Dear {{tenant_name}},</p>
          <p>Your MobiWave subscription payment of <strong>KES {{amount}}</strong> was due on {{due_date}} and is now past due.</p>
          <p>Please make your payment immediately to restore full access to your account. You can make payments through your MobiWave dashboard.</p>
          <p>If payment is not received within 2 days, your account will be temporarily suspended and you will lose access to all MobiWave services including inbound message visibility.</p>
          <p>If you have any questions about your subscription, please contact our support team.</p>
          <p>Best regards,<br>The MobiWave Team</p>
        </div>
      </body>
      </html>
    `,
    isActive: true
  },
  {
    name: 'payment_grace_period',
    subject: 'FINAL NOTICE: Your account will be suspended in 2 days',
    body: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #dc2626;">Final Notice</h2>
          <p>Dear {{tenant_name}},</p>
          <p>This is a final notice that your MobiWave subscription payment of <strong>KES {{amount}}</strong> is now past due and your account will be suspended in <strong>2 days</strong>.</p>
          <p>After suspension, you will lose access to all MobiWave services including inbound message visibility. All campaigns will be paused and no messages will be sent or received.</p>
          <p>Please make your payment immediately to avoid suspension. You can make payments through your MobiWave dashboard.</p>
          <p>If you have any questions about your subscription, please contact our support team.</p>
          <p>Best regards,<br>The MobiWave Team</p>
        </div>
      </body>
      </html>
    `,
    isActive: true
  },
  {
    name: 'payment_suspended',
    subject: 'Your MobiWave account has been suspended',
    body: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #dc2626;">Account Suspended</h2>
          <p>Dear {{tenant_name}},</p>
          <p>Your MobiWave account has been suspended due to non-payment of <strong>KES {{amount}}</strong> that was due on {{due_date}}.</p>
          <p>You currently have no access to any MobiWave services. To reactivate your account, please make the outstanding payment through your MobiWave dashboard. Once payment is received, your account will be automatically reactivated within 1 hour.</p>
          <p>If you believe this is an error or need to discuss alternative payment arrangements, please contact our support team.</p>
          <p>Best regards,<br>The MobiWave Team</p>
        </div>
      </body>
      </html>
    `,
    isActive: true
  },
  {
    name: 'payment_success',
    subject: 'Payment Successful',
    body: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #16a34a;">Payment Successful</h2>
          <p>Dear {{tenant_name}},</p>
          <p>Your payment of <strong>KES {{amount}}</strong> has been processed successfully.</p>
          <p>Invoice Number: {{invoice_number}}</p>
          <p>Your subscription has been reactivated and all services are now available.</p>
          <p>Best regards,<br>The MobiWave Team</p>
        </div>
      </body>
      </html>
    `,
    isActive: true
  },
  {
    name: 'team_invitation',
    subject: "You've been invited to join {{tenant_name}} on MobiWave WA",
    body: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #2563eb;">Team Invitation</h2>
          <p>You've been invited to join <strong>{{tenant_name}}</strong> on MobiWave WA as a <strong>{{role}}</strong>.</p>
          <p>Click the button below to accept the invitation:</p>
          <a href="{{invitation_url}}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 4px; font-weight: bold;">Accept Invitation</a>
          <p>If the button doesn't work, you can copy and paste this URL into your browser:</p>
          <p>{{invitation_url}}</p>
          <p>This invitation will expire in 7 days.</p>
          <p>If you didn't request this invitation, you can safely ignore this email.</p>
        </div>
      </body>
      </html>
    `,
    isActive: true
  },
  {
    name: 'campaign_paused',
    subject: 'Campaigns Paused',
    body: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #dc2626;">Campaigns Paused</h2>
          <p>Dear {{tenant_name}},</p>
          <p>All campaigns have been paused due to subscription suspension.</p>
          <p>Paused campaigns: {{paused_count}}</p>
          <p>To reactivate campaigns, please make the outstanding payment through your MobiWave dashboard.</p>
          <p>Best regards,<br>The MobiWave Team</p>
        </div>
      </body>
      </html>
    `,
    isActive: true
  },
  {
    name: 'campaign_reactivated',
    subject: 'Campaigns Reactivated',
    body: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #16a34a;">Campaigns Reactivated</h2>
          <p>Dear {{tenant_name}},</p>
          <p>All campaigns have been reactivated after successful payment.</p>
          <p>Reactivated campaigns: {{reactivated_count}}</p>
          <p>Best regards,<br>The MobiWave Team</p>
        </div>
      </body>
      </html>
    `,
    isActive: true
  }
];

// Get email template by name
export function getEmailTemplate(templateName: string): EmailTemplate | null {
  return defaultEmailTemplates.find(t => t.name === templateName && t.isActive) ?? null;
}

// Logging utility
function logInfo(message: string): void {
  console.log(`[EmailService] ${new Date().toISOString()} - ${message}`);
}

// Create email service instance
export function createEmailService(): EmailService {
  const providers: EmailProvider[] = [];

  // Add Resend provider if API key is configured
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  if (resendApiKey) {
    providers.push(new ResendEmailProvider(resendApiKey));
  }

  // Add SendGrid provider if API key is configured
  const sendgridApiKey = Deno.env.get('SENDGRID_API_KEY');
  if (sendgridApiKey) {
    providers.push(new SendGridEmailProvider(sendgridApiKey));
  }

  // If no providers configured, use a no-op provider (for development)
  if (providers.length === 0) {
    providers.push({
      name: 'noop',
      sendEmail: async (params: EmailParams): Promise<EmailResult> => {
        console.log(`[No-op Email] Sending email to ${params.to}: ${params.subject}`);
        return { success: true, messageId: `noop-${Date.now()}`, provider: 'noop' };
      }
    });
  }

  return new EmailService(providers);
}