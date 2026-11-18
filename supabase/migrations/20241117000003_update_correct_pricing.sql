-- Update MobiWave WA Pricing to Correct Values
-- This migration updates the pricing to the correct values as specified

UPDATE public.platform_billing_tiers
SET 
  monthly_price_minor = CASE slug
    WHEN 'starter' THEN 300000   -- KES 3,000 + VAT
    WHEN 'basic' THEN 500000    -- KES 5,000 + VAT  
    WHEN 'pro' THEN 800000     -- KES 8,000 + VAT
    WHEN 'enterprise' THEN monthly_price_minor  -- Unchanged
    ELSE monthly_price_minor
  END,
  setup_fee_minor = CASE slug
    WHEN 'starter' THEN 0       -- No setup fee
    WHEN 'basic' THEN 0        -- No setup fee
    WHEN 'pro' THEN 50000     -- KES 500 setup fee (optional)
    WHEN 'enterprise' THEN setup_fee_minor  -- Unchanged
    ELSE setup_fee_minor
  END,
  updated_at = NOW()
WHERE slug IN ('starter', 'basic', 'pro', 'enterprise') AND is_public = true;

-- Update feature highlights to reflect the new pricing
UPDATE public.platform_billing_tiers
SET 
  feature_highlights = CASE slug
    WHEN 'starter' THEN array['Perfect for individuals and small teams', '5,000 platform messages/month', '1,000 free Meta messages per phone number', 'KES 3,000 + VAT/month']
    WHEN 'basic' THEN array['Ideal for growing businesses', '20,000 platform messages/month', '1,000 free Meta messages per phone number', 'KES 5,000 + VAT/month']
    WHEN 'pro' THEN array['For established businesses', '100,000 platform messages/month', '1,000 free Meta messages per phone number', 'AI assistant included', 'KES 8,000 + VAT/month', 'Optional KES 500 setup fee']
    WHEN 'enterprise' THEN array['Custom solution for large organizations', 'Unlimited platform messages', '1,000 free Meta messages per phone number', 'AI assistant included', 'Advanced automations', 'Dedicated support']
    ELSE feature_highlights
  END
WHERE slug IN ('starter', 'basic', 'pro', 'enterprise') AND is_public = true;

-- Update descriptions to reflect new pricing
UPDATE public.platform_billing_tiers
SET 
  description = CASE slug
    WHEN 'starter' THEN 'Perfect for individuals and small teams getting started - KES 3,000 + VAT/month'
    WHEN 'basic' THEN 'Ideal for growing businesses with moderate messaging needs - KES 5,000 + VAT/month'
    WHEN 'pro' THEN 'For established businesses with high-volume messaging requirements - KES 8,000 + VAT/month with optional KES 500 setup fee'
    WHEN 'enterprise' THEN 'Custom solution for large organizations with specific needs'
    ELSE description
  END
WHERE slug IN ('starter', 'basic', 'pro', 'enterprise') AND is_public = true;

-- Verify the updated data
SELECT 
  id, 
  slug, 
  name, 
  description, 
  currency, 
  monthly_price_minor, 
  setup_fee_minor, 
  featured, 
  display_order,
  feature_highlights,
  max_team_members,
  monthly_message_limit
FROM public.platform_billing_tiers 
WHERE slug IN ('starter', 'basic', 'pro', 'enterprise')
ORDER BY display_order, name;