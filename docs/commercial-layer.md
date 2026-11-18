# MobiWave WA Commercial Layer Documentation

## Overview

The commercial layer for MobiWave WA implements a complete billing and subscription management system with the following components:

1. **Commercial Entitlements** - Subscription state management
2. **Meta Allowance Tracking** - 1,000 free Meta messages per month
3. **M-Pesa Integration** - Local payment processing in Kenya
4. **Platform Billing** - KES + VAT invoicing system
5. **Team Management** - Admin and Editor roles
6. **Usage Analytics** - Real-time usage tracking
7. **Dunning System** - Automated payment reminders and suspensions
8. **Unified API** - Secured API gateway

## Architecture

### State Machine

The commercial layer uses a state machine for subscription management:

```
unassigned → trialing → active → past_due → grace → suspended → canceled
```

- **unassigned**: No subscription assigned
- **trialing**: 14-day trial period
- **active**: Paid and active subscription
- **past_due**: Payment overdue
- **grace**: 2-day grace period
- **suspended**: Service suspended for non-payment
- **canceled**: Subscription canceled

### Database Schema

#### Core Tables

1. **tenants** - Tenant information with subscription status
2. **tenant_meta_allowance** - Meta message allowance tracking
3. **platform_invoices** - Platform billing invoices
4. **platform_payments** - Payment records
5. **mpesa_config** - M-Pesa configuration
6. **mpesa_transactions** - M-Pesa transaction records
7. **team_members** - Team member management
8. **payment_reminders** - Dunning system reminders
9. **payment_audit_logs** - Audit trail for all payment events

#### Shared Modules

1. **error-handling** - Comprehensive error codes and handling utilities
2. **payment-utils** - Payment verification, validation, idempotency, locking
3. **email-service** - Multi-provider email service with retry logic
4. **vat-calculation** - VAT calculation and invoice generation

#### Key Functions

1. **tenant_entitlements** - Returns current tenant entitlements
2. **tenant_meta_allowance** - Returns Meta allowance status
3. **checkSendAccess** - Validates if tenant can send messages
4. **get_payment_audit_logs** - Retrieves payment audit logs with pagination
5. **get_payment_summary** - Returns payment summary statistics
6. **is_tenant_suspended** - Checks if tenant account is suspended

## Implementation Details

### 1. Commercial Entitlements

The system uses a single RPC call `tenant_entitlements` to check:

- Subscription status
- Send access permissions
- Meta allowance status
- Plan tier information

```sql
CREATE OR REPLACE FUNCTION tenant_entitlements(p_tenant_id uuid)
RETURNS TABLE (
  subscription_status text,
  entitlement_state text,
  can_send boolean,
  meta_allowance_remaining integer,
  meta_allowance_used integer,
  meta_allowance_limit integer,
  tier_name text,
  tier_features jsonb
) AS $$
BEGIN
  -- Implementation details...
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 2. Meta Allowance Tracking

Each tenant gets 1,000 free delivered service messages per month per business phone number:

- **Free tier**: 1,000 messages/month
- **Billing**: Starts from message #1 for marketing/utility/auth templates
- **Reset**: At 12am Messaging-account timezone
- **Tracking**: Real-time remaining balance in UI

### 3. M-Pesa Integration

The M-Pesa integration includes:

- STK Push for payments
- Transaction status callbacks
- Payment validation
- Automatic subscription updates
- **Idempotency key tracking** - Prevents duplicate payment processing
- **Payment lock mechanism** - Prevents concurrent payment attempts
- **Retry logic** - Exponential backoff for transient failures

#### Configuration

```typescript
interface MpesaConfig {
  consumer_key: string;
  consumer_secret: string;
  shortcode: string;
  passkey: string;
  callback_url: string;
  environment: 'sandbox' | 'production';
}
```

### 7. Error Handling

The commercial layer implements comprehensive error handling:

- **Structured error codes** - All errors have specific codes for programmatic handling
- **Retry logic** - Exponential backoff for transient failures
- **Comprehensive logging** - All errors logged with context and stack traces
- **Rate limiting** - API rate limiting per tenant and endpoint
- **Audit logging** - All payment events audited for compliance

Error codes include authentication, authorization, validation, payment, subscription, team management, API, database, external service, and system errors.

### 8. Email Service

The email service supports multiple providers:

- **Resend** - Primary email provider
- **SendGrid** - Secondary provider with fallback
- **No-op** - Development mode when no provider configured

Features:
- Provider fallback - Automatically tries next provider on failure
- Retry logic - Retries failed email deliveries
- Template system - Pre-built email templates for all notification types
- Batch sending - Send multiple emails efficiently

### 9. VAT Calculation

The VAT calculation module supports Kenyan VAT regulations:

- **16% VAT rate** - Standard Kenyan VAT rate
- **Configurable rate** - VAT rate can be configured per environment
- **Line item support** - VAT calculation per invoice line item
- **Meta cost pass-through** - Meta costs not subject to VAT
- **Invoice generation** - Complete invoice with VAT breakdown

## Shared Modules Reference

### error-handling.ts

Provides:
- `ErrorCode` enum - All error codes
- `CommercialError` class - Structured error class
- `createErrorResponse()` - Creates HTTP error responses
- `withRetry()` - Retry mechanism with exponential backoff
- `isRetryableError()` - Check if error should be retried
- `logError()` - Error logging utility

### payment-utils.ts

Provides:
- `PaymentValidator` - Amount, phone number, and currency validation
- `PaymentVerificationService` - Server-side payment verification
- `PaymentLock` - Distributed payment lock mechanism
- `IdempotencyTracker` - Idempotency key tracking with TTL
- `PaymentFormatter` - Currency formatting utilities
- `PaymentAuditor` - Payment audit logging

### email-service.ts

Provides:
- `EmailService` - Multi-provider email service
- `ResendEmailProvider` - Resend provider implementation
- `SendGridEmailProvider` - SendGrid provider implementation
- `createEmailService()` - Factory function with provider fallback
- Default email templates for all notification types

### vat-calculation.ts

Provides:
- `VATCalculator` - VAT calculation engine
- `InvoiceGenerator` - Invoice generation with VAT breakdown
- `KENYAN_VAT_RATE` - Default 16% Kenyan VAT rate
- `formatKES()` - Kenyan shilling currency formatter
- `formatVATRate()` - VAT rate percentage formatter

### 4. Platform Billing

- **Currency**: KES + VAT (local Kenyan currency)
- **Invoicing**: Monthly invoices with separate Meta cost line item
- **Payment Methods**: M-Pesa only (as per requirements)
- **Dunning**: 3-day and 1-day before due, 2-day grace period

### 5. Team Management

- **Roles**: Admin and Editor (no free tier as per requirements)
- **Access**: All team members have access to all features
- **Invitations**: Email-based invitation system
- **Permissions**: Role-based access control

### 6. Usage Analytics

Real-time tracking of:

- Messages sent/received
- Campaigns launched
- Templates created
- Storage usage
- Meta allowance usage

### 7. Dunning System

Automated dunning workflow:

1. **3 days before due**: Payment reminder email
2. **1 day before due**: Urgent payment reminder
3. **Past due**: Payment failure notification
4. **Grace period**: Final notice before suspension
5. **After grace**: Account suspension

### 8. Unified API

Secured API gateway that:

- Masks Supabase endpoints
- Provides unified API documentation
- Handles authentication properly
- Enforces tier limits

## Frontend Components

### 1. BillingPage

- M-Pesa configuration
- Payment initiation
- Invoice history
- Payment status tracking

### 2. TeamPage

- Team member management
- Role assignment
- Invitations
- Member removal

### 3. UsagePage

- Usage analytics
- Meta allowance tracking
- Storage monitoring
- Usage alerts

## Deployment

### Prerequisites

1. Supabase CLI installed
2. Environment variables configured
3. M-Pesa developer account (for production)

### Deployment Steps

1. Run the deployment script:
```bash
chmod +x deploy-commercial.sh
./deploy-commercial.sh
```

2. Update environment variables:
```bash
# Add to .env.local
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
PLATFORM_PROXY_SECRET=your_platform_proxy_secret
```

3. Configure M-Pesa credentials in the billing interface

### Environment Variables

```env
# Supabase configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
PLATFORM_PROXY_SECRET=your_platform_proxy_secret

# Dunning worker token (for scheduled cron jobs)
DUNNING_WORKER_TOKEN=your_dunning_worker_token_here

# M-Pesa configuration (production)
MPESA_CONSUMER_KEY=your_consumer_key
MPESA_CONSUMER_SECRET=your_consumer_secret
MPESA_SHORTCODE=your_shortcode
MPESA_PASSKEY=your_passkey
MPESA_CALLBACK_URL=https://yourdomain.com/api/mpesa-webhook
MPESA_ENVIRONMENT=sandbox

# Email service (optional)
RESEND_API_KEY=your_resend_api_key
SENDGRID_API_KEY=your_sendgrid_api_key
EMAIL_FROM=noreply@mobiwave.wa

# VAT configuration
VAT_RATE=0.16  # Kenyan VAT rate (16%)

# Application URLs
APP_URL=http://localhost:5173
VITE_APP_URL=http://localhost:5173

# Security configuration
SESSION_SECRET=your_session_secret_here
ENCRYPTION_KEY=your_encryption_key_here

# Feature flags
ENABLE_EMAIL_NOTIFICATIONS=true
ENABLE_DUNNING_SYSTEM=true
ENABLE_MPESA_PAYMENTS=true
```

### Scheduled Jobs

The commercial layer uses cron jobs for automated dunning:

- **Hourly**: Send payment reminders (3 days, 1 day before due)
- **Every 6 hours**: Check grace period (2-day grace period)
- **Daily at midnight**: Suspend accounts past grace period

## Performance Optimization

### Database Indexes

Indexes added for frequently queried columns:

- Tenants: subscription_status, owner_id, subscription_period_ends
- Platform invoices: tenant_id, status, created_at
- Platform payments: tenant_id, status, mpesa_transaction_id, due_date, created_at
- M-Pesa transactions: tenant_id, status, checkout_request_id, created_at
- Team members: tenant_id, user_id, role
- Payment reminders: tenant_id, payment_id, status, created_at, reminder_type
- Messages: tenant_id, direction, created_at, status
- Campaigns: tenant_id, status, created_at
- Message templates: tenant_id, category
- Workspace notifications: tenant_id, user_id, type, created_at

### Caching Strategy

- Idempotency keys cached for 24 hours with automatic cleanup
- Rate limiting in-memory store with 1-minute window
- M-Pesa access token cached with automatic refresh

## Testing

### Test Script

Run the test script to verify all components:

```bash
chmod +x test-commercial.sh
./test-commercial.sh
```

### Test Scenarios

1. **Payment Flow Testing**
   - M-Pesa STK Push initiation
   - Payment callback handling
   - Subscription update on successful payment
   - Idempotency key validation

2. **Dunning System Testing**
   - Payment reminder emails
   - Grace period handling
   - Account suspension logic
   - Admin reactivation capability

3. **Team Management Testing**
   - Member invitation
   - Role assignment
   - Permission enforcement
   - Member removal

4. **Usage Analytics Testing**
   - Real-time tracking
   - Alert generation
   - Data accuracy

5. **Error Handling Testing**
   - Invalid authentication tokens
   - Missing required fields
   - Payment failures
   - Network timeout handling

6. **Email Service Testing**
   - Email delivery with provider fallback
   - Retry logic for failed emails
   - Template variable substitution

## Security Considerations

1. **API Security**: All API endpoints require `X-Platform-Proxy` header
2. **Data Encryption**: Sensitive data encrypted at rest
3. **Access Control**: Role-based access for all operations
4. **Webhook Security**: Signature verification for all webhooks
5. **Payment Security**: PCI-compliant payment processing

## Monitoring and Observability

1. **Usage Metrics**: Track all usage patterns
2. **Payment Analytics**: Monitor payment success/failure rates
3. **Error Tracking**: Comprehensive error logging
4. **Performance Monitoring**: API performance metrics
5. **Alert System**: Automated alerts for critical issues

## Troubleshooting

### Common Issues

1. **Payment Failures**: Check M-Pesa configuration and network connectivity
2. **Webhook Failures**: Verify callback URLs and signatures
3. **Permission Errors**: Check role assignments and access control
4. **API Issues**: Verify platform proxy secret configuration

### Debug Mode

Enable debug mode by setting:

```env
DEBUG=*
```

This will provide detailed logging for troubleshooting.

## Future Enhancements

1. **Additional Payment Methods**: Cards, bank transfers
2. **Advanced Analytics**: Detailed usage reports
3. **Custom Tiers**: Custom pricing plans
4. **Multi-currency Support**: International payments
5. **Advanced Team Management**: More granular permissions

## Support

For support and questions:

1. Check the troubleshooting section
2. Review the API documentation
3. Contact support@mobiwave.co.ke
4. Create an issue on GitHub

---

*This documentation covers the commercial layer implementation for MobiWave WA. For more information about specific components, refer to the relevant documentation files.*