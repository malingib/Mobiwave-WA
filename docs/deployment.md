# MobiWave WA Deployment Guide

## Prerequisites

- Supabase CLI installed
- Supabase project created
- Environment variables configured

## Deployment Steps

### 1. Set Environment Variables

Create a `.env` file with the required variables:

```bash
# Supabase Configuration
PROJECT_REF=jyjgvsljcmvbhovzevaz
SUPABASE_ACCESS_TOKEN=your_supabase_access_token_here

# M-Pesa Configuration (for production)
MPESA_CONSUMER_KEY=your_consumer_key
MPESA_CONSUMER_SECRET=your_consumer_secret
MPESA_SHORTCODE=your_shortcode
MPESA_PASSKEY=your_passkey
MPESA_CALLBACK_URL=https://your-domain.com/api/webhooks/mpesa

# Email Service (choose one)
RESEND_API_KEY=your_resend_key
# OR
SENDGRID_API_KEY=your_sendgrid_key

# WhatsApp Business API
WABA_ACCESS_TOKEN=your_waba_token
```

### 2. Deploy Functions

```bash
# Deploy all commercial functions
supabase functions deploy mpesa-integrate --project-ref $PROJECT_REF
supabase functions deploy dunning-worker --project-ref $PROJECT_REF
supabase functions deploy unified-api --project-ref $PROJECT_REF
supabase functions deploy team-management --project-ref $PROJECT_REF
supabase functions deploy mpesa-webhook --project-ref $PROJECT_REF
```

### 3. Run Database Migrations

```bash
# Apply all migrations
supabase db push --project-ref $PROJECT_REF
```

### 4. Set Environment Variables for Functions

```bash
supabase functions update mpesa-integrate --project-ref $PROJECT_REF --env-file .env
supabase functions update dunning-worker --project-ref $PROJECT_REF --env-file .env
supabase functions update unified-api --project-ref $PROJECT_REF --env-file .env
supabase functions update team-management --project-ref $PROJECT_REF --env-file .env
supabase functions update mpesa-webhook --project-ref $PROJECT_REF --env-file .env
```

### 5. Set Up Scheduled Jobs

```bash
# Create dunning cron jobs
supabase cron create "0 * * * *" dunning-hourly --project-ref $PROJECT_REF
supabase cron create "0 */6 * * *" dunning-grace-period --project-ref $PROJECT_REF
supabase cron create "0 0 * * *" dunning-suspend --project-ref $PROJECT_REF
```

### 6. Configure Webhook URLs

Set up the following webhook URLs in your Supabase dashboard:
- WhatsApp Webhook: `https://your-domain.com/api/webhooks/whatsapp`
- M-Pesa Webhook: `https://your-domain.com/api/webhooks/mpesa`

## Production Considerations

### Security
- Use environment variables for all sensitive data
- Implement proper authentication and authorization
- Use HTTPS for all endpoints
- Implement rate limiting

### Performance
- Monitor function execution times
- Set up proper error handling and logging
- Use database indexes for optimal performance

### Monitoring
- Set up monitoring for function errors
- Monitor database performance
- Track payment processing metrics

### Backup
- Regular database backups
- Configuration backups
- Log file rotation

## Testing

### Payment Flow Testing
1. Test M-Pesa sandbox environment
2. Verify payment webhook handling
3. Test dunning system scenarios
4. Test subscription state changes

### Function Testing
- Test all edge cases
- Verify error handling
- Test concurrent requests
- Test rate limiting

## Troubleshooting

### Common Issues
- Function deployment failures
- Database migration errors
- Webhook configuration issues
- Environment variable problems

### Debug Commands
```bash
# Check function logs
supabase functions logs mpesa-integrate --project-ref $PROJECT_REF

# Check database status
supabase db status --project-ref $PROJECT_REF

# Test webhook locally
curl -X POST https://your-domain.com/api/webhooks/mpesa -H "Content-Type: application/json" -d '{"test": true}'
```