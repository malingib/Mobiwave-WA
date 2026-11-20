import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // This is a webhook endpoint, no authentication required
    const body = await req.json();
    
    // Log webhook payload for debugging
    console.log('M-Pesa webhook received:', JSON.stringify(body, null, 2));
    
    // Daraja STK Push callbacks: { Body: { stkCallback: {...} } }
    if (body?.Body?.stkCallback) {
      await handleStkCallback(body.Body.stkCallback);
    } else if (body?.Body?.callbackConfirmationResult) {
      await handlePaymentConfirmation(body.Body.callbackConfirmationResult);
    } else {
      console.error('Unknown M-Pesa webhook type:', body);
      return new Response(
        JSON.stringify({ error: 'Unknown webhook type' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }
    
    return new Response(
      JSON.stringify({ success: true, message: 'Webhook processed successfully' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    console.error('M-Pesa webhook error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

async function handleStkCallback(callbackResult: any): Promise<void> {
  if (!callbackResult || callbackResult.ResultCode === undefined) {
    throw new Error('Invalid STK callback payload');
  }
  
  const merchantRequestID = callbackResult.MerchantRequestID;
  const checkoutRequestID = callbackResult.CheckoutRequestID;
  const resultCode = callbackResult.ResultCode;
  const resultDesc = callbackResult.ResultDesc || '';
  
  // Find the transaction in our database
  const { data: transaction, error: transactionError } = await supabase
    .from('mpesa_transactions')
    .select('*')
    .eq('checkout_request_id', checkoutRequestID)
    .single();
  
  if (transactionError || !transaction) {
    console.error('Transaction not found for checkout request ID:', checkoutRequestID);
    return;
  }
  
  // Update transaction status
  let status = 'pending';
  if (resultCode === 0) {
    status = 'completed';
  } else if (resultCode === 1) {
    status = 'failed';
  }
  
  await supabase
    .from('mpesa_transactions')
    .update({
      status: status,
      result_code: resultCode,
      result_description: resultDesc,
      updated_at: new Date().toISOString()
    })
    .eq('id', transaction.id);
  
  // Update payment status
  await supabase
    .from('platform_payments')
    .update({
      status: status,
      updated_at: new Date().toISOString()
    })
    .eq('mpesa_transaction_id', transaction.id);
  
  // If payment completed, handle successful payment
  if (status === 'completed') {
    await handleSuccessfulPayment(transaction.tenant_id, transaction.amount);
  }
  
  console.log(`STK callback processed: ${status} for transaction ${transaction.id}`);
}

async function handlePaymentConfirmation(callbackResult: any): Promise<void> {
  if (!callbackResult || callbackResult.ResultCode === undefined) {
    throw new Error('Invalid payment confirmation payload');
  }
  
  const resultCode = callbackResult.ResultCode;
  const resultDesc = callbackResult.ResultDesc || '';
  const transactionID = callbackResult.TransactionID || '';
  const receiptNumber = callbackResult.ReceiptNumber || '';
  
  // Find the transaction by M-Pesa transaction ID
  const { data: transaction, error: transactionError } = await supabase
    .from('mpesa_transactions')
    .select('*')
    .eq('transaction_id', transactionID)
    .single();
  
  if (transactionError || !transaction) {
    console.error('Transaction not found for M-Pesa transaction ID:', transactionID);
    return;
  }
  
  // Update transaction status
  let status = 'pending';
  if (resultCode === 0) {
    status = 'completed';
  } else if (resultCode === 1) {
    status = 'failed';
  }
  
  await supabase
    .from('mpesa_transactions')
    .update({
      status: status,
      result_code: resultCode,
      result_description: resultDesc,
      response_code: resultCode.toString(),
      response_description: resultDesc,
      updated_at: new Date().toISOString()
    })
    .eq('id', transaction.id);
  
  // Update payment status
  await supabase
    .from('platform_payments')
    .update({
      status: status,
      updated_at: new Date().toISOString()
    })
    .eq('mpesa_transaction_id', transaction.id);
  
  // If payment completed, handle successful payment
  if (status === 'completed') {
    await handleSuccessfulPayment(transaction.tenant_id, transaction.amount);
  }
  
  console.log(`Payment confirmation processed: ${status} for transaction ${transaction.id}`);
}

async function handleSuccessfulPayment(tenant_id: string, amount: number): Promise<void> {
  console.log(`Processing successful payment of KES ${amount} for tenant ${tenant_id}`);
  
  // Get tenant's current subscription
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('subscription_status, subscription_period_ends')
    .eq('id', tenant_id)
    .single();
  
  if (tenantError || !tenant) {
    console.error('Failed to fetch tenant:', tenantError);
    return;
  }
  
  // Update subscription status
  const newStatus = 'active';
  const subscriptionPeriodEnds = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
  
  await supabase
    .from('tenants')
    .update({
      subscription_status: newStatus,
      subscription_period_ends: subscriptionPeriodEnds.toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', tenant_id);
  
  // Create invoice
  const invoiceNumber = `MW-${tenant_id}-${Date.now()}`;
  const invoiceDate = new Date().toISOString();
  
  await supabase.from('platform_invoices').insert({
    tenant_id,
    invoice_number: invoiceNumber,
    amount: amount,
    meta_cost: 0, // Will be calculated separately based on usage
    total_amount: amount,
    status: 'paid',
    due_date: invoiceDate,
    paid_at: invoiceDate
  });
  
  // Send payment confirmation notification
  await supabase
    .from('workspace_notifications')
    .insert({
      tenant_id,
      type: 'payment_success',
      title: 'Payment Successful',
      message: `Your payment of KES ${amount} has been processed successfully.`,
      data: { 
        amount, 
        invoice_number: invoiceNumber,
        subscription_period_ends: subscriptionPeriodEnds.toISOString()
      }
    });
  
  // Reactivate any suspended campaigns
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
}