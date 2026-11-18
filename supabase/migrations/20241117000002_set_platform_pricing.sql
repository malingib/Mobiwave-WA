-- Set platform pricing for MobiWave WA tiers
-- KES pricing with VAT, aligned with commercial model requirements
-- Tech Provider model: Platform fees separate from Meta billing

-- Update plan names to match our discussed naming convention
update public.platform_billing_tiers
set
  name = case slug
    when 'starter' then 'Basic'
    when 'basic' then 'Professional'
    when 'pro' then 'Business'
    when 'enterprise' then 'Enterprise'
    else name
  end
where slug in ('starter', 'basic', 'pro', 'enterprise') and is_public = true;

-- Set pricing for public tiers (KES + VAT)
update public.platform_billing_tiers
set
  currency = 'KES',
  monthly_price_minor = case slug
    when 'starter' then 150000  -- KES 1,500 + VAT
    when 'basic' then 250000   -- KES 2,500 + VAT  
    when 'pro' then 350000    -- KES 3,500 + VAT
    when 'enterprise' then 0  -- Custom pricing
    else monthly_price_minor
  end,
  setup_fee_minor = case slug
    when 'starter' then 0      -- No setup fee for entry tier
    when 'basic' then 0       -- No setup fee
    when 'pro' then 50000     -- KES 500 setup fee
    when 'enterprise' then 0  -- Custom pricing
    else setup_fee_minor
  end,
  updated_at = now()
where slug in ('starter', 'basic', 'pro', 'enterprise') and is_public = true;

-- Add feature descriptions that match our commercial model
update public.platform_billing_tiers
set
  description = case slug
    when 'starter' then 'Perfect for individuals and small teams getting started'
    when 'basic' then 'Ideal for growing businesses with moderate messaging needs'
    when 'pro' then 'For established businesses with high-volume messaging requirements'
    when 'enterprise' then 'Custom solution for large organizations with specific needs'
    else description
  end
where slug in ('starter', 'basic', 'pro', 'enterprise') and is_public = true;

-- Add feature highlights that match our commercial model
update public.platform_billing_tiers
set
  feature_highlights = case slug
    when 'starter' then array['Perfect for individuals and small teams', '5,000 platform messages/month', '1,000 free Meta messages per phone number']
    when 'basic' then array['Ideal for growing businesses', '20,000 platform messages/month', '1,000 free Meta messages per phone number']
    when 'pro' then array['For established businesses', '100,000 platform messages/month', '1,000 free Meta messages per phone number', 'AI assistant included']
    when 'enterprise' then array['Custom solution for large organizations', 'Unlimited platform messages', '1,000 free Meta messages per phone number', 'AI assistant included', 'Advanced automations', 'Dedicated support']
    else feature_highlights
  end
where slug in ('starter', 'basic', 'pro', 'enterprise') and is_public = true;



-- Update display order to match new plan hierarchy
update public.platform_billing_tiers
set
  display_order = case slug
    when 'starter' then 10
    when 'basic' then 20
    when 'pro' then 30
    when 'enterprise' then 40
    else display_order
  end
where slug in ('starter', 'basic', 'pro', 'enterprise') and is_public = true;

-- Set featured plan (Business tier)
update public.platform_billing_tiers
set featured = true
where slug = 'pro' and is_public = true;

-- Grant permissions
grant select on public.platform_billing_tiers to authenticated, anon;