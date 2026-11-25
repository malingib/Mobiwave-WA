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
  PaymentValidator,
  PaymentVerificationService,
  PaymentFormatter,
  PaymentAuditor,
  PaymentLock,
  IdempotencyTracker
} from "../_shared/payment-utils.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

interface MpesaConfig {
  id: string;
  consumer_key: string;
  consumer_secret: string;
  shortcode: string;
  passkey: string;
  callback_url: string;
  environment: 'sandbox' | 'production';
}

interface MpesaTransaction {
  id: string;
  tenant_id: string;
  checkout_request_id: string;
  amount: number;
  phone_number: string;
  status: string;
  created_at: string;
}

interface MpesaResponse {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResponseCode: string;
  ResponseDescription: string;
  CustomerMessage: string;
}

interface PaymentRequest {
  tenant_id: string;
  amount: number;
  phone_number: string;
  invoice_id?: string;
  action?: string;
  transaction_id?: string;
}

// Helper function to check if user is team member
async function isTeamMember(user_id: string, tenant_id: string): Promise<boolean> {
  const { data } = await supabase
    .from('team_members')
    .select('id')
    .eq('user_id', user_id)
    .eq('tenant_id', tenant_id)
    .single();

  return !!data;
}

// Handle successful payment with proper verification and audit logging
async function handleSuccessfulPayment(
  tenant_id: string,
  amount: number,
  transaction_id: string
): Promise<void> {
  console.log(`Processing successful payment of KES ${amount} for tenant ${tenant_id}`);

  // Acquire payment lock to prevent race conditions
  const releaseLock = await PaymentLock.acquire(`payment:${tenant_id}`);

  try {
    // Check idempotency - skip if already processed
    const idempotencyKey = `payment_processed:${tenant_id}:${transaction_id}`;
    if (await IdempotencyTracker.exists(idempotencyKey)) {
      console.log(`Payment ${transaction_id} already processed for tenant ${tenant_id}`);
      return;
    }

    // Mark as processed
    await IdempotencyTracker.track(idempotencyKey, { processed_at: new Date().toISOString() });

    // Update tenant subscription status
    await supabase
      .from('tenants')
      .update({
        subscription_status: 'active',
        subscription_period_ends: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', tenant_id);

    // Create invoice
    const invoiceNumber = `MW-${tenant_id}-${Date.now()}`;
    const invoiceDate = new Date().toISOString();

    await supabase.from('platform_invoices').insert({
      tenant_id,
      invoice_number: invoiceNumber,
      amount,
      meta_cost: 0,
      total_amount: amount,
      status: 'paid',
      due_date: invoiceDate,
      paid_at: invoiceDate
    });

    // Log payment audit event
    await PaymentAuditor.logPaymentEvent(
      supabase,
      tenant_id,
      'payment_successful',
      { amount, transaction_id: transactionId, invoice_number: invoiceNumber, processed_at: invoiceDate }
    );

    // Send payment confirmation notification
    await supabase
      .from('workspace_notifications')
      .insert({
        tenant_id,
        type: 'payment_success',
        title: 'Payment Successful',
        message: `Your payment of KES ${amount} has been processed successfully.`,
        data: { amount, invoice_number: invoiceNumber, subscription_period_ends: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() }
      });

    // Reactivate any paused campaigns
    const { data: campaigns } = await supabase
      .from('campaigns')
      .select('id')
      .eq('tenant_id', tenant_id)
      .eq('status', 'paused');

    if (campaigns && campaigns.length > 0) {
      const campaignIds = campaigns.map(c => c.id);
      await supabase
        .from('campaigns')
        .update({ status: 'running', updated_at: new Date().toISOString() })
        .in('id', campaignIds);

      // Send notifications to team members
      const { data: teamMembers } = await supabase
        .from('team_members')
        .select('user_id')
        .eq('tenant_id', tenant_id);

      if (teamMembers && teamMembers.length > 0) {
        for (const member of teamMembers) {
          await supabase
            .from('workspace_notifications')
            .insert({
              tenant_id,
              user_id: member.user_id,
              type: 'campaign_reactivated',
              title: 'Campaigns Reactivated',
              message: 'All campaigns have been reactivated after successful payment.',
              data: { reactivated_count: campaigns.length }
            });
        }
      }
    }

    console.log(`Successfully processed payment for tenant ${tenant_id}`);
  } finally {
    releaseLock();
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Validate authorization header
    const authorization = req.headers.get('Authorization');
    if (!authorization || !authorization.startsWith('Bearer ')) {
      throw new CommercialError(ErrorCode.UNAUTHORIZED, 'Missing or invalid authorization header');
    }

    const token = authorization.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      throw new CommercialError(ErrorCode.INVALID_TOKEN, 'Invalid authentication token');
    }

    // Parse request body
    const body = await req.json() as PaymentRequest;
    const { tenant_id, amount, phone_number } = body;

    if (!tenant_id) {
      throw new CommercialError(ErrorCode.MISSING_REQUIRED_FIELD, 'Missing tenant_id');
    }

    // Access is granted via workspace membership (tenants has no owner_id column).
    const { data: membership, error: membershipError } = await supabase
      .from('tenant_members')
      .select('role')
      .eq('tenant_id', tenant_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (membershipError || !membership || !['owner', 'admin'].includes(membership.role)) {
      throw new CommercialError(ErrorCode.FORBIDDEN, 'No access to this tenant');
    }

    // Supabase invokes the bare function path; the action comes from the JSON body.
    // (Path-style actions remain supported for direct callers.)
    const pathAction = new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? '';
    const action = String(body.action ?? (pathAction === 'mpesa-integrate' ? '' : pathAction));

    switch (action) {
      case 'initiate':
        return await initiatePayment(req, tenant_id, body);
      case 'status':
        return await checkPaymentStatus(body, tenant_id);
      case 'config':
        return await getMpesaConfig(tenant_id);
      case 'save-config':
        return await saveMpesaConfig(body as unknown as MpesaConfig & { id?: string }, tenant_id, user.id);
      default:
        throw new CommercialError(ErrorCode.API_ENDPOINT_NOT_FOUND, 'Invalid action');
    }
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

async function initiatePayment(_req: Request, tenant_id: string, paymentRequest: PaymentRequest): Promise<Response> {
  // Validate required fields
  if (!paymentRequest.amount) {
    throw new CommercialError(ErrorCode.MISSING_REQUIRED_FIELD, 'Missing amount');
  }
  if (!paymentRequest.phone_number) {
    throw new CommercialError(ErrorCode.MISSING_REQUIRED_FIELD, 'Missing phone_number');
  }

  // Validate payment amount
  PaymentValidator.validateAmount(paymentRequest.amount);

  // Validate phone number format
  PaymentValidator.validatePhoneNumber(paymentRequest.phone_number);

  // Acquire payment lock to prevent concurrent payment attempts
  const releaseLock = await PaymentLock.acquire(`payment_initiate:${tenant_id}`);

  try {
    // Check idempotency - skip if payment already initiated
    const idempotencyKey = `payment_initiated:${tenant_id}:${paymentRequest.amount}:${paymentRequest.phone_number}`;
    if (await IdempotencyTracker.exists(idempotencyKey)) {
      const cachedData = await IdempotencyTracker.get(idempotencyKey);
      return new Response(
        JSON.stringify({
          success: true,
          checkout_request_id: cachedData?.checkout_request_id,
          transaction_id: cachedData?.transaction_id,
          status: 'already_initiated'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Get M-Pesa config
    const { data: mpesaConfig, error: configError } = await supabase
      .from('mpesa_config')
      .select('*')
      .eq('tenant_id', tenant_id)
      .eq('is_active', true)
      .single();

    if (configError || !mpesaConfig) {
      throw new CommercialError(ErrorCode.MPESA_CONFIG_MISSING, 'M-Pesa configuration not found');
    }

    // Generate timestamp
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);

    // Generate password
    const password = btoa(`${mpesaConfig.shortcode}${mpesaConfig.passkey}${timestamp}`);

    // Create STK Push request
    const stkPushUrl = mpesaConfig.environment === 'production'
      ? 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
      : 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

    const stkPushRequest = {
      BusinessShortCode: mpesaConfig.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(paymentRequest.amount * 100), // Convert to cents
      PartyA: paymentRequest.phone_number,
      PartyB: mpesaConfig.shortcode,
      PhoneNumber: paymentRequest.phone_number,
      CallBackURL: mpesaConfig.callback_url,
      AccountReference: `MobiWave-${tenant_id}`,
      TransactionDesc: `MobiWave Subscription Payment`
    };

    // Make request to M-Pesa with retry logic
    const mpesaResponse = await withRetry(async () => {
      const response = await fetch(stkPushUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await getAccessToken(mpesaConfig)}`
        },
        body: JSON.stringify(stkPushRequest)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new CommercialError(
          ErrorCode.MPESA_API_ERROR,
          `M-Pesa STK Push failed: ${response.status}`,
          { status: response.status, response: errorText }
        );
      }

      return response.json() as Promise<MpesaResponse>;
    }, 3, 1000);

    const data = mpesaResponse;

    // Save transaction to database
    const checkoutRequestId = data.CheckoutRequestID;
    const transactionId = `MPESA_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await supabase.from('mpesa_transactions').insert({
      id: transactionId,
      tenant_id,
      transaction_id: transactionId,
      checkout_request_id: checkoutRequestId,
      amount: paymentRequest.amount,
      phone_number: paymentRequest.phone_number,
      status: 'pending',
      created_at: new Date().toISOString()
    });

    // Create payment record
    await supabase.from('platform_payments').insert({
      tenant_id,
      amount: paymentRequest.amount,
      currency: 'KES',
      status: 'pending',
      mpesa_transaction_id: transactionId,
      payment_method: 'mpesa',
      due_date: new Date().toISOString(),
      created_at: new Date().toISOString()
    });

    // Cache idempotency key
    await IdempotencyTracker.track(idempotencyKey, {
      checkout_request_id: checkoutRequestId,
      transaction_id: transactionId,
      amount: paymentRequest.amount,
      phone_number: paymentRequest.phone_number,
      initiated_at: new Date().toISOString()
    });

    // Log payment audit event
    await PaymentAuditor.logPaymentEvent(
      supabase,
      tenant_id,
      'payment_initiated',
      { amount: paymentRequest.amount, phone_number: paymentRequest.phone_number, transaction_id: transactionId, checkout_request_id: checkoutRequestId }
    );

    return new Response(
      JSON.stringify({
        success: true,
        checkout_request_id: checkoutRequestId,
        transaction_id: transactionId
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    if (error instanceof CommercialError) {
      logError(error, { action: 'initiate_payment', tenant_id });
      return createErrorResponse(error);
    }

    const commercialError = new CommercialError(ErrorCode.PAYMENT_FAILED, 'Failed to initiate M-Pesa payment', {
      original_error: error instanceof Error ? error.message : String(error),
      tenant_id
    });
    logError(commercialError);
    return createErrorResponse(commercialError);
  } finally {
    releaseLock();
  }
}

async function checkPaymentStatus(body: PaymentRequest, tenant_id: string): Promise<Response> {
  const { transaction_id } = body;

  if (!transaction_id) {
    throw new CommercialError(ErrorCode.MISSING_REQUIRED_FIELD, 'Missing transaction_id');
  }

  // Get transaction details
  const { data: transaction, error: transactionError } = await supabase
    .from('mpesa_transactions')
    .select('*')
    .eq('tenant_id', tenant_id)
    .eq('transaction_id', transaction_id)
    .single();

  if (transactionError || !transaction) {
    throw new CommercialError(ErrorCode.INVALID_TENANT, 'Transaction not found');
  }

  // Check if transaction is still pending
  if (transaction.status === 'pending') {
    // Get M-Pesa config
    const { data: mpesaConfig, error: configError } = await supabase
      .from('mpesa_config')
      .select('*')
      .eq('tenant_id', tenant_id)
      .eq('is_active', true)
      .single();

    if (configError || !mpesaConfig) {
      throw new CommercialError(ErrorCode.MPESA_CONFIG_MISSING, 'M-Pesa configuration not found');
    }

    // Query transaction status with retry logic
    const statusData = await withRetry(async () => {
      const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
      const password = btoa(`${mpesaConfig.shortcode}${mpesaConfig.passkey}${timestamp}`);

      const statusUrl = mpesaConfig.environment === 'production'
        ? 'https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query'
        : 'https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query';

      const statusRequest = {
        BusinessShortCode: mpesaConfig.shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: transaction.checkout_request_id
      };

      const response = await fetch(statusUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await getAccessToken(mpesaConfig)}`
        },
        body: JSON.stringify(statusRequest)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new CommercialError(
          ErrorCode.MPESA_API_ERROR,
          `M-Pesa status check failed: ${response.status}`,
          { status: response.status, response: errorText }
        );
      }

      return response.json();
    }, 3, 1000);

    // Update transaction status
    let newStatus = 'pending';
    if (statusData.ResponseCode === '0') {
      newStatus = 'completed';
    } else if (statusData.ResponseCode === '1') {
      newStatus = 'failed';
    }

    await supabase
      .from('mpesa_transactions')
      .update({
        status: newStatus,
        result_code: parseInt(statusData.ResponseCode),
        result_description: statusData.ResponseDescription,
        updated_at: new Date().toISOString()
      })
      .eq('id', transaction.id);

    // Update payment status
    await supabase
      .from('platform_payments')
      .update({
        status: newStatus === 'completed' ? 'completed' : 'failed',
        updated_at: new Date().toISOString()
      })
      .eq('mpesa_transaction_id', transaction_id);

    // If payment completed, handle successful payment
    if (newStatus === 'completed') {
      await handleSuccessfulPayment(tenant_id, transaction.amount, transaction_id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        status: newStatus,
        transaction: transaction
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      status: transaction.status,
      transaction: transaction
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
  );
}

async function getMpesaConfig(tenant_id: string): Promise<Response> {
  const { data: config, error } = await supabase
    .from('mpesa_config')
    .select('*')
    .eq('tenant_id', tenant_id)
    .eq('is_active', true)
    .single();

  if (error) {
    throw new CommercialError(ErrorCode.MPESA_CONFIG_MISSING, 'M-Pesa configuration not found');
  }

  // Mask sensitive fields
  const maskedConfig = {
    ...config,
    consumer_key: config.consumer_key ? '****' + config.consumer_key.slice(-4) : null,
    consumer_secret: config.consumer_secret ? '****' + config.consumer_secret.slice(-4) : null,
    passkey: config.passkey ? '****' : null
  };

  return new Response(
    JSON.stringify({ success: true, config: maskedConfig }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
  );
}

async function saveMpesaConfig(config: MpesaConfig & { id?: string }, tenant_id: string, user_id: string): Promise<Response> {
  // Only workspace owners may change payment credentials.
  const { data: membership } = await supabase
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenant_id)
    .eq('user_id', user_id)
    .maybeSingle();

  if (membership?.role !== 'owner') {
    throw new CommercialError(ErrorCode.FORBIDDEN, 'Only tenant owners can configure M-Pesa');
  }

  if (config.id) {
    // Update existing config
    const { error } = await supabase
      .from('mpesa_config')
      .update({
        consumer_key: config.consumer_key,
        consumer_secret: config.consumer_secret,
        shortcode: config.shortcode,
        passkey: config.passkey,
        callback_url: config.callback_url,
        environment: config.environment,
        updated_at: new Date().toISOString()
      })
      .eq('id', config.id)
      .eq('tenant_id', tenant_id);

    if (error) {
      throw new CommercialError(ErrorCode.DATABASE_ERROR, 'Failed to update M-Pesa configuration');
    }
  } else {
    // Create new config
    const { error } = await supabase
      .from('mpesa_config')
      .insert({
        tenant_id,
        consumer_key: config.consumer_key,
        consumer_secret: config.consumer_secret,
        shortcode: config.shortcode,
        passkey: config.passkey,
        callback_url: config.callback_url,
        environment: config.environment
      });

    if (error) {
      throw new CommercialError(ErrorCode.DATABASE_ERROR, 'Failed to save M-Pesa configuration');
    }
  }

  return new Response(
    JSON.stringify({ success: true, message: 'M-Pesa configuration saved successfully' }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
  );
}

// Helper function to get M-Pesa access token
async function getAccessToken(config: MpesaConfig): Promise<string> {
  const authUrl = config.environment === 'production'
    ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
    : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';

  const response = await fetch(authUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(`${config.consumer_key}:${config.consumer_secret}`)}`
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new CommercialError(
      ErrorCode.MPESA_API_ERROR,
      `Failed to get M-Pesa access token: ${response.status}`,
      { status: response.status, response: errorText }
    );
  }

  const data = await response.json();
  return data.access_token;
}