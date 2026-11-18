-- Revise public platform tier definitions to match market expectations
-- Names, team sizes, message limits, and feature ladder updated
-- Setup fees made optional, AI/automations added to Business/Enterprise tiers

-- Update public catalog tiers by slug (preserve operator-customized prices on non-public rows)
update public.platform_billing_tiers
set
  name = case slug
    when 'starter' then 'Starter'
    when 'basic' then 'Growth'
    when 'pro' then 'Business'
    when 'enterprise' then 'Enterprise'
    else name
  end,
  max_team_members = case slug
    when 'starter' then 2
    when 'basic' then 4
    when 'pro' then 10
    when 'enterprise' then 0  -- unlimited
    else max_team_members
  end,
  monthly_message_limit = case slug
    when 'starter' then 5000
    when 'basic' then 20000
    when 'pro' then 100000
    when 'enterprise' then 0  -- unlimited
    else monthly_message_limit
  end,
  monthly_ai_request_limit = case slug
    when 'starter' then 0
    when 'basic' then 0
    when 'pro' then 5000
    when 'enterprise' then 0  -- unlimited
    else monthly_ai_request_limit
  end,
  feature_flags = case slug
    when 'starter' then '{"inbox":true,"contacts":true,"templates":true,"campaigns":true,"api":true,"webhooks":true,"ai":false,"automations":false}'::jsonb
    when 'basic' then '{"inbox":true,"contacts":true,"templates":true,"campaigns":true,"api":true,"webhooks":true,"ai":false,"automations":false}'::jsonb
    when 'pro' then '{"inbox":true,"contacts":true,"templates":true,"campaigns":true,"api":true,"webhooks":true,"ai":true,"automations":true}'::jsonb
    when 'enterprise' then '{"inbox":true,"contacts":true,"templates":true,"campaigns":true,"api":true,"webhooks":true,"ai":true,"automations":true}'::jsonb
    else feature_flags
  end,
  feature_highlights = case slug
    when 'starter' then array['Suggested team size: 2 users', '5,000 platform messages/month', 'AI and automations available on higher tiers']
    when 'basic' then array['Suggested team size: 4 users', '20,000 platform messages/month', 'AI and automations available on higher tiers']
    when 'pro' then array['Suggested team size: 10 users', '100,000 platform messages/month', 'AI assistant included', 'Advanced automations']
    when 'enterprise' then array['Custom team size', 'Unlimited platform messages', 'AI assistant included', 'Advanced automations', 'SSO, dedicated support, SLA']
    else feature_highlights
  end,
  display_order = case slug
    when 'starter' then 10
    when 'basic' then 20
    when 'pro' then 30
    when 'enterprise' then 40
    else display_order
  end,
  featured = case slug when 'pro' then true else featured end
where slug in ('starter', 'basic', 'pro', 'enterprise') and is_public = true;

-- Grant permissions for the updated tiers
grant select on public.platform_billing_tiers to authenticated, anon;