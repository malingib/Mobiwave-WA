import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  CommercialError,
  ErrorCode,
  createErrorResponse,
  logError,
  withRetry,
  isRetryableError
} from "../_shared/error-handling.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

// Rate limiting: in-memory store for request counts per IP + endpoint
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = {
  default: 100,
  admin: 500,
  enterprise: 1000
};

// Get rate limit for a tenant based on subscription tier
function getRateLimitForTenant(subscriptionStatus: string): number {
  switch (subscriptionStatus) {
    case 'enterprise': return RATE_LIMIT_MAX_REQUESTS.enterprise;
    case 'pro': return RATE_LIMIT_MAX_REQUESTS.admin;
    default: return RATE_LIMIT_MAX_REQUESTS.default;
  }
}

// Check rate limit
function checkRateLimit(identifier: string, maxRequests: number): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(identifier);

  // Clean up expired entries
  if (entry && now > entry.resetTime) {
    rateLimitStore.delete(identifier);
  }

  const currentEntry = rateLimitStore.get(identifier) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };

  if (currentEntry.count >= maxRequests) {
    const retryAfter = Math.ceil((currentEntry.resetTime - now) / 1000);
    return { allowed: false, retryAfter: Math.max(1, retryAfter) };
  }

  currentEntry.count++;
  rateLimitStore.set(identifier, currentEntry);

  return { allowed: true };
}

// Error handling wrapper for unified API
async function handleRequest(req: Request): Promise<Response> {
  try {
    // Check for platform proxy secret
    const platformProxySecret = req.headers.get('X-Platform-Proxy');
    const expectedSecret = Deno.env.get('PLATFORM_PROXY_SECRET');

    if (!platformProxySecret || platformProxySecret !== expectedSecret) {
      throw new CommercialError(ErrorCode.UNAUTHORIZED, 'Invalid platform proxy secret');
    }

    const url = new URL(req.url);
    const path = url.pathname.replace('/functions/v1/unified-api', '');
    const method = req.method;

    // Parse request body
    let body: any;
    if (method !== 'GET' && method !== 'HEAD') {
      try {
        body = await req.json();
      } catch {
        body = await req.text();
      }
    }

    // Route requests based on path
    switch (path) {
      case '/messages/send':
        return await handleSendMessage(body, method);
      case '/messages':
        return await handleGetMessages(body, method);
      case '/campaigns':
        return await handleCampaigns(body, method);
      case '/templates':
        return await handleTemplates(body, method);
      case '/tenants':
        return await handleTenants(body, method);
      case '/billing':
        return await handleBilling(body, method);
      case '/team':
        return await handleTeam(body, method);
      case '/usage':
        return await handleUsage(body, method);
      case '/webhooks':
        return await handleWebhooks(body, method);
      default:
        throw new CommercialError(ErrorCode.API_ENDPOINT_NOT_FOUND, 'API endpoint not found');
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
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Handle request with error handling
  return await handleRequest(req);
});

async function handleSendMessage(body: any, method: string): Promise<Response> {
  if (method !== 'POST') {
    throw new CommercialError(ErrorCode.API_METHOD_NOT_ALLOWED, 'Method not allowed');
  }

  // Validate required fields
  const requiredFields = ['tenant_id', 'message', 'recipients'];
  for (const field of requiredFields) {
    if (!body[field]) {
      throw new CommercialError(ErrorCode.MISSING_REQUIRED_FIELD, `Missing required field: ${field}`);
    }
  }

  const { tenant_id, message, recipients } = body;

  // Rate limiting check
  const rateLimitResult = checkRateLimit(`message:${tenant_id}`, 60);
  if (!rateLimitResult.allowed) {
    throw new CommercialError(
      ErrorCode.API_RATE_LIMIT_EXCEEDED,
      'Rate limit exceeded for message sending',
      { retry_after: rateLimitResult.retryAfter },
      rateLimitResult.retryAfter
    );
  }

  // Check tenant entitlements
  const { data: entitlements, error: entitlementError } = await supabase
    .rpc('tenant_entitlements', { tenant_id });

  if (entitlementError || !entitlements) {
    throw new CommercialError(ErrorCode.INTERNAL_SERVER_ERROR, 'Failed to check tenant entitlements');
  }

  // Check if tenant can send messages
  if (entitlements.subscription_status === 'suspended' ||
      entitlements.subscription_status === 'paused' ||
      entitlements.subscription_status === 'canceled') {
    throw new CommercialError(ErrorCode.SUBSCRIPTION_SUSPENDED, 'Account suspended. Please contact support.');
  }

  // Check Meta allowance
  if (entitlements.meta_allowance_remaining <= 0) {
    throw new CommercialError(ErrorCode.INSUFFICIENT_ALLOWANCE, 'Meta message allowance exceeded. Please upgrade your plan.');
  }

  // Call meta-send function with retry logic
  try {
    const response = await withRetry(async () => {
      const fetchResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/meta-send`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${body.token || ''}`,
          'Content-Type': 'application/json',
          'X-Platform-Proxy': Deno.env.get('PLATFORM_PROXY_SECRET') || ''
        },
        body: JSON.stringify({
          message,
          recipients,
          tenant_id
        })
      });

      if (!fetchResponse.ok) {
        const errorText = await fetchResponse.text();
        throw new CommercialError(
          ErrorCode.EXTERNAL_SERVICE_ERROR,
          `Meta send API error: ${fetchResponse.status}`,
          { status: fetchResponse.status, response: errorText }
        );
      }

      return fetchResponse.json();
    }, 3, 1000);

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    if (error instanceof CommercialError) {
      logError(error, { action: 'send_message', tenant_id });
      return createErrorResponse(error);
    }

    const commercialError = new CommercialError(ErrorCode.PAYMENT_FAILED, 'Failed to send message', {
      original_error: error instanceof Error ? error.message : String(error),
      tenant_id
    });
    logError(commercialError);
    return createErrorResponse(commercialError);
  }
}

async function handleGetMessages(body: any, method: string): Promise<Response> {
  if (method !== 'GET') {
    throw new CommercialError(ErrorCode.API_METHOD_NOT_ALLOWED, 'Method not allowed');
  }

  const { tenant_id, limit = 50, offset = 0 } = body;

  if (!tenant_id) {
    throw new CommercialError(ErrorCode.MISSING_REQUIRED_FIELD, 'Missing tenant_id');
  }

  // Rate limiting check
  const rateLimitResult = checkRateLimit(`messages:${tenant_id}`, 120);
  if (!rateLimitResult.allowed) {
    throw new CommercialError(
      ErrorCode.API_RATE_LIMIT_EXCEEDED,
      'Rate limit exceeded for message retrieval',
      { retry_after: rateLimitResult.retryAfter },
      rateLimitResult.retryAfter
    );
  }

  // Check tenant entitlements
  const { data: entitlements, error: entitlementError } = await supabase
    .rpc('tenant_entitlements', { tenant_id });

  if (entitlementError || !entitlements) {
    throw new CommercialError(ErrorCode.INTERNAL_SERVER_ERROR, 'Failed to check tenant entitlements');
  }

  // For suspended accounts, only allow viewing inbound messages if they have visibility
  if (entitlements.subscription_status === 'suspended') {
    throw new CommercialError(ErrorCode.SUBSCRIPTION_SUSPENDED, 'Account suspended. Please contact support.');
  }

  // Get messages
  const { data: messages, error } = await supabase
    .from('messages')
    .select(`
      id,
      conversation_id,
      direction,
      content,
      status,
      created_at,
      updated_at,
      metadata,
      conversations (
        contact_name,
        contact_phone,
        contact_waba_id
      )
    `)
    .eq('tenant_id', tenant_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new CommercialError(ErrorCode.DATABASE_ERROR, 'Failed to fetch messages');
  }

  return new Response(
    JSON.stringify({
      success: true,
      messages,
      total: messages?.length || 0,
      limit,
      offset
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
  );
}

async function handleCampaigns(body: any, method: string): Promise<Response> {
  const { tenant_id } = body;

  if (!tenant_id) {
    throw new CommercialError(ErrorCode.MISSING_REQUIRED_FIELD, 'Missing tenant_id');
  }

  // Rate limiting check
  const rateLimitResult = checkRateLimit(`campaigns:${tenant_id}`, 30);
  if (!rateLimitResult.allowed) {
    throw new CommercialError(
      ErrorCode.API_RATE_LIMIT_EXCEEDED,
      'Rate limit exceeded for campaign operations',
      { retry_after: rateLimitResult.retryAfter },
      rateLimitResult.retryAfter
    );
  }

  // Check tenant entitlements
  const { data: entitlements, error: entitlementError } = await supabase
    .rpc('tenant_entitlements', { tenant_id });

  if (entitlementError || !entitlements) {
    throw new CommercialError(ErrorCode.INTERNAL_SERVER_ERROR, 'Failed to check tenant entitlements');
  }

  // Check if tenant can create campaigns
  if (entitlements.subscription_status === 'suspended' ||
      entitlements.subscription_status === 'paused' ||
      entitlements.subscription_status === 'canceled') {
    throw new CommercialError(ErrorCode.SUBSCRIPTION_SUSPENDED, 'Account suspended. Please contact support.');
  }

  if (method === 'GET') {
    // Get campaigns
    const { data: campaigns, error } = await supabase
      .from('campaigns')
      .select(`
        id,
        name,
        description,
        status,
        created_at,
        updated_at,
        scheduled_at,
        completed_at,
        template_id,
        contact_count,
        sent_count,
        failed_count,
        tenant_id
      `)
      .eq('tenant_id', tenant_id)
      .order('created_at', { ascending: false });

    if (error) {
      throw new CommercialError(ErrorCode.DATABASE_ERROR, 'Failed to fetch campaigns');
    }

    return new Response(
      JSON.stringify({
        success: true,
        campaigns
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } else if (method === 'POST') {
    // Create campaign
    const requiredFields = ['name', 'template_id', 'contacts'];
    for (const field of requiredFields) {
      if (!body[field]) {
        throw new CommercialError(ErrorCode.MISSING_REQUIRED_FIELD, `Missing required field: ${field}`);
      }
    }

    // Check template belongs to tenant
    const { data: template } = await supabase
      .from('message_templates')
      .select('id, tenant_id')
      .eq('id', body.template_id)
      .eq('tenant_id', tenant_id)
      .single();

    if (!template) {
      throw new CommercialError(ErrorCode.INVALID_TENANT, 'Template not found or access denied');
    }

    // Create campaign
    const { data: campaign, error } = await supabase
      .from('campaigns')
      .insert({
        tenant_id,
        name: body.name,
        description: body.description,
        template_id: body.template_id,
        status: 'draft',
        contact_count: body.contacts?.length || 0,
        scheduled_at: body.scheduled_at || null
      })
      .select()
      .single();

    if (error) {
      throw new CommercialError(ErrorCode.DATABASE_ERROR, 'Failed to create campaign');
    }

    return new Response(
      JSON.stringify({
        success: true,
        campaign
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 201 }
    );
  }

  throw new CommercialError(ErrorCode.API_METHOD_NOT_ALLOWED, 'Method not allowed');
}

async function handleTemplates(body: any, method: string): Promise<Response> {
  const { tenant_id } = body;

  if (!tenant_id) {
    throw new CommercialError(ErrorCode.MISSING_REQUIRED_FIELD, 'Missing tenant_id');
  }

  if (method === 'GET') {
    // Get templates
    const { data: templates, error } = await supabase
      .from('message_templates')
      .select(`
        id,
        name,
        category,
        content,
        variables,
        created_at,
        updated_at,
        tenant_id
      `)
      .eq('tenant_id', tenant_id)
      .order('created_at', { ascending: false });

    if (error) {
      throw new CommercialError(ErrorCode.DATABASE_ERROR, 'Failed to fetch templates');
    }

    return new Response(
      JSON.stringify({
        success: true,
        templates
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  }

  throw new CommercialError(ErrorCode.API_METHOD_NOT_ALLOWED, 'Method not allowed');
}

async function handleTenants(body: any, method: string): Promise<Response> {
  if (method !== 'GET') {
    throw new CommercialError(ErrorCode.API_METHOD_NOT_ALLOWED, 'Method not allowed');
  }

  const { id } = body;

  if (!id) {
    throw new CommercialError(ErrorCode.MISSING_REQUIRED_FIELD, 'Missing tenant_id');
  }

  // Get tenant with entitlements
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select(`
      id,
      name,
      subscription_status,
      subscription_period_ends,
      created_at,
      updated_at,
      tenant_meta_allowance (
        meta_allowance_remaining,
        meta_allowance_reset_date,
        meta_allowance_used
      )
    `)
    .eq('id', id)
    .single();

  if (error || !tenant) {
    throw new CommercialError(ErrorCode.INVALID_TENANT, 'Tenant not found');
  }

  return new Response(
    JSON.stringify({
      success: true,
      tenant
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
  );
}

async function handleBilling(body: any, method: string): Promise<Response> {
  const { tenant_id } = body;

  if (!tenant_id) {
    throw new CommercialError(ErrorCode.MISSING_REQUIRED_FIELD, 'Missing tenant_id');
  }

  if (method === 'GET') {
    // Get billing information
    const { data: invoices, error: invoicesError } = await supabase
      .from('platform_invoices')
      .select(`
        id,
        invoice_number,
        amount,
        meta_cost,
        total_amount,
        status,
        due_date,
        paid_at,
        created_at
      `)
      .eq('tenant_id', tenant_id)
      .order('created_at', { ascending: false });

    if (invoicesError) {
      throw new CommercialError(ErrorCode.DATABASE_ERROR, 'Failed to fetch invoices');
    }

    // Get payments
    const { data: payments, error: paymentsError } = await supabase
      .from('platform_payments')
      .select(`
        id,
        amount,
        status,
        payment_method,
        due_date,
        paid_at,
        created_at
      `)
      .eq('tenant_id', tenant_id)
      .order('created_at', { ascending: false });

    if (paymentsError) {
      throw new CommercialError(ErrorCode.DATABASE_ERROR, 'Failed to fetch payments');
    }

    return new Response(
      JSON.stringify({
        success: true,
        invoices,
        payments
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  }

  throw new CommercialError(ErrorCode.API_METHOD_NOT_ALLOWED, 'Method not allowed');
}

async function handleTeam(body: any, method: string): Promise<Response> {
  const { tenant_id } = body;

  if (!tenant_id) {
    throw new CommercialError(ErrorCode.MISSING_REQUIRED_FIELD, 'Missing tenant_id');
  }

  if (method === 'GET') {
    // Get team members
    const { data: team, error } = await supabase
      .from('team_members')
      .select(`
        id,
        role,
        created_at,
        updated_at,
        users (
          id,
          email,
          created_at
        )
      `)
      .eq('tenant_id', tenant_id);

    if (error) {
      throw new CommercialError(ErrorCode.DATABASE_ERROR, 'Failed to fetch team members');
    }

    return new Response(
      JSON.stringify({
        success: true,
        team
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } else if (method === 'POST') {
    // Add team member
    const requiredFields = ['user_id', 'role'];
    for (const field of requiredFields) {
      if (!body[field]) {
        throw new CommercialError(ErrorCode.MISSING_REQUIRED_FIELD, `Missing required field: ${field}`);
      }
    }

    // Validate role
    if (!['admin', 'editor'].includes(body.role)) {
      throw new CommercialError(ErrorCode.INVALID_ROLE, 'Invalid role. Must be admin or editor');
    }

    // Check if user exists
    const { data: user } = await supabase
      .from('auth.users')
      .select('id')
      .eq('id', body.user_id)
      .single();

    if (!user) {
      throw new CommercialError(ErrorCode.INVALID_TENANT, 'User not found');
    }

    // Check if user is already a team member
    const { data: existingMember } = await supabase
      .from('team_members')
      .select('id')
      .eq('tenant_id', tenant_id)
      .eq('user_id', body.user_id)
      .single();

    if (existingMember) {
      throw new CommercialError(ErrorCode.API_ENDPOINT_NOT_FOUND, 'User is already a team member');
    }

    // Add team member
    const { data: member, error } = await supabase
      .from('team_members')
      .insert({
        tenant_id,
        user_id: body.user_id,
        role: body.role
      })
      .select()
      .single();

    if (error) {
      throw new CommercialError(ErrorCode.DATABASE_ERROR, 'Failed to add team member');
    }

    return new Response(
      JSON.stringify({
        success: true,
        member
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 201 }
    );
  }

  throw new CommercialError(ErrorCode.API_METHOD_NOT_ALLOWED, 'Method not allowed');
}

async function handleUsage(body: any, method: string): Promise<Response> {
  const { tenant_id } = body;

  if (!tenant_id) {
    throw new CommercialError(ErrorCode.MISSING_REQUIRED_FIELD, 'Missing tenant_id');
  }

  if (method !== 'GET') {
    throw new CommercialError(ErrorCode.API_METHOD_NOT_ALLOWED, 'Method not allowed');
  }

  // Get usage statistics
  const { data: stats, error } = await supabase
    .from('tenant_usage_stats')
    .select('*')
    .eq('tenant_id', tenant_id)
    .order('period_start', { ascending: false })
    .limit(30);

  if (error) {
    throw new CommercialError(ErrorCode.DATABASE_ERROR, 'Failed to fetch usage statistics');
  }

  return new Response(
    JSON.stringify({
      success: true,
      stats
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
  );
}

async function handleWebhooks(body: any, method: string): Promise<Response> {
  const { tenant_id, webhook_url, events } = body;

  if (!tenant_id || !webhook_url || !events) {
    throw new CommercialError(ErrorCode.MISSING_REQUIRED_FIELD, 'Missing required fields');
  }

  if (method === 'POST') {
    // Create or update webhook
    const { data: webhook, error } = await supabase
      .from('webhooks')
      .upsert({
        tenant_id,
        webhook_url,
        events,
        is_active: true,
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      throw new CommercialError(ErrorCode.DATABASE_ERROR, 'Failed to save webhook');
    }

    return new Response(
      JSON.stringify({
        success: true,
        webhook
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 201 }
    );
  }

  throw new CommercialError(ErrorCode.API_METHOD_NOT_ALLOWED, 'Method not allowed');
}