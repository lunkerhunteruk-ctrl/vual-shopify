-- Migrate from credit system to 3-point system
-- Studio: 1 credit → 3 pt, VTON: 0.5 credit → 1 pt
-- Run in Supabase SQL Editor
--
-- This multiplies all existing credit values by 3x to align with the new point system.
-- After this migration:
--   Free: 5 credits → 15 pt
--   Starter: 50 credits → 150 pt
--   Growth: 200 credits → 600 pt
--   Pro: 1000 credits → 3000 pt

-- 1. Update monthly_credits (plan allocation) × 3
UPDATE shopify_subscriptions
SET monthly_credits = monthly_credits * 3,
    updated_at = now()
WHERE status = 'active';

-- 2. Update credits_used × 3 (existing usage also needs to scale)
UPDATE shopify_subscriptions
SET credits_used = credits_used * 3
WHERE status = 'active'
  AND credits_used > 0;

-- 3. Update overage_usd to per-point rate (÷ 3)
UPDATE shopify_subscriptions
SET overage_usd = overage_usd / 3
WHERE status = 'active'
  AND overage_usd > 0;

-- 4. Update credit usage log — multiply credit amounts by appropriate factor
-- Studio entries (credits = 1) → 3
UPDATE shopify_credit_usage
SET credits = 3
WHERE credits = 1
  AND description LIKE '%look generation%';

-- VTON entries (credits = 0.5) → 1
UPDATE shopify_credit_usage
SET credits = 1
WHERE credits = 0.5
  AND description LIKE '%try-on%';

-- Admin grants (negative credits) — multiply by 3
UPDATE shopify_credit_usage
SET credits = credits * 3
WHERE credits < 0;
