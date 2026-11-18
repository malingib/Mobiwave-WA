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
    const authorization = req.headers.get('Authorization');
    if (!authorization || !authorization.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid authorization header' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    const token = authorization.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication token' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    const { action, ...data } = await req.json() as { action: string; [key: string]: any };
    
    switch (action) {
      case 'get-team':
        return await getTeam(user.id, data.tenant_id);
      case 'add-member':
        return await addTeamMember(user.id, data);
      case 'remove-member':
        return await removeTeamMember(user.id, data);
      case 'update-role':
        return await updateTeamMemberRole(user.id, data);
      case 'get-invitations':
        return await getTeamInvitations(user.id, data.tenant_id);
      case 'send-invitation':
        return await sendTeamInvitation(user.id, data);
      case 'revoke-invitation':
        return await revokeTeamInvitation(user.id, data);
      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
    }
  } catch (error) {
    console.error('Team management error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

async function getTeam(user_id: string, tenant_id: string): Promise<Response> {
  if (!tenant_id) {
    return new Response(
      JSON.stringify({ error: 'Missing tenant_id' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }

  // Check if user has access to this tenant
  const { data: tenant } = await supabase
    .from('tenants')
    .select('owner_id')
    .eq('id', tenant_id)
    .single();

  if (!tenant || (tenant.owner_id !== user_id && !isTeamMember(user_id, tenant_id))) {
    return new Response(
      JSON.stringify({ error: 'No access to this tenant' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
    );
  }

  // Get team members with user details
  const { data: team, error } = await supabase
    .from('team_members')
    .select(`
      id,
      role,
      created_at,
      users (
        id,
        email,
        created_at,
        user_metadata
      )
    `)
    .eq('tenant_id', tenant_id)
    .order('created_at', { ascending: true });

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch team members' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }

  // Get pending invitations
  const { data: invitations } = await supabase
    .from('team_invitations')
    .select(`
      id,
      email,
      role,
      created_at,
      expires_at
    `)
    .eq('tenant_id', tenant_id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  return new Response(
    JSON.stringify({ 
      success: true,
      team: team || [],
      invitations: invitations || []
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
  );
}

async function addTeamMember(user_id: string, data: any): Promise<Response> {
  const { tenant_id, user_id: new_user_id, role } = data;

  if (!tenant_id || !new_user_id || !role) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }

  // Check if user is tenant owner
  const { data: tenant } = await supabase
    .from('tenants')
    .select('owner_id')
    .eq('id', tenant_id)
    .single();

  if (!tenant || tenant.owner_id !== user_id) {
    return new Response(
      JSON.stringify({ error: 'Only tenant owners can add team members' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
    );
  }

  // Validate role
  if (!['admin', 'editor'].includes(role)) {
    return new Response(
      JSON.stringify({ error: 'Invalid role. Must be admin or editor' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }

  // Check if user already exists
  const { data: existingUser } = await supabase
    .from('auth.users')
    .select('id')
    .eq('id', new_user_id)
    .single();

  if (!existingUser) {
    return new Response(
      JSON.stringify({ error: 'User not found' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
    );
  }

  // Check if user is already a team member
  const { data: existingMember } = await supabase
    .from('team_members')
    .select('id')
    .eq('tenant_id', tenant_id)
    .eq('user_id', new_user_id)
    .single();

  if (existingMember) {
    return new Response(
      JSON.stringify({ error: 'User is already a team member' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }

  // Add team member
  const { data: member, error } = await supabase
    .from('team_members')
    .insert({
      tenant_id,
      user_id: new_user_id,
      role
    })
    .select()
    .single();

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to add team member' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }

  // Send notification to new team member
  await supabase
    .from('workspace_notifications')
    .insert({
      tenant_id,
      user_id: new_user_id,
      type: 'team_added',
      title: 'Added to Team',
      message: `You have been added to the ${tenant_id} team as ${role}.`,
      data: { role }
    });

  return new Response(
    JSON.stringify({ 
      success: true,
      member
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 201 }
  );
}

async function removeTeamMember(user_id: string, data: any): Promise<Response> {
  const { tenant_id, member_id } = data;

  if (!tenant_id || !member_id) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }

  // Check if user is tenant owner
  const { data: tenant } = await supabase
    .from('tenants')
    .select('owner_id')
    .eq('id', tenant_id)
    .single();

  if (!tenant || tenant.owner_id !== user_id) {
    return new Response(
      JSON.stringify({ error: 'Only tenant owners can remove team members' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
    );
  }

  // Check if member exists
  const { data: member } = await supabase
    .from('team_members')
    .select('user_id, role')
    .eq('id', member_id)
    .eq('tenant_id', tenant_id)
    .single();

  if (!member) {
    return new Response(
      JSON.stringify({ error: 'Team member not found' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
    );
  }

  // Don't allow removing the owner
  if (member.user_id === tenant.owner_id) {
    return new Response(
      JSON.stringify({ error: 'Cannot remove tenant owner' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }

  // Remove team member
  const { error } = await supabase
    .from('team_members')
    .delete()
    .eq('id', member_id)
    .eq('tenant_id', tenant_id);

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to remove team member' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }

  // Send notification to removed team member
  await supabase
    .from('workspace_notifications')
    .insert({
      tenant_id,
      user_id: member.user_id,
      type: 'team_removed',
      title: 'Removed from Team',
      message: 'You have been removed from the team.',
      data: { role: member.role }
    });

  return new Response(
    JSON.stringify({ 
      success: true,
      message: 'Team member removed successfully'
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
  );
}

async function updateTeamMemberRole(user_id: string, data: any): Promise<Response> {
  const { tenant_id, member_id, role } = data;

  if (!tenant_id || !member_id || !role) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }

  // Check if user is tenant owner
  const { data: tenant } = await supabase
    .from('tenants')
    .select('owner_id')
    .eq('id', tenant_id)
    .single();

  if (!tenant || tenant.owner_id !== user_id) {
    return new Response(
      JSON.stringify({ error: 'Only tenant owners can update team member roles' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
    );
  }

  // Validate role
  if (!['admin', 'editor'].includes(role)) {
    return new Response(
      JSON.stringify({ error: 'Invalid role. Must be admin or editor' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }

  // Check if member exists
  const { data: member } = await supabase
    .from('team_members')
    .select('user_id, role')
    .eq('id', member_id)
    .eq('tenant_id', tenant_id)
    .single();

  if (!member) {
    return new Response(
      JSON.stringify({ error: 'Team member not found' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
    );
  }

  // Update role
  const { error } = await supabase
    .from('team_members')
    .update({
      role,
      updated_at: new Date().toISOString()
    })
    .eq('id', member_id)
    .eq('tenant_id', tenant_id);

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to update team member role' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }

  // Send notification to updated team member
  await supabase
    .from('workspace_notifications')
    .insert({
      tenant_id,
      user_id: member.user_id,
      type: 'role_updated',
      title: 'Role Updated',
      message: `Your role has been updated to ${role}.`,
      data: { old_role: member.role, new_role: role }
    });

  return new Response(
    JSON.stringify({ 
      success: true,
      message: 'Team member role updated successfully'
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
  );
}

async function getTeamInvitations(user_id: string, tenant_id: string): Promise<Response> {
  if (!tenant_id) {
    return new Response(
      JSON.stringify({ error: 'Missing tenant_id' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }

  // Check if user has access to this tenant
  const { data: tenant } = await supabase
    .from('tenants')
    .select('owner_id')
    .eq('id', tenant_id)
    .single();

  if (!tenant || (tenant.owner_id !== user_id && !isTeamMember(user_id, tenant_id))) {
    return new Response(
      JSON.stringify({ error: 'No access to this tenant' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
    );
  }

  // Get pending invitations
  const { data: invitations, error } = await supabase
    .from('team_invitations')
    .select(`
      id,
      email,
      role,
      created_at,
      expires_at,
      invited_by
    `)
    .eq('tenant_id', tenant_id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch invitations' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }

  return new Response(
    JSON.stringify({ 
      success: true,
      invitations: invitations || []
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
  );
}

async function sendTeamInvitation(user_id: string, data: any): Promise<Response> {
  const { tenant_id, email, role } = data;

  if (!tenant_id || !email || !role) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }

  // Check if user is tenant owner
  const { data: tenant } = await supabase
    .from('tenants')
    .select('owner_id, name')
    .eq('id', tenant_id)
    .single();

  if (!tenant || tenant.owner_id !== user_id) {
    return new Response(
      JSON.stringify({ error: 'Only tenant owners can send invitations' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
    );
  }

  // Validate role
  if (!['admin', 'editor'].includes(role)) {
    return new Response(
      JSON.stringify({ error: 'Invalid role. Must be admin or editor' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }

  // Check if user already exists
  const { data: existingUser } = await supabase
    .from('auth.users')
    .select('id')
    .eq('email', email)
    .single();

  if (existingUser) {
    // User exists, check if already a team member
    const { data: existingMember } = await supabase
      .from('team_members')
      .select('id')
      .eq('tenant_id', tenant_id)
      .eq('user_id', existingUser.id)
      .single();

    if (existingMember) {
      return new Response(
        JSON.stringify({ error: 'User is already a team member' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }
  }

  // Check for existing pending invitation
  const { data: existingInvitation } = await supabase
    .from('team_invitations')
    .select('id')
    .eq('tenant_id', tenant_id)
    .eq('email', email)
    .eq('status', 'pending')
    .single();

  if (existingInvitation) {
    return new Response(
      JSON.stringify({ error: 'Invitation already sent to this email' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }

  // Generate invitation token
  const invitationToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  // Create invitation
  const { data: invitation, error } = await supabase
    .from('team_invitations')
    .insert({
      tenant_id,
      email,
      role,
      token: invitationToken,
      expires_at: expiresAt.toISOString(),
      invited_by: user_id,
      status: 'pending'
    })
    .select()
    .single();

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to create invitation' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }

  // Send invitation email
  await sendInvitationEmail(email, invitationToken, tenant.name, role);

  return new Response(
    JSON.stringify({ 
      success: true,
      invitation
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 201 }
  );
}

async function revokeTeamInvitation(user_id: string, data: any): Promise<Response> {
  const { tenant_id, invitation_id } = data;

  if (!tenant_id || !invitation_id) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }

  // Check if user is tenant owner
  const { data: tenant } = await supabase
    .from('tenants')
    .select('owner_id')
    .eq('id', tenant_id)
    .single();

  if (!tenant || tenant.owner_id !== user_id) {
    return new Response(
      JSON.stringify({ error: 'Only tenant owners can revoke invitations' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
    );
  }

  // Revoke invitation
  const { error } = await supabase
    .from('team_invitations')
    .update({
      status: 'revoked',
      updated_at: new Date().toISOString()
    })
    .eq('id', invitation_id)
    .eq('tenant_id', tenant_id);

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to revoke invitation' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }

  return new Response(
    JSON.stringify({ 
      success: true,
      message: 'Invitation revoked successfully'
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
  );
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

// Helper function to send invitation email
async function sendInvitationEmail(email: string, token: string, tenantName: string, role: string): Promise<void> {
  const invitationUrl = `${Deno.env.get('APP_URL')}/invite?token=${token}`;
  
  const subject = `You've been invited to join ${tenantName} on MobiWave WA`;
  
  const body = `
    <h2>Team Invitation</h2>
    <p>You've been invited to join <strong>${tenantName}</strong> on MobiWave WA as a <strong>${role}</strong>.</p>
    
    <p>Click the button below to accept the invitation:</p>
    
    <a href="${invitationUrl}" style="
      display: inline-block;
      padding: 12px 24px;
      background-color: #007bff;
      color: white;
      text-decoration: none;
      border-radius: 4px;
      font-weight: bold;
    ">Accept Invitation</a>
    
    <p>If the button doesn't work, you can copy and paste this URL into your browser:</p>
    <p>${invitationUrl}</p>
    
    <p>This invitation will expire in 7 days.</p>
    
    <p>If you didn't request this invitation, you can safely ignore this email.</p>
  `;

  // TODO: Implement actual email sending
  console.log(`Sending invitation email to ${email}: ${subject}`);
  console.log(`Body: ${body}`);
  
  // Example using Resend:
  /*
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  if (!resendApiKey) {
    throw new Error('RESEND_API_KEY not configured');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'noreply@mobiwave.wa',
      to: [email],
      subject: subject,
      html: body
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to send invitation email: ${response.statusText}`);
  }
  */
}